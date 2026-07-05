import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { scoreComponentBreakdownSchema } from "../src/contracts/scores";
import type { Db } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  type LoadedFixture,
} from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { processPollMessage } from "../src/poller/process";
import { periodFor, recomputeOrg } from "../src/scoring";

// The W1-F exit-gate suite: the engine computes correct scores from the
// checked-in fixtures (golden oracle parity), recompute is idempotent, a
// definition-version change recomputes forward while retaining history, the
// queue path works end-to-end, and results never leak across orgs.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const oracle = JSON.parse(
  readFileSync("fixtures/score-results/team-30d.json", "utf8"),
) as {
  results: Array<{
    definitionSlug: string;
    definitionVersion: number;
    teamKey: string;
    periodStart: string;
    periodEnd: string;
    periodGrain: "week" | "month" | "rolling_28d";
    expected: { components: unknown; value: number; attribution: string };
  }>;
};

const JUNE = periodFor("month", "2026-06-15");

let db: Db;
let orgA: string;
let orgB: string;
let A: LoadedFixture;
let B: LoadedFixture;

async function definitionId(orgId: string, slug: string, version: number) {
  const defs = await forOrg(db, orgId).scores.definitions();
  const def = defs.find((d) => d.slug === slug && d.version === version);
  if (!def) throw new Error(`definition ${slug}@v${version} not found`);
  return def.id;
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  orgA = (await createFixtureOrg(db, "score-org-a", "team")).id;
  orgB = (await createFixtureOrg(db, "score-org-b", "team")).id;
  A = await loadFixture(db, orgA, teamFixture);
  B = await loadFixture(db, orgB, teamFixture);
});

describe("golden fixture parity (exit-gate oracle)", () => {
  it("computes the adoption oracle exactly from team-30d fixtures", async () => {
    const summary = await recomputeOrg(db, orgA, { period: JUNE });
    // Three seeded presets, all team-level, all with data for team core.
    expect(summary.definitionsEvaluated).toBe(3);
    expect(summary.resultsWritten).toBe(3);

    for (const expected of oracle.results) {
      const defId = await definitionId(
        orgA,
        expected.definitionSlug,
        expected.definitionVersion,
      );
      const results = await forOrg(db, orgA).scores.results({
        definitionId: defId,
      });
      const result = results.find(
        (r) =>
          r.teamId === A.teams[expected.teamKey] &&
          r.periodStart === expected.periodStart &&
          r.periodEnd === expected.periodEnd,
      );
      expect(result, `${expected.definitionSlug} result for team`).toBeDefined();
      expect(result!.periodGrain).toBe(expected.periodGrain);
      expect(result!.value).toBe(expected.expected.value);
      expect(result!.attribution).toBe(expected.expected.attribution);
      expect(result!.components).toEqual(expected.expected.components);
    }
  });

  it("fluency and efficiency results conform to the frozen breakdown shape", async () => {
    for (const slug of ["fluency", "efficiency"]) {
      const defId = await definitionId(orgA, slug, 1);
      const [result] = await forOrg(db, orgA).scores.results({
        definitionId: defId,
      });
      expect(result, `${slug} result`).toBeDefined();
      expect(() =>
        scoreComponentBreakdownSchema.parse(result.components),
      ).not.toThrow();
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThanOrEqual(100);
      // Shared-console 'account' rows feed every preset via active_day or
      // spend_cents — the weakest attribution must survive to the score.
      expect(result.attribution).toBe("account");
    }
  });

  it("emits no result for subjects with zero signal (never fabricate)", async () => {
    // A person-level definition over the same fixture: eve has an identity
    // but her subject has no metric rows, so she gets NO row — not a 0.
    const [personDef] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "personal-activity",
        version: 1,
        name: "Personal activity",
        subjectLevel: "person",
        components: [
          {
            key: "days",
            weight: 1,
            normalization: { min: 0, max: 20 },
            metric: "active_day",
            aggregation: "active_days",
          },
        ],
        status: "active",
      })
      .returning();

    await recomputeOrg(db, orgA, { period: JUNE });
    const results = await forOrg(db, orgA).scores.results({
      definitionId: personDef.id,
    });

    // alice (8 days), bob (6: copilot ∪ shared), carol + dave (1 via shared).
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.personId)).not.toContain(A.people.eve);

    const alice = results.find((r) => r.personId === A.people.alice)!;
    expect(alice.components).toMatchObject({
      days: { raw: 8, normalized: 40, weight: 1, contribution: 40 },
    });
    expect(alice.value).toBe(40);
    expect(alice.attribution).toBe("person"); // only her own person-level rows

    const carol = results.find((r) => r.personId === A.people.carol)!;
    expect(carol.components).toMatchObject({ days: { raw: 1 } });
    expect(carol.attribution).toBe("account"); // shared-console only
  });
});

describe("recompute paths", () => {
  it("is idempotent: re-running writes no duplicate rows", async () => {
    const before = await forOrg(db, orgA).scores.results({});
    await recomputeOrg(db, orgA, { period: JUNE });
    const after = await forOrg(db, orgA).scores.results({});
    expect(after).toHaveLength(before.length);
  });

  it("recomputes a definition-version change forward and retains history", async () => {
    const spendComponent = (max: number) => [
      {
        key: "spend",
        weight: 1,
        normalization: { min: 0, max },
        metric: "spend_cents",
        aggregation: "sum",
      },
    ];
    const [v1] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "custom-spend",
        version: 1,
        name: "Custom spend v1",
        subjectLevel: "org",
        components: spendComponent(5000),
        status: "active",
      })
      .returning();
    await recomputeOrg(db, orgA, { period: JUNE });

    // Version bump: v1 retires, v2 (different normalization) activates.
    await db
      .update(schema.scoreDefinitions)
      .set({ status: "retired" })
      .where(eq(schema.scoreDefinitions.id, v1.id));
    const [v2] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "custom-spend",
        version: 2,
        name: "Custom spend v2",
        subjectLevel: "org",
        components: spendComponent(10000),
        status: "active",
      })
      .returning();
    await recomputeOrg(db, orgA, { period: JUNE });

    const scoped = forOrg(db, orgA);
    // Org-wide spend = 412 + 1980 + 240 = 2632 cents.
    const [v1Result] = await scoped.scores.results({ definitionId: v1.id });
    const [v2Result] = await scoped.scores.results({ definitionId: v2.id });
    expect(v1Result.value).toBe(52.64); // 2632/5000 — history retained
    expect(v2Result.value).toBe(26.32); // 2632/10000 — new version's row
  });

  it("computes scores via the queue message (nightly / on-demand path)", async () => {
    expect(await forOrg(db, orgB).scores.results({})).toHaveLength(0);

    await processPollMessage(db, {
      kind: "score-recompute",
      orgId: orgB,
      day: "2026-06-15",
    });

    const scoped = forOrg(db, orgB);
    const adoptionId = await definitionId(orgB, "adoption", 1);
    const monthly = (await scoped.scores.results({ definitionId: adoptionId })).find(
      (r) => r.periodGrain === "month",
    );
    expect(monthly).toBeDefined();
    expect(monthly!.value).toBe(47.5); // same fixture, same oracle
    // The nightly message also computes the trailing 28-day window.
    const rolling = (await scoped.scores.results({ definitionId: adoptionId })).find(
      (r) => r.periodGrain === "rolling_28d",
    );
    expect(rolling).toBeDefined();
    expect(rolling!.periodStart).toBe("2026-05-19");
    expect(rolling!.periodEnd).toBe("2026-06-15");
  });
});

describe("tenant isolation", () => {
  it("recompute writes stay inside the org", async () => {
    // Org A has custom definitions B never had; B's results came only from
    // its own queue-path recompute. No definition or result crosses over.
    const bResults = await forOrg(db, orgB).scores.results({});
    expect(bResults.length).toBeGreaterThan(0);
    for (const r of bResults) {
      expect(r.orgId).toBe(orgB);
    }
    const bDefs = await forOrg(db, orgB).scores.definitions();
    expect(bDefs.some((d) => d.slug === "custom-spend")).toBe(false);
    expect(bDefs.some((d) => d.slug === "personal-activity")).toBe(false);

    // And directly at the table level: every result row belongs to A or B
    // under its own org id, none under the other's definitions.
    const rows = await db
      .select()
      .from(schema.scoreResults)
      .where(and(eq(schema.scoreResults.orgId, orgB)));
    const bDefIds = new Set(bDefs.map((d) => d.id));
    for (const r of rows) {
      expect(bDefIds.has(r.definitionId)).toBe(true);
    }
  });
});
