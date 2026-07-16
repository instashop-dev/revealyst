import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  loadScoreDefinitions,
  type LoadedFixture,
} from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { periodFor, recomputeOrg } from "../src/scoring";
import {
  dashboardSummary,
  listScores,
  metricsSeries,
  trackedUsers,
} from "../src/lib/api-impl";
import { sliceScoreRows } from "../src/lib/maturity";

// W2-H personal read surface: the self-view/overview reads real DB-backed
// score_results + metric_records through forOrg, hydrated into the frozen
// API shapes. Person-level scoring, placeholder defs (W2-I calibrates later).

const personalFixture = JSON.parse(
  readFileSync("fixtures/metric-records/personal-30d.json", "utf8"),
);
const personalDefs = JSON.parse(
  readFileSync("fixtures/score-definitions/personal-presets.json", "utf8"),
);
const oracle = JSON.parse(
  readFileSync("fixtures/score-results/personal-30d.json", "utf8"),
) as {
  results: Array<{
    definitionSlug: string;
    definitionVersion: number;
    personKey: string;
    expected: { components: unknown; value: number; attribution: string };
  }>;
};

const JUNE = periodFor("month", "2026-06-15");
const RANGE = { from: "2026-06-01", to: "2026-06-30" };

let db: Db;
let orgId: string;
let otherOrgId: string;
let P: LoadedFixture;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  orgId = (await createFixtureOrg(db, "Fixture Personal", "personal")).id;
  P = await loadFixture(db, orgId, personalFixture);
  await loadScoreDefinitions(db, orgId, personalDefs);
  await recomputeOrg(db, orgId, { period: JUNE });

  // An empty org proves the read layer is org-scoped.
  otherOrgId = (await createFixtureOrg(db, "Empty Personal", "personal")).id;
});

describe("person-level oracle (recompute reproduces the checked-in numbers)", () => {
  it("computes adoption/fluency/efficiency exactly for the solo person", async () => {
    const scoped = forOrg(db, orgId);
    const defs = await scoped.scores.definitions();
    for (const expected of oracle.results) {
      const def = defs.find(
        (d) =>
          d.slug === expected.definitionSlug &&
          d.version === expected.definitionVersion &&
          d.subjectLevel === "person",
      );
      expect(def, `${expected.definitionSlug} person def`).toBeDefined();
      const results = await scoped.scores.results({ definitionId: def!.id });
      const row = results.find((r) => r.personId === P.people[expected.personKey]);
      expect(row, `${expected.definitionSlug} result for solo`).toBeDefined();
      expect(row!.value).toBe(expected.expected.value);
      expect(row!.attribution).toBe(expected.expected.attribution);
      expect(row!.components).toEqual(expected.expected.components);
    }
  });
});

describe("dashboardSummary (frozen contract)", () => {
  it("returns hydrated person-level scores + honest spend/counts", async () => {
    const summary = await dashboardSummary(forOrg(db, orgId), "full", RANGE);

    // Three person-level scores, each attributed to the solo person.
    expect(summary.scores).toHaveLength(3);
    expect(new Set(summary.scores.map((s) => s.definitionSlug))).toEqual(
      new Set(["adoption", "fluency", "efficiency"]),
    );
    for (const score of summary.scores) {
      expect(score.subjectLevel).toBe("person");
      expect(score.person?.id).toBe(P.people.solo);
      expect(score.person?.pseudonym).toBe("solar-tern");
    }

    // Spend from real metric_records; estimated kept separate + labelled.
    expect(summary.spendCents).toBe(385);
    expect(summary.spendCentsEstimated).toBe(410);
    expect(summary.activePeople).toBe(1);
    expect(summary.unresolvedSubjects).toBe(0);
    expect(summary.gaps).toEqual([]);
  });

  it("prefetched results/spendRows produce IDENTICAL output to the direct reads", async () => {
    // The shared-read pass (perf: dashboard/growth <2s) lets the Today page
    // hand dashboardSummary pre-sliced score/spend rows from ONE wider fetch.
    // This is the equivalence pin for that seam (the maturity reader has its
    // own in tests/maturity-queries.test.ts): a slice that drifts from the
    // narrow reads' SQL predicates would silently change "Spend this month"
    // — an invariant-(b) fabrication — so it must fail here, not on a
    // dashboard. The prefetched inputs are deliberately fetched WIDER than
    // the period and sliced exactly like personal-self-view.tsx does.
    const scope = forOrg(db, orgId);
    const direct = await dashboardSummary(scope, "full", RANGE);
    const wideScores = scope.scores.results({ from: "2025-01-01", to: "2026-12-31" });
    const wideSpend = scope.metrics.records({
      metricKey: "spend_cents",
      from: "2025-01-01",
      to: "2026-12-31",
    });
    const prefetched = await dashboardSummary(scope, "full", RANGE, {
      results: wideScores.then((rows) =>
        sliceScoreRows(rows, { from: RANGE.from, to: RANGE.to }),
      ),
      spendRows: wideSpend.then((rows) =>
        rows.filter((r) => r.day >= RANGE.from && r.day <= RANGE.to),
      ),
    });
    expect(prefetched).toEqual(direct);
  });

  it("§7: nulls person displayName in private mode, keeps it otherwise", async () => {
    const priv = await dashboardSummary(forOrg(db, orgId), "private", RANGE);
    for (const score of priv.scores) {
      expect(score.person?.displayName).toBeNull();
    }
    const full = await dashboardSummary(forOrg(db, orgId), "full", RANGE);
    for (const score of full.scores) {
      expect(score.person?.displayName).toBe("Solo Founder");
    }
  });

  it("is org-scoped: an empty org sees no scores or spend", async () => {
    const summary = await dashboardSummary(forOrg(db, otherOrgId), "full", RANGE);
    expect(summary.scores).toEqual([]);
    expect(summary.spendCents).toBe(0);
    expect(summary.activePeople).toBe(0);
  });
});

describe("listScores (frozen contract)", () => {
  it("filters by slug and by subject level", async () => {
    const scoped = forOrg(db, orgId);
    const bySlug = await listScores(scoped, "full", { ...RANGE, slug: "fluency" });
    expect(bySlug.results).toHaveLength(1);
    expect(bySlug.results[0].definitionSlug).toBe("fluency");

    const byLevel = await listScores(scoped, "full", { ...RANGE, level: "person" });
    expect(byLevel.results).toHaveLength(3);

    // No team-level rows exist for a personal org.
    const teams = await listScores(scoped, "full", { ...RANGE, level: "team" });
    expect(teams.results).toEqual([]);
  });
});

describe("metricsSeries (frozen contract)", () => {
  it("sums a metric per day with propagated attribution", async () => {
    const spend = await metricsSeries(forOrg(db, orgId), {
      ...RANGE,
      metric: "spend_cents",
    });
    expect(spend.series).toEqual([
      { day: "2026-06-17", value: 385, attribution: "person" },
    ]);
  });

  it("returns an empty series for a metric with no rows (never a fabricated 0)", async () => {
    const offered = await metricsSeries(forOrg(db, orgId), {
      ...RANGE,
      metric: "suggestions_offered",
    });
    expect(offered.series).toEqual([]);
  });
});

describe("trackedUsers billing (frozen contract)", () => {
  it("counts the resolved person and surfaces zero unresolved subjects", async () => {
    const billing = await trackedUsers(forOrg(db, orgId), "full", RANGE);
    expect(billing.trackedUsers).toBe(1);
    expect(billing.trackedPeople).toHaveLength(1);
    expect(billing.trackedPeople[0].id).toBe(P.people.solo);
    expect(billing.unresolvedSubjects).toEqual([]);
  });
});
