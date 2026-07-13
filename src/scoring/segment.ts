// W2-I: segments a team into an adoption/fluency-derived persona label.
// Thresholds are versioned DATA, not a user-facing rule engine (rule 7) —
// same "not a DSL" posture as score components. Absence handling mirrors
// evaluate.ts's ratio-component honesty rule: missing input means the team
// isn't labeled at all, never defaulted to the lowest bucket.

export type Segment = "skeptic" | "casual" | "power_user" | "ai_native";

export type SegmentThresholds = {
  /** Below this adoption value → 'skeptic'. */
  skepticMaxAdoption: number;
  /** Adoption at/above this, with fluency below fluencyForPowerUser → 'power_user'. */
  powerUserMinAdoption: number;
  /** Fluency below this (given adoption is above the skeptic floor) → 'casual'. */
  casualMaxFluency: number;
  /** Fluency below this (given adoption clears the power-user floor) → 'power_user'; at/above → 'ai_native'. */
  powerUserMaxFluency: number;
};

/** v1, pre-calibration — tune against real dogfooding data (see
 * scripts/calibrate-scores.mjs) before treating these as final. */
export const SEGMENT_THRESHOLDS_V1: SegmentThresholds = {
  skepticMaxAdoption: 25,
  powerUserMinAdoption: 60,
  casualMaxFluency: 50,
  powerUserMaxFluency: 70,
};

/**
 * Classifies a team from its Adoption and Fluency score values. Either input
 * being `null` (no score_results row this period — the score engine never
 * fabricates one, see evaluate.ts) means insufficient data: returns `null`,
 * never a fabricated/defaulted segment (review invariant b, applied one
 * level above the score components themselves).
 */
export function segmentFor(
  adoption: number | null,
  fluency: number | null,
  thresholds: SegmentThresholds = SEGMENT_THRESHOLDS_V1,
): Segment | null {
  if (adoption === null || fluency === null) {
    return null;
  }
  if (fluency >= thresholds.powerUserMaxFluency) {
    return "ai_native";
  }
  if (adoption < thresholds.skepticMaxAdoption) {
    return "skeptic";
  }
  // Remaining space: adoption >= skepticMaxAdoption, fluency < powerUserMaxFluency.
  // Either high adoption OR high fluency alone is enough to count as engaged
  // use ("power user"); low on both is "casual" — no ambiguous fallthrough.
  if (
    adoption >= thresholds.powerUserMinAdoption ||
    fluency >= thresholds.casualMaxFluency
  ) {
    return "power_user";
  }
  return "casual";
}

// W5-A (ADR 0027): the team-level `segmentTeams` org-read helper was removed as
// app-dead — it had zero application callers and only one live consumer,
// scripts/calibrate-scores.ts (offline preset calibration). It was NOT ported
// onto src/lib/segments.ts's person-level `segmentFor` (single-signal adoption
// bands) because that would change what SEGMENT_THRESHOLDS_V1 calibrates (team
// two-signal adoption×fluency), so the calibration path was retired instead.
// The pure `segmentFor` classifier above is kept (unit-tested, the canonical
// thresholds vocabulary for a future re-introduction).
