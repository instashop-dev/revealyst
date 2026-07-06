import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { assertTeamOnlyPseudonymized } from "../src/lib/visibility";
import { periodFor, recomputeOrg } from "../src/scoring";
import { resolveDashboardView } from "./harness/seams";

// W2-L PR4 — the W2 exit-gate item: "privacy default verified as team-only
// pseudonymized". Runs over the PRODUCTION dashboard read resolved through the
// W1-S seam, with a real-name-bearing person seeded so the assertion is not
// vacuous: private hides them, full surfaces them (and the predicate says so).

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const JUNE = periodFor("month", "2026-06-15");
const PERIOD = {
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  periodGrain: "month" as const,
};
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };
const REAL_NAME = "Grace Hopper";

let db: Db;
let orgId: string;
let scope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "w2l-privacy", "team")).id;
  await loadFixture(db, orgId, teamFixture);
  scope = forOrg(db, orgId);
  await recomputeOrg(db, orgId, { period: JUNE });

  // A person carrying a real name, with a person-level adoption score so the
  // segment panel would surface them when visibility permits.
  const person = await scope.people.create({
    displayName: REAL_NAME,
    email: "grace@fixture.example",
  });
  const definitions = await scope.scores.definitions();
  const adoption = definitions.find(
    (d) => d.slug === "adoption" && d.status === "active",
  )!;
  await scope.scores.upsertResults([
    {
      definitionId: adoption.id,
      subjectLevel: "person",
      personId: person.id,
      ...PERIOD,
      value: 82,
      attribution: "person",
      components: {},
    },
  ]);
});

describe("privacy default (team-only pseudonymized)", () => {
  it("passes the audit in the private default — no real names, no individual members", async () => {
    const view = await resolveDashboardView()(scope, "private", WINDOW);

    expect(() => assertTeamOnlyPseudonymized(view)).not.toThrow();
    // No score exposes a name; no segment lists individuals.
    expect(view.summary.scores.every((s) => s.person === null)).toBe(true);
    expect(view.segments.segments.every((seg) => seg.members.length === 0)).toBe(
      true,
    );
    // But the person IS counted — pseudonymity is not erasure.
    const aiNatives = view.segments.segments.find(
      (s) => s.segment === "ai_native",
    )!;
    expect(aiNatives.count).toBe(1);
  });

  it("fails the audit under full visibility, where the real name surfaces", async () => {
    const view = await resolveDashboardView()(scope, "full", WINDOW);

    const aiNatives = view.segments.segments.find(
      (s) => s.segment === "ai_native",
    )!;
    expect(aiNatives.members).toHaveLength(1);
    expect(aiNatives.members[0].displayName).toBe(REAL_NAME);
    // The predicate is not vacuous: a name-bearing view is NOT team-only.
    expect(() => assertTeamOnlyPseudonymized(view)).toThrow(
      /not team-only pseudonymized/,
    );
  });
});
