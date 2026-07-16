import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { summarizeConfidenceTier } from "../lib/capability-history";
import { CAPABILITY_STATE_CONSTANTS } from "./capability-state";
import { periodFor } from "./periods";

// TCI Phase 2-D capability-history rollup writer (ADR 0046): the I/O half of the
// per-capability team history. Runs as a PARALLEL step in the poller
// `score-recompute` slot AFTER the capability-state reducer (it reads the fresh
// `user_capability_state` the reducer just wrote). It never touches the frozen
// score engine.
//
// DRIFT GUARD (the ADR's core invariant): the represented/mastered counts are
// read from the SAME pure function the dashboard uses —
// `scope.mastery.coverageCounts(MASTERED_THRESHOLD)` — so a stored snapshot can
// NEVER disagree with the live dashboard coverage for the same state. The
// developing band is `represented − mastered` (arithmetic), and the
// confidence-tier summary derives from a count-only sibling read
// (`coverageTierCounts`). A shared-source parity test pins this.
//
// Perf (mirrors recompute-capability-state): all reads are batched ONCE for the
// whole org (coverageCounts + coverageTierCounts + a people count) — the query
// count is INDEPENDENT of person count and of history depth. Idempotent: the
// natural-key upsert rewrites only the current, still-open period's row; a
// re-delivered nightly pass produces the same row (same inputs → same values),
// and a CLOSED period's row is never re-targeted (the window has moved on).
//
// Rows are ORG-WIDE (team_id null) — an org IS one team for most customers today
// (ADR 0046); a multi-team per-team series is a later, no-schema-change follow-up.
// True counts are STORED; the MIN_PEOPLE floor is a render-time rule, applied by
// `applyMinPeopleFloor`, never at write.

export type CapabilityHistorySummary = {
  /** Distinct capabilities that received a rollup row this period. */
  capabilitiesRolledUp: number;
  /** The period the rollup was written for (month grain). */
  periodStart: string;
  periodEnd: string;
};

/**
 * Recompute the org-wide per-capability history rollup for the month period
 * containing `asOfDay`. Safe to call for an org with no capability state (writes
 * nothing — no fabricated 0-represented rows).
 */
export async function recomputeCapabilityHistory(
  db: Db,
  orgId: string,
  options: { asOfDay: string },
): Promise<CapabilityHistorySummary> {
  const { asOfDay } = options;
  const period = periodFor("month", asOfDay);
  const scoped = forOrg(db, orgId);

  // One batched read set for the whole org (person-count-independent):
  //   - coverageCounts: THE dashboard function → represented + mastered (parity);
  //   - coverageTierCounts: count-only tier composition → the tier summary;
  //   - people.list: the org-member denominator (total_count).
  const [coverage, tierCounts, people] = await Promise.all([
    scoped.mastery.coverageCounts(CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD),
    scoped.mastery.coverageTierCounts(),
    scoped.people.list(),
  ]);

  const totalCount = people.length;

  // One row per capability that has ANY state (coverageCounts omits
  // 0-represented capabilities — so no fabricated absence row). True counts,
  // unfloored — the MIN_PEOPLE floor is applied at read.
  const rows = [...coverage.entries()].map(([capabilitySlug, c]) => {
    // Single-source the tier summary: `measured` AND its denominator both come
    // from the same coverageTierCounts SELECT, so a concurrent reducer write
    // landing between the two batched reads can never yield measured > total
    // (a spurious "measured" cohort claim). representedCount stays sourced
    // from coverageCounts — the dashboard-parity function.
    const tier = tierCounts.get(capabilitySlug);
    return {
      teamId: null,
      capabilitySlug,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      representedCount: c.withState,
      totalCount,
      masteredCount: c.mastered,
      developingCount: c.withState - c.mastered,
      confidenceTier: summarizeConfidenceTier(
        tier?.measured ?? 0,
        tier?.withState ?? 0,
      ),
    };
  });

  if (rows.length > 0) {
    await scoped.capabilityHistory.upsertPeriod(rows);
  }

  return {
    capabilitiesRolledUp: rows.length,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  };
}
