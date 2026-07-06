import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { scoreComponentBreakdownSchema } from "../src/contracts/scores";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db/client";
import { dashboardSummary, scoresList } from "../src/lib/api-impl";
import { latestTeamScoresBySlug } from "../src/lib/dashboard-read";
import { periodFor, recomputeOrg } from "../src/scoring";

// W2-L PR1: the dashboard read/aggregate cores over the frozen team-30d
// fixture, after the real recompute engine has written score_results. The
// oracle in fixtures/score-results/team-30d.json is the source of truth.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);

const JUNE = periodFor("month", "2026-06-15");
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };

let db: Db;
let orgId: string;
let scope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "w2l-dashboard", "team")).id;
  await loadFixture(db, orgId, teamFixture);
  scope = forOrg(db, orgId);
  await recomputeOrg(db, orgId, { period: JUNE });
});

describe("dashboardSummary", () => {
  it("returns the three team scores mapped to the frozen shape", async () => {
    const summary = await dashboardSummary(scope, "private", WINDOW);
    expect(summary.scores).toHaveLength(3);

    const latest = latestTeamScoresBySlug(summary.scores);
    const adoption = latest.get("adoption");
    expect(adoption).toBeDefined();
    expect(adoption!.subjectLevel).toBe("team");
    expect(adoption!.value).toBe(47.5);
    expect(adoption!.attribution).toBe("account");
    const components = scoreComponentBreakdownSchema.parse(adoption!.components);
    expect(Object.keys(components).sort()).toEqual([
      "active_days",
      "tool_coverage",
    ]);
    expect(components.active_days.contribution).toBe(22.5);

    // Team-level scores never carry a person ref, regardless of mode.
    expect(adoption!.person).toBeNull();
  });

  it("renders fluency's breadth/depth/effectiveness drill-down exactly (no fabricated component)", async () => {
    const summary = await dashboardSummary(scope, "private", WINDOW);
    const fluency = latestTeamScoresBySlug(summary.scores).get("fluency");
    expect(fluency!.value).toBe(48.7583);
    // Exactly the three oracle components — an omitted component would be
    // absent, never floored to 0.
    expect(Object.keys(fluency!.components).sort()).toEqual([
      "breadth",
      "depth",
      "effectiveness",
    ]);
  });

  it("sums spend honestly and counts active/unresolved subjects", async () => {
    const summary = await dashboardSummary(scope, "private", WINDOW);
    // alice 412 + shared 1980 + svc-key 240 = 2632; estimated (copilot) 130.
    expect(summary.spendCents).toBe(2632);
    expect(summary.spendCentsEstimated).toBe(130);
    // Resolved people with an active_day: alice, bob, carol, dave (eve idle).
    expect(summary.activePeople).toBe(4);
    // svc-key is the only subject with no identity link.
    expect(summary.unresolvedSubjects).toBe(1);
    // shared-console (3 identities) surfaces the shared-account honesty gap.
    expect(summary.gaps).toEqual([
      {
        kind: "shared_key_not_person_level",
        detail: expect.stringContaining("shared account"),
      },
    ]);
  });
});

describe("scoresList", () => {
  it("filters by definition slug", async () => {
    const { results } = await scoresList(scope, "private", {
      ...WINDOW,
      slug: "efficiency",
    });
    expect(results).toHaveLength(1);
    expect(results[0].definitionSlug).toBe("efficiency");
    expect(results[0].value).toBe(22.7843);
  });

  it("filters by subject level", async () => {
    const { results } = await scoresList(scope, "private", {
      ...WINDOW,
      level: "team",
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.subjectLevel === "team")).toBe(true);
  });
});
