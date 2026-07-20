// Team capability DEPTH + SPREAD (TMD P3 tail, T3.3). PURE — no I/O. Derives a
// per-capability team MEAN mastery (depth, beyond today's binary
// mastered/developing split) and a SPREAD statistic (population standard
// deviation — how evenly mastery is distributed) from the COUNT-ONLY sufficient
// statistics the reducer and the live dashboard both compute. No per-person
// value or id flows through: the inputs are aggregate sums, the outputs are two
// team-level numbers.

/** Mastery [0,1] × this scale → an exact integer "basis point of 1". The
 * mastery scale is round4, so round(mastery * 10000) never loses precision. */
const BP_SCALE = 10000;

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The basis-point form of one person's mastery — the shared unit the reducer
 * sums into `masterySumBp` / `masterySumSqBp`. Exported so every producer
 * computes the sufficient statistics identically (a shared-source guarantee). */
export function masteryBasisPoints(mastery: number): number {
  return Math.round(mastery * BP_SCALE);
}

export type CapabilityDepthSpread = {
  /** Mean mastery across people-with-state, in [0,1] (round4). */
  mean: number;
  /** Population standard deviation of mastery, in [0,1] (round4). */
  spread: number;
};

/**
 * Reconstruct the team mean + population standard deviation of mastery from the
 * count-only sufficient statistics. `sumBp` / `sumSqBp` are the sum of
 * `masteryBasisPoints(mastery)` and of its square over `n` people-with-state.
 *
 * Returns `null` when the cohort is empty (`n < 1`) or the statistics are absent
 * (older/backfilled history rows carry null) — an honest "no depth data", never
 * a fabricated 0 mean (invariant b). Count-only in and out.
 */
export function deriveDepthSpread(
  sumBp: number | null,
  sumSqBp: number | null,
  n: number,
): CapabilityDepthSpread | null {
  if (sumBp === null || sumSqBp === null || n < 1) return null;
  const meanBp = sumBp / n;
  // Population variance = E[x²] − E[x]²; clamp tiny negative floating-point
  // noise (when every value is equal) to 0 before the square root.
  const varianceBp2 = Math.max(0, sumSqBp / n - meanBp * meanBp);
  const spreadBp = Math.sqrt(varianceBp2);
  return {
    mean: round4(meanBp / BP_SCALE),
    spread: round4(spreadBp / BP_SCALE),
  };
}
