import { deriveDepthSpread } from "./capability-depth";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "./segments";

// Shared pure builder for the aggregate, COUNT-ONLY capability-coverage rows
// (W7-6). Extracted so the team dashboard (src/lib/dashboard-view.ts) AND the
// weekly team brief (src/lib/team-brief.ts) build coverage from the SAME
// function — a shared-source guarantee that the brief's counts can never
// disagree with the dashboard card for the same inputs (the digest/dashboard
// parity pattern). MIN_PEOPLE-floored: a capability below the floor is dropped
// ENTIRELY (never a suppressed-but-implied number). No person data.

export type CapabilityCoverageRow = {
  slug: string;
  label: string;
  /** People at/above the mastery threshold for this capability. */
  mastered: number;
  /** People with any state for this capability (≥ MIN_PEOPLE by construction). */
  total: number;
  /** DEPTH: team mean mastery in [0,1] (T3.3) — beyond the binary mastered/total
   * split. `null` when no depth stats were supplied (the brief passes none) or
   * the cohort is empty. Count-only — never a per-person value. */
  meanMastery: number | null;
  /** SPREAD: population standard deviation of mastery in [0,1] (T3.3) — how
   * evenly mastery is distributed. `null` under the same conditions as
   * `meanMastery`. Count-only. */
  spread: number | null;
};

/**
 * Build the floored, labelled, sorted coverage rows from the count-only
 * `coverageCounts` map + the global capability-label map. Ordered by mastery
 * share descending, then label — deterministic. Pure.
 *
 * `stats` (optional, T3.3) supplies the depth/spread sufficient statistics per
 * capability (`mastery.masteryStats()`): when present, each row gains a team
 * mean + spread via `deriveDepthSpread`; when absent (e.g. the weekly team
 * brief, which stays counts-only), both are `null`. The count logic and sort
 * are UNCHANGED whether or not `stats` is passed — so a caller that omits it
 * gets byte-identical rows to before, plus two null fields (an
 * output-equivalence guarantee pinned by a test).
 */
export function buildCapabilityCoverage(
  counts: ReadonlyMap<string, { mastered: number; withState: number }>,
  labels: ReadonlyMap<string, string>,
  minPeople: number = SEGMENT_MIN_PEOPLE_TO_NAME,
  stats?: ReadonlyMap<string, { sumBp: number; sumSqBp: number }>,
): CapabilityCoverageRow[] {
  return [...counts.entries()]
    .filter(([, c]) => c.withState >= minPeople)
    .map(([slug, c]) => {
      const s = stats?.get(slug);
      const depth = s
        ? deriveDepthSpread(s.sumBp, s.sumSqBp, c.withState)
        : null;
      return {
        slug,
        label: labels.get(slug) ?? slug,
        mastered: c.mastered,
        total: c.withState,
        meanMastery: depth?.mean ?? null,
        spread: depth?.spread ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.mastered / b.total - a.mastered / a.total ||
        a.label.localeCompare(b.label),
    );
}
