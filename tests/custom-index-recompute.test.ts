import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { periodFor, recomputeOrg } from "../src/scoring";

// Recompute inclusion/exclusion (§8.5 guardrails 4 & 5): a published custom
// index recomputes when the org is Team-entitled; a lapsed org's customs are
// skipped (last results persist for a paused render); archived customs never
// recompute. Presets are unaffected by entitlement.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const JUNE = periodFor("month", "2026-06-15");

const CUSTOM = {
  slug: "custom-depth",
  name: "Depth",
  subjectLevel: "team" as const,
  components: [
    {
      key: "depth",
      metric: "active_day",
      aggregation: "active_days",
      weight: 1,
      normalization: { min: 0, max: 20 },
    },
  ],
};

let db: Db;
let orgId: string;

async function activeCustomDefId(): Promise<string> {
  const defs = await forOrg(db, orgId).scores.customDefinitions();
  const active = defs.find(
    (d) => d.slug === CUSTOM.slug && d.status === "active",
  );
  if (!active) throw new Error("active custom definition not found");
  return active.id;
}

async function customResultCount(): Promise<number> {
  const results = await forOrg(db, orgId).scores.results({
    definitionId: await activeCustomDefId(),
  });
  return results.length;
}

beforeEach(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "recompute-org", "team")).id;
  await loadFixture(db, orgId, teamFixture);
  await forOrg(db, orgId).scores.publishCustomDefinition(CUSTOM);
});

describe("custom-index recompute gating", () => {
  it("recomputes a published custom index when Team-entitled", async () => {
    const summary = await recomputeOrg(db, orgId, {
      period: JUNE,
      customIndexesEntitled: true,
    });
    // 3 presets + 1 custom, all producing a team-core result.
    expect(summary.definitionsEvaluated).toBe(4);
    expect(await customResultCount()).toBeGreaterThan(0);
  });

  it("skips custom indexes when the org is not entitled (paused)", async () => {
    const summary = await recomputeOrg(db, orgId, {
      period: JUNE,
      customIndexesEntitled: false,
    });
    // Only the 3 presets — the custom index is excluded.
    expect(summary.definitionsEvaluated).toBe(3);
    expect(await customResultCount()).toBe(0);
  });

  it("leaves last results untouched when entitlement lapses (paused, not stale-deleted)", async () => {
    await recomputeOrg(db, orgId, { period: JUNE, customIndexesEntitled: true });
    const before = await customResultCount();
    expect(before).toBeGreaterThan(0);
    // A later lapsed run must NOT delete the prior custom results.
    await recomputeOrg(db, orgId, { period: JUNE, customIndexesEntitled: false });
    expect(await customResultCount()).toBe(before);
  });

  it("does not recompute an archived custom index even when entitled", async () => {
    await forOrg(db, orgId).scores.archiveCustomDefinition(CUSTOM.slug);
    const summary = await recomputeOrg(db, orgId, {
      period: JUNE,
      customIndexesEntitled: true,
    });
    expect(summary.definitionsEvaluated).toBe(3); // presets only
  });

  it("defaults entitlement from the subscription when not supplied (free org → skipped)", async () => {
    // No subscription seeded → personal/free → custom excluded.
    const summary = await recomputeOrg(db, orgId, { period: JUNE });
    expect(summary.definitionsEvaluated).toBe(3);
  });
});
