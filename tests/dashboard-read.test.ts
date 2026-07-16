import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db/client";
import { latestTeamScoresBySlug, readDashboard } from "../src/lib/dashboard-read";
import { periodFor, recomputeOrg } from "../src/scoring";

// W2-L: the team dashboard read/aggregate core (readDashboard) over the frozen
// team-30d fixture, after the real recompute engine has written score_results.
// The oracle in fixtures/score-results/team-30d.json is the source of truth.
// readDashboard reads TEAM/org-level scores only — person-level is the opt-in
// self-view's concern (W2-H).

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

describe("readDashboard", () => {
  it("returns the three team scores mapped to the frozen shape", async () => {
    const data = await readDashboard(scope, "private", WINDOW);
    expect(data.scores).toHaveLength(3);

    const latest = latestTeamScoresBySlug(data.scores);
    const adoption = latest.get("adoption");
    expect(adoption).toBeDefined();
    expect(adoption!.subjectLevel).toBe("team");
    expect(adoption!.value).toBe(47.5);
    expect(adoption!.attribution).toBe("account");
    // DashboardScore.components is the typed breakdown (no re-parse needed).
    expect(Object.keys(adoption!.components).sort()).toEqual([
      "active_days",
      "tool_coverage",
    ]);
    expect(adoption!.components.active_days.contribution).toBe(22.5);

    // Team-level scores never carry a person ref, regardless of mode.
    expect(adoption!.person).toBeNull();
  });

  it("renders fluency's breadth/depth/effectiveness drill-down exactly (no fabricated component)", async () => {
    const data = await readDashboard(scope, "private", WINDOW);
    const fluency = latestTeamScoresBySlug(data.scores).get("fluency");
    expect(fluency!.value).toBe(48.7583);
    expect(Object.keys(fluency!.components).sort()).toEqual([
      "breadth",
      "depth",
      "effectiveness",
    ]);
  });

  it("sums spend honestly and counts active/unresolved subjects", async () => {
    const data = await readDashboard(scope, "private", WINDOW);
    // alice 412 + shared 1980 + svc-key 240 = 2632; estimated (copilot) 130.
    expect(data.spendCents).toBe(2632);
    expect(data.spendCentsEstimated).toBe(130);
    // Resolved people with an active_day: alice, bob, carol, dave (eve idle).
    expect(data.activePeople).toBe(4);
    // Distribution completeness (P2c): the complement over tracked people — eve
    // has no active_day this window. active + notYetActive === tracked people.
    expect(data.notYetActive).toBe(1);
    const trackedPeople = (await scope.people.list()).length;
    expect(data.activePeople + data.notYetActive).toBe(trackedPeople);
    // svc-key is the only subject with no identity link.
    expect(data.unresolvedSubjects).toBe(1);
  });

  it("excludes person-level scores from the team dashboard read", async () => {
    const definitions = await scope.scores.definitions();
    const adoption = definitions.find(
      (d) => d.slug === "adoption" && d.status === "active",
    )!;
    const [alice] = await scope.people.list();
    await scope.scores.upsertResults([
      {
        definitionId: adoption.id,
        subjectLevel: "person",
        personId: alice.id,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        periodGrain: "month",
        value: 80,
        attribution: "person",
        components: {},
      },
    ]);
    const data = await readDashboard(scope, "private", WINDOW);
    expect(data.scores.every((s) => s.subjectLevel === "team")).toBe(true);
  });
});
