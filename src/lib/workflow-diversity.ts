// W5-E deliverable (3): workflow diversity as a first-class SURFACED signal.
//
// A read-time statistic over `feature_used` rows — the count of distinct
// features a subject (or subject set) actually touched — plus a milestone
// comparator hook the milestones workstream (W5-F) consumes. NO new metric key,
// NO new storage: it re-reads the same `feature_used` dims the scoring engine
// already aggregates, so it is the "middle option consistent with no new
// engines".
//
// The distinct-count semantics MATCH the engine exactly (src/scoring/
// evaluate.ts `distinct_dims`): count DISTINCT NON-EMPTY dim values, unioned
// across the rows passed in. That parity is deliberate — the surfaced "N
// workflows" number must equal what the Adoption tool_coverage / Fluency
// breadth components score on, or the two would tell different stories.
//
// Honesty (invariant b): absence is not zero-filled here either — a subject
// with no feature_used rows has `distinctCount: 0` only because no distinct dim
// exists, never a fabricated floor. The comparator's `isNewBest` mirrors the
// digest's strict `>` (a tie is not a new best).

/** A `feature_used` row reduced to what the diversity stat needs. Callers pass
 * rows they already have (metricKey === "feature_used"), with the raw `dim`
 * (e.g. "feature=chat"). */
export type FeatureUsedRow = { dim: string };

export type WorkflowDiversity = {
  /** Distinct non-empty feature dims — the surfaced "N workflows" number. */
  distinctCount: number;
  /** Sorted, de-duplicated feature labels (the `feature=` prefix stripped for
   * display); empty dims are excluded. */
  features: string[];
};

/** The `feature=` dim prefix the connectors emit. Stripped for the surfaced
 * label; a dim without it is kept verbatim (defensive — never throws). */
const FEATURE_PREFIX = "feature=";

/**
 * Compute the workflow-diversity stat for a set of `feature_used` rows. Pure
 * and deterministic. Rows with an empty dim are ignored (matching the engine's
 * `dim !== ""` filter), so a plain activity row never inflates the count.
 */
export function workflowDiversity(
  rows: readonly FeatureUsedRow[],
): WorkflowDiversity {
  const dims = new Set<string>();
  for (const row of rows) {
    if (row.dim !== "") dims.add(row.dim);
  }
  const features = [...dims]
    .map((d) => (d.startsWith(FEATURE_PREFIX) ? d.slice(FEATURE_PREFIX.length) : d))
    .sort();
  return { distinctCount: dims.size, features };
}

/** Default milestone thresholds for feature breadth — the "you now use N
 * distinct workflows" ladder the milestones workstream surfaces. Ascending,
 * de-duplicated by construction. Overridable by the caller. */
export const DEFAULT_DIVERSITY_MILESTONES = [2, 3, 5, 8] as const;

export type DiversityComparison = {
  current: number;
  previous: number;
  /** current − previous (may be negative — surfaced honestly, never floored). */
  delta: number;
  /** Strict new high, mirroring the digest's `isNewBest` (a tie is not new). */
  isNewBest: boolean;
  /** The highest milestone threshold newly reached this period (current ≥ T and
   * previous < T), or null if none crossed. The milestone hook. */
  crossedMilestone: number | null;
};

/**
 * Compare a subject's current workflow-diversity count against a prior baseline
 * — the milestone comparator hook W5-F consumes. Pure; no I/O, no clock, no
 * storage. `previous` is whatever baseline the caller already has (last
 * period's count, or 0 for a first-ever read).
 */
export function compareWorkflowDiversity(
  current: number,
  previous: number,
  milestones: readonly number[] = DEFAULT_DIVERSITY_MILESTONES,
): DiversityComparison {
  let crossedMilestone: number | null = null;
  for (const t of milestones) {
    if (current >= t && previous < t && (crossedMilestone === null || t > crossedMilestone)) {
      crossedMilestone = t;
    }
  }
  return {
    current,
    previous,
    delta: current - previous,
    isNewBest: current > previous,
    crossedMilestone,
  };
}
