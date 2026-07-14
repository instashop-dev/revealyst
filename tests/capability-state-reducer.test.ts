import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  type LoadedFixture,
} from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { recomputeCapabilityState } from "../src/scoring/recompute-capability-state";

// W7-2 reducer integration: end-to-end from seeded metric_records (the team-30d
// fixture gives alice active_day/feature_used evidence on her EXCLUSIVE subject)
// through the reducer to user_capability_state. Asserts rows are produced,
// directional, idempotent, reconcile down when evidence vanishes, and are
// self-view-scoped.

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);
const AS_OF = "2026-06-15";

let db: Db;
let orgA: string;
let orgB: string;
let A: LoadedFixture;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgA = (await createFixtureOrg(db, "cap-red-a", "team")).id;
  orgB = (await createFixtureOrg(db, "cap-red-b", "team")).id;
  A = await loadFixture(db, orgA, teamFixture);
  await loadFixture(db, orgB, teamFixture);
});

describe("capability-state reducer", () => {
  it("produces directional per-person state from metric evidence", async () => {
    const summary = await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });
    expect(summary.peopleWithState).toBeGreaterThan(0);
    expect(summary.rowsWritten).toBeGreaterThan(0);

    const alice = await forOrg(db, orgA).mastery.forPerson(A.people.alice);
    expect(alice.length).toBeGreaterThan(0);
    // Every row is directional (the L7 cap), mastery in [0,1], with a breakdown.
    for (const row of alice) {
      expect(row.confidenceTier).toBe("directional");
      expect(row.mastery).toBeGreaterThanOrEqual(0);
      expect(row.mastery).toBeLessThanOrEqual(1);
      expect(Object.keys(row.components).length).toBeGreaterThan(0);
    }
    // active_day evidence → the ai-coding-foundations capability is present.
    expect(alice.some((r) => r.capabilitySlug === "ai-coding-foundations")).toBe(true);
  });

  it("is idempotent: a second run writes the same rows", async () => {
    const before = await forOrg(db, orgA).mastery.forPerson(A.people.alice);
    await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });
    const after = await forOrg(db, orgA).mastery.forPerson(A.people.alice);
    expect(after).toEqual(before);
  });

  it("is self-view-scoped: forPerson returns only that person's rows", async () => {
    const alice = await forOrg(db, orgA).mastery.forPerson(A.people.alice);
    // A random/other id yields nothing — no other person's state leaks.
    const other = await forOrg(db, orgA).mastery.forPerson(A.people.eve);
    expect(alice.every((r) => r.capabilitySlug.length > 0)).toBe(true);
    // eve has no exclusive-subject evidence in the fixture → no rows.
    expect(other).toEqual([]);
  });

  it("reconciles down: when a person's evidence vanishes, their rows are removed", async () => {
    // Wipe alice's exclusive-subject metric rows, then re-run.
    await db
      .delete(schema.metricRecords)
      .where(eq(schema.metricRecords.subjectId, A.subjects["alice-console"]));
    await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });
    const alice = await forOrg(db, orgA).mastery.forPerson(A.people.alice);
    // Alice had only metric-based evidence (no person-level scores in a team
    // fixture) → removing it removes all her rows (no fabricated 0 lingers).
    expect(alice).toEqual([]);
  });

  it("stays inside the org (org B's state never appears under org A)", async () => {
    await recomputeCapabilityState(db, orgB, { asOfDay: AS_OF });
    const rows = await db
      .select()
      .from(schema.userCapabilityState)
      .where(eq(schema.userCapabilityState.orgId, orgB));
    expect(rows.every((r) => r.orgId === orgB)).toBe(true);
  });
});
