import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import {
  applyMinPeopleFloor,
  summarizeConfidenceTier,
} from "../src/lib/capability-history";
import { deriveDepthSpread } from "../src/lib/capability-depth";
import { buildCapabilityCoverage } from "../src/lib/capability-coverage";
import { CAPABILITY_STATE_CONSTANTS } from "../src/scoring/capability-state";
import { recomputeCapabilityHistory } from "../src/scoring/recompute-capability-history";
import * as schema from "../src/db/schema";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "../src/lib/segments";

// TCI Phase 2-D (ADR 0046): the per-capability team history rollup writer +
// render-time floor. Seeds user_capability_state DIRECTLY for deterministic
// coverage, then drives the writer. The parity test is the ADR's drift guard:
// the stored row must equal what the dashboard's coverageCounts computes from the
// same state.

const JUNE = "2026-06-15";
const JULY = "2026-07-15";
const CAP_A = "ai-coding-foundations";
const CAP_B = "consistent-daily-use";

let db: Db;
let orgId: string;

/** Seed one person + their single-capability state row (a real capabilities.slug
 * FK). mastery ≥ 0.6 counts as mastered. */
async function seedPerson(
  org: string,
  displayName: string,
  capabilitySlug: string,
  mastery: number,
  confidenceTier: "measured" | "directional" = "directional",
): Promise<void> {
  const scoped = forOrg(db, org);
  const person = await scoped.people.create({
    displayName,
    email: `${displayName}@fixture.example`,
  });
  await scoped.mastery.replaceForPerson(person.id, [
    {
      personId: person.id,
      capabilitySlug,
      mastery,
      confidence: 0.5,
      confidenceTier,
      evidenceCount: 5,
      lastEvidenceAt: "2026-06-10",
      staleness: 0,
      nextCapability: null,
      components: { active_days: { kind: "component", input: 50, contribution: mastery } },
    },
  ]);
}

beforeEach(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "cap-hist", "team")).id;
});

describe("summarizeConfidenceTier (pure)", () => {
  it("is measured only when every represented person is measured", () => {
    expect(summarizeConfidenceTier(3, 3)).toBe("measured");
    expect(summarizeConfidenceTier(2, 3)).toBe("directional");
    expect(summarizeConfidenceTier(0, 3)).toBe("directional");
    expect(summarizeConfidenceTier(0, 0)).toBe("not_measured");
  });
});

describe("applyMinPeopleFloor (pure, render-time)", () => {
  it("drops below-floor capabilities entirely, never a suppressed number", () => {
    const rows = [
      { representedCount: 2, capabilitySlug: CAP_A },
      { representedCount: SEGMENT_MIN_PEOPLE_TO_NAME, capabilitySlug: CAP_B },
    ];
    const floored = applyMinPeopleFloor(rows);
    // The below-floor row is gone ENTIRELY — not zeroed, not present.
    expect(floored).toHaveLength(1);
    expect(floored[0].capabilitySlug).toBe(CAP_B);
    expect(floored.some((r) => r.capabilitySlug === CAP_A)).toBe(false);
  });
});

describe("capability-history rollup writer", () => {
  it("shared-source parity: the stored row equals the dashboard's coverageCounts", async () => {
    // Coverage: CAP_A has 3 people (2 mastered), CAP_B has 1 (0 mastered).
    await seedPerson(orgId, "a1", CAP_A, 0.9);
    await seedPerson(orgId, "a2", CAP_A, 0.7);
    await seedPerson(orgId, "a3", CAP_A, 0.3);
    await seedPerson(orgId, "b1", CAP_B, 0.2);

    await recomputeCapabilityHistory(db, orgId, { asOfDay: JUNE });

    const scoped = forOrg(db, orgId);
    const stored = await scoped.capabilityHistory.list();
    const coverage = await scoped.mastery.coverageCounts(
      CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD,
    );

    // Non-vacuous: real coverage exists.
    expect(stored.length).toBe(coverage.size);
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) {
      const c = coverage.get(row.capabilitySlug);
      expect(c, `no coverage for ${row.capabilitySlug}`).toBeDefined();
      // The drift guard: stored counts == the live dashboard function's output.
      expect(row.representedCount).toBe(c!.withState);
      expect(row.masteredCount).toBe(c!.mastered);
      expect(row.developingCount).toBe(c!.withState - c!.mastered);
      // Org-wide series (team_id null); denominator = org people count (4).
      expect(row.teamId).toBeNull();
      expect(row.totalCount).toBe(4);
    }
    const capA = stored.find((r) => r.capabilitySlug === CAP_A)!;
    expect(capA.representedCount).toBe(3);
    expect(capA.masteredCount).toBe(2);
    expect(capA.developingCount).toBe(1);
  });

  it("T3.3 depth/spread parity: the stored stats derive the same mean/spread the dashboard shows", async () => {
    // CAP_A masteries {0.9, 0.7, 0.3} → mean 0.6333, population stddev ≈ 0.249.
    await seedPerson(orgId, "a1", CAP_A, 0.9);
    await seedPerson(orgId, "a2", CAP_A, 0.7);
    await seedPerson(orgId, "a3", CAP_A, 0.3);

    await recomputeCapabilityHistory(db, orgId, { asOfDay: JUNE });

    const scoped = forOrg(db, orgId);
    const [stored, coverage, stats] = await Promise.all([
      scoped.capabilityHistory.list(),
      scoped.mastery.coverageCounts(CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD),
      scoped.mastery.masteryStats(),
    ]);

    const capA = stored.find((r) => r.capabilitySlug === CAP_A)!;
    // The writer persisted the sufficient statistics (not null).
    expect(capA.masterySumBp).toBe(19000); // 9000 + 7000 + 3000
    expect(capA.masterySumSqBp).toBe(139_000_000); // 81M + 49M + 9M

    // Drift guard, extended to depth/spread: deriving from the STORED row and
    // from the LIVE dashboard path (masteryStats → buildCapabilityCoverage)
    // gives the same mean + spread — a snapshot can never disagree.
    const fromStored = deriveDepthSpread(
      capA.masterySumBp,
      capA.masterySumSqBp,
      capA.representedCount,
    );
    const liveRow = buildCapabilityCoverage(
      coverage,
      new Map(),
      1, // floor of 1 so the 3-person capability is present in this small fixture
      stats,
    ).find((r) => r.slug === CAP_A)!;
    expect(fromStored).not.toBeNull();
    expect(liveRow.meanMastery).toBe(fromStored!.mean);
    expect(liveRow.spread).toBe(fromStored!.spread);
    expect(liveRow.meanMastery).toBeCloseTo(0.6333, 4);
    expect(liveRow.spread).toBeCloseTo(0.249, 3);
  });

  it("stores TRUE counts unfloored; the floor is applied only at read", async () => {
    // CAP_A below the MIN_PEOPLE floor (1 person), CAP_B at the floor.
    await seedPerson(orgId, "solo", CAP_A, 0.9);
    for (let i = 0; i < SEGMENT_MIN_PEOPLE_TO_NAME; i++) {
      await seedPerson(orgId, `crowd${i}`, CAP_B, 0.9);
    }
    await recomputeCapabilityHistory(db, orgId, { asOfDay: JUNE });

    const stored = await forOrg(db, orgId).capabilityHistory.list();
    // Stored: BOTH capabilities, true counts (no write-time floor).
    expect(stored.map((r) => r.capabilitySlug).sort()).toEqual(
      [CAP_A, CAP_B].sort(),
    );
    expect(stored.find((r) => r.capabilitySlug === CAP_A)!.representedCount).toBe(1);

    // Read-time floor: the below-floor capability is dropped entirely.
    const floored = applyMinPeopleFloor(stored);
    expect(floored.map((r) => r.capabilitySlug)).toEqual([CAP_B]);
  });

  it("is idempotent: running twice for one period yields one row, unchanged", async () => {
    await seedPerson(orgId, "a1", CAP_A, 0.9);
    await seedPerson(orgId, "a2", CAP_A, 0.3);

    await recomputeCapabilityHistory(db, orgId, { asOfDay: JUNE });
    const first = await forOrg(db, orgId).capabilityHistory.list();
    await recomputeCapabilityHistory(db, orgId, { asOfDay: JUNE });
    const second = await forOrg(db, orgId).capabilityHistory.list();

    // Exactly one row for the one capability, and the second run changed nothing.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second).toEqual(first);

    // Table-level: a single physical row (no duplicate period appended).
    const raw = await db.select().from(schema.teamCapabilityHistory);
    expect(raw).toHaveLength(1);
  });

  it("freezes a closed period: a later period's run never rewrites the earlier row", async () => {
    // June rollup: CAP_A represented by 1, mastered 0.
    await seedPerson(orgId, "a1", CAP_A, 0.3);
    await recomputeCapabilityHistory(db, orgId, { asOfDay: JUNE });
    const juneBefore = await forOrg(db, orgId).capabilityHistory.list({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(juneBefore).toHaveLength(1);
    expect(juneBefore[0].masteredCount).toBe(0);

    // The state CHANGES (a2 joins, mastered), then a JULY run happens.
    await seedPerson(orgId, "a2", CAP_A, 0.9);
    await recomputeCapabilityHistory(db, orgId, { asOfDay: JULY });

    // July has a NEW row reflecting the new coverage (represented 2, mastered 1).
    const july = await forOrg(db, orgId).capabilityHistory.list({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(july).toHaveLength(1);
    expect(july[0].representedCount).toBe(2);
    expect(july[0].masteredCount).toBe(1);

    // June's CLOSED row is byte-identical — the July pass did not touch it.
    const juneAfter = await forOrg(db, orgId).capabilityHistory.list({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(juneAfter).toEqual(juneBefore);
  });

  it("writes nothing for an org with no capability state (no fabricated rows)", async () => {
    await forOrg(db, orgId).people.create({
      displayName: "nobody",
      email: "nobody@fixture.example",
    });
    const summary = await recomputeCapabilityHistory(db, orgId, {
      asOfDay: JUNE,
    });
    expect(summary.capabilitiesRolledUp).toBe(0);
    const stored = await forOrg(db, orgId).capabilityHistory.list();
    expect(stored).toEqual([]);
  });
});
