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
};

/**
 * Build the floored, labelled, sorted coverage rows from the count-only
 * `coverageCounts` map + the global capability-label map. Ordered by mastery
 * share descending, then label — deterministic. Pure.
 */
export function buildCapabilityCoverage(
  counts: ReadonlyMap<string, { mastered: number; withState: number }>,
  labels: ReadonlyMap<string, string>,
  minPeople: number = SEGMENT_MIN_PEOPLE_TO_NAME,
): CapabilityCoverageRow[] {
  return [...counts.entries()]
    .filter(([, c]) => c.withState >= minPeople)
    .map(([slug, c]) => ({
      slug,
      label: labels.get(slug) ?? slug,
      mastered: c.mastered,
      total: c.withState,
    }))
    .sort(
      (a, b) =>
        b.mastered / b.total - a.mastered / a.total ||
        a.label.localeCompare(b.label),
    );
}
