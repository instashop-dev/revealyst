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

  it("never fabricates person-level rows: zero-signal and shared-only people get nothing", async () => {
    // A person-level definition over the same fixture. Two honesty rules:
    // eve has an identity but her subject has no metric rows → NO row, not
    // a 0; carol and dave are linked ONLY via the shared account, whose
    // rows must never be redistributed into per-person scores (§6.1) → no
    // rows either. bob scores from copilot-bob only (his exclusive
    // subject); shared-console days do not leak into his personal score.
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

    expect(results).toHaveLength(2); // alice + bob only
    const scored = new Set(results.map((r) => r.personId));
    expect(scored).not.toContain(A.people.eve); // zero signal
    expect(scored).not.toContain(A.people.carol); // shared-only
    expect(scored).not.toContain(A.people.dave); // shared-only

    const alice = results.find((r) => r.personId === A.people.alice)!;
    expect(alice.components).toMatchObject({
      days: { raw: 8, normalized: 40, weight: 1, contribution: 40 },
    });
    expect(alice.value).toBe(40);
    expect(alice.attribution).toBe("person");

    const bob = results.find((r) => r.personId === A.people.bob)!;
    // copilot-bob {03,04,05,06,09,10} = 6 days; shared-console's 06-04 is
    // already in that set but must be excluded on principle, not luck —
    // its 'account' attribution would otherwise taint bob's row.
    expect(bob.components).toMatchObject({ days: { raw: 6 } });
    expect(bob.attribution).toBe("person");
  });

  it("skips a malformed definition without killing the org's recompute", async () => {
    const [badDef] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "bad-weights",
        version: 1,
        name: "Broken",
        subjectLevel: "org",
        components: [
          // Weights sum to 0.9 — fails the frozen contract.
          {
            key: "only",
            weight: 0.9,
            normalization: { min: 0, max: 10 },
            metric: "prompts",
            aggregation: "sum",
          },
        ],
        status: "active",
      })
      .returning();

    const summary = await recomputeOrg(db, orgA, { period: JUNE });
    expect(summary.definitionsSkipped).toBe(1);
    expect(summary.definitionsEvaluated).toBeGreaterThan(0); // presets still ran
    expect(
      await forOrg(db, orgA).scores.results({ definitionId: badDef.id }),
    ).toHaveLength(0);

    await db
      .delete(schema.scoreDefinitions)
      .where(eq(schema.scoreDefinitions.id, badDef.id));
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

    // Org-level rows hit the NULLS NOT DISTINCT branch of the upsert key —
    // a second recompute must update in place, not duplicate.
    await recomputeOrg(db, orgA, { period: JUNE });
    expect(await scoped.scores.results({ definitionId: v2.id })).toHaveLength(1);
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
    // The nightly message also computes the trailing 28-day window; all
    // fixture activity (06-02..06-12) falls inside it, so the same oracle
    // value applies.
    const rolling = (await scoped.scores.results({ definitionId: adoptionId })).find(
      (r) => r.periodGrain === "rolling_28d",
    );
    expect(rolling).toBeDefined();
    expect(rolling!.periodStart).toBe("2026-05-19");
    expect(rolling!.periodEnd).toBe("2026-06-15");
    expect(rolling!.value).toBe(47.5);
    expect(rolling!.attribution).toBe("account");
  });

  it("skips the rolling write when its bounds equal the month (Feb grain collision)", async () => {
    // Feb 2026 (non-leap): rolling_28d anchored at 02-28 spans 02-01..02-28
    // — the exact month bounds. The frozen upsert key carries no grain, so
    // writing both would flip February's grain label to rolling_28d on the
    // second upsert. Seed one February record so the collision has a row
    // to corrupt, then assert the month label survives.
    expect(periodFor("rolling_28d", "2026-02-28")).toEqual({
      ...periodFor("month", "2026-02-28"),
      periodGrain: "rolling_28d",
    });

    const scoped = forOrg(db, orgB);
    await scoped.metrics.upsertRecords([
      {
        subjectId: B.subjects["alice-console"],
        metricKey: "active_day",
        day: "2026-02-10",
        dim: "",
        connectionId: B.connections.anthropic,
        value: 1,
        attribution: "person",
        sourceConnector: "fixture@1",
      },
    ]);
    await processPollMessage(db, {
      kind: "score-recompute",
      orgId: orgB,
      day: "2026-02-28",
    });

    const adoptionId = await definitionId(orgB, "adoption", 1);
    const feb = (await scoped.scores.results({ definitionId: adoptionId })).filter(
      (r) => r.periodStart === "2026-02-01",
    );
    expect(feb).toHaveLength(1);
    expect(feb[0].periodEnd).toBe("2026-02-28");
    expect(feb[0].periodGrain).toBe("month"); // the label the fix protects
  });
});

describe("person-level stale row reconciliation", () => {
  it("removes a person's score row once their subject is relinked into a shared account", async () => {
    // The adversarial gate finding, reproduced: a person-level definition
    // scores alice from her exclusive alice-console subject; a later
    // account merge/handoff links a second person to that SAME subject,
    // making it shared. Without reconciliation, alice's row from the first
    // recompute would survive forever — a person-level number permanently
    // disconnected from her now-shared attribution (§6.1: shared accounts
    // never mint per-person rows).
    const [def] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "relink-check",
        version: 1,
        name: "Relink check",
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
    const scoped = forOrg(db, orgA);

    // Round 1: alice-console is exclusively alice's, copilot-bob exclusively
    // bob's — active_day has real, exclusive data for both.
    const first = await recomputeOrg(db, orgA, { period: JUNE });
    expect(first.stalePersonResultsRemoved).toBe(0);
    const firstPass = await scoped.scores.results({ definitionId: def.id });
    expect(firstPass).toHaveLength(2);
    const alicesFirstRow = firstPass.find((r) => r.personId === A.people.alice);
    expect(alicesFirstRow).toBeDefined();
    expect(alicesFirstRow!.value).toBeGreaterThan(0);

    // Simulate the relink: a second person joins alice's subject only.
    const frank = await scoped.people.create({
      displayName: "Frank",
      email: "frank@fixture.example",
    });
    await scoped.identities.link(A.subjects["alice-console"], frank.id, "manual");

    const second = await recomputeOrg(db, orgA, { period: JUNE });
    // >=1, not necessarily exactly 1: this definition's alice row is
    // reconciled away, and so is any other active person-level definition's
    // alice row from an earlier test in this file — the summary is org-wide.
    expect(second.stalePersonResultsRemoved).toBeGreaterThanOrEqual(1);

    const secondPass = await scoped.scores.results({ definitionId: def.id });
    // Alice's stale row is gone — no fabricated row appears for anyone else
    // on that now-shared subject (never redistributed) — but bob, whose
    // subject was untouched, keeps his own unrelated row.
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0].personId).toBe(A.people.bob);
    expect(secondPass.some((r) => r.personId === A.people.alice)).toBe(false);
    expect(secondPass.some((r) => r.personId === frank.id)).toBe(false);

    // Cleanup so later assertions in this file see the original fixture
    // shape (orgA is shared mutable state across this file's tests).
    await scoped.identities.unlink(A.subjects["alice-console"], frank.id);
    await db.delete(schema.scoreResults).where(eq(schema.scoreResults.definitionId, def.id));
    await db
      .delete(schema.scoreDefinitions)
      .where(eq(schema.scoreDefinitions.id, def.id));
  });

  it("is idempotent: re-running after a relink does not re-remove already-removed rows", async () => {
    const [def] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "relink-check-2",
        version: 1,
        name: "Relink check 2",
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
    const scoped = forOrg(db, orgA);

    await recomputeOrg(db, orgA, { period: JUNE });
    const frank = await scoped.people.create({
      displayName: "Frank2",
      email: "frank2@fixture.example",
    });
    await scoped.identities.link(A.subjects["alice-console"], frank.id, "manual");
    await recomputeOrg(db, orgA, { period: JUNE }); // removes alice's row

    const rerun = await recomputeOrg(db, orgA, { period: JUNE });
    expect(rerun.stalePersonResultsRemoved).toBe(0); // nothing left to remove
    const remaining = await scoped.scores.results({ definitionId: def.id });
    expect(remaining).toHaveLength(1); // bob's untouched row survives
    expect(remaining[0].personId).toBe(A.people.bob);

    await scoped.identities.unlink(A.subjects["alice-console"], frank.id);
    await db.delete(schema.scoreResults).where(eq(schema.scoreResults.definitionId, def.id));
    await db
      .delete(schema.scoreDefinitions)
      .where(eq(schema.scoreDefinitions.id, def.id));
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
