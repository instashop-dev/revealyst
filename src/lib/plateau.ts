import { isChannelStale } from "./anomaly";
import type { ConnectionChannelInput } from "./onboarding-guide";
import { MIN_PEOPLE_FOR_BASELINE, type WeeklyActivePoint } from "./usage-baselines";

// F2.3 / research I3 — the falling-threshold cohort detector (the MIT
// learning-gap pattern): weekly active-people declining across ≥ N consecutive
// COMPLETE weeks after an initial adoption peak → a plateau/regression worth a
// human look. Pure derivation over the M8 weekly retention curve
// (usage-baselines.ts). No React, no I/O.
//
// Copy discipline (G7 / invariant b): thresholds here are UNCALIBRATED — the
// result is labeled *directional* and framed "worth a look", NEVER a verdict.
// See anomaly-glossary.ts for the rendered copy.
//
// Honesty rules:
//  - Reasons over COMPLETE, fully-covered calendar weeks with activity-less
//    weeks materialized as measured zeros (the caller passes
//    `materializeMeasuredZeroWeeks`) — a partial current week or a truncated
//    leading week is not a falling cohort, and a TOTAL collapse (weeks with
//    ZERO active people) must register as the steepest fall of all, not
//    vanish from the series (review F1: everyone quitting fired nothing when
//    zero weeks were simply omitted).
//  - Measures the active-PEOPLE COUNT, not a "share". A share would need a
//    total-people denominator; counting people who were actually active is a
//    measured quantity with an honest floor of zero (fewer people using AI IS
//    a real, knowable regression). NOTE this is deliberately a count, not the
//    "share" the research shorthand names.
//  - Needs an actual peak WITH a rise into it (peak not the first week) and a
//    sustained, never-recovering slide — a noisy flat series never trips it.
//    The slide is NON-INCREASING, not strictly decreasing: a collapse that
//    flattens at zero (…8 → 0 → 0 → 0) is still a collapse, and the
//    total-decline floor keeps an all-equal run (0% drop) from firing.
//  - G5 staleness: a stale org's recent weeks are missing, not collapsing —
//    suppressed (shares `isChannelStale` with the anomaly surface). This gate
//    is also what makes the materialized zero weeks MEASURED zeros: under a
//    fresh, successfully-syncing channel, "no active person-days that week"
//    is a fact, not a data gap.
//  - Fewer than {@link MIN_PEOPLE_FOR_BASELINE} people at the peak → the curve
//    is too small to read a trend from (and risks de-anonymizing) → not shown.

/** Complete calendar weeks (after the peak, through the latest week, with no
 * recovery) required to call a plateau. Three weeks distinguishes a sustained
 * slide from a one-off dip; the run spans a peak week + ≥3 no-higher weeks
 * (zero weeks included — see the module header). */
export const PLATEAU_MIN_WEEKS = 3;

/** The cohort must have shrunk by at least this fraction from its peak to the
 * latest week — a floor that keeps a trivial "10 → 9 people" wobble from
 * reading as a regression. Uncalibrated presentational threshold. */
export const PLATEAU_MIN_TOTAL_DECLINE_PCT = 20;

export type PlateauPoint = {
  weekStart: string;
  label: string;
  activePeople: number;
};

export type PlateauResult =
  | {
      kind: "plateau";
      /** The peak week the decline is measured from. */
      peak: PlateauPoint;
      /** The latest complete week. */
      latest: PlateauPoint;
      /** CALENDAR weeks from the peak to the latest week (the length of the
       * no-recovery run, zero weeks included — review F7: the copy must state
       * the true run length, not just the strictly-falling steps). */
      decliningWeeks: number;
      /** Percent drop from peak to latest, rounded to a whole number. */
      declinePct: number;
    }
  | { kind: "none" }
  | { kind: "insufficient"; completeWeeks: number }
  | { kind: "suppressed"; reason: "stale" };

function toPoint(w: WeeklyActivePoint): PlateauPoint {
  return { weekStart: w.weekStart, label: w.label, activePeople: w.activePeople };
}

/**
 * Detects a plateau/regression from the COMPLETE weekly retention curve
 * (measured zeros materialized).
 *
 * Algorithm: take the peak (max active-people) week; require a rise into it
 * (peak is not the first week) and a peak cohort of at least
 * {@link MIN_PEOPLE_FOR_BASELINE}; from the peak to the latest week require a
 * NON-INCREASING run of at least {@link PLATEAU_MIN_WEEKS} calendar weeks
 * ending at the latest week, with a total drop of at least
 * {@link PLATEAU_MIN_TOTAL_DECLINE_PCT}. Any break in the run (a week that
 * rose vs the prior) means the cohort recovered — not a plateau. Equal steps
 * are allowed so a collapse that flattens at zero still counts; an all-equal
 * run has a 0% total drop and never clears the decline floor.
 */
export function detectPlateau(input: {
  /** COMPLETE weekly points with measured zeros materialized, chronological —
   * pass `materializeMeasuredZeroWeeks(baselines)`. */
  weeklyActive: readonly WeeklyActivePoint[];
  /** For the G5 staleness gate. */
  connections: readonly ConnectionChannelInput[];
  /** Today's UTC date (`YYYY-MM-DD`) — for staleness only. */
  today: string;
}): PlateauResult {
  if (isChannelStale(input.connections, input.today)) {
    return { kind: "suppressed", reason: "stale" };
  }

  const weeks = input.weeklyActive;
  // Need a peak plus at least PLATEAU_MIN_WEEKS lower weeks after it.
  if (weeks.length < PLATEAU_MIN_WEEKS + 1) {
    return { kind: "insufficient", completeWeeks: weeks.length };
  }

  // Peak = the FIRST week that reaches the max active-people count (earliest
  // peak gives the decline the longest run to be measured over).
  let peakIdx = 0;
  for (let i = 1; i < weeks.length; i += 1) {
    if (weeks[i].activePeople > weeks[peakIdx].activePeople) peakIdx = i;
  }
  const peak = weeks[peakIdx];

  // A rise INTO the peak: the peak can't be the very first week (no adoption
  // ramp to plateau from).
  if (peakIdx === 0) return { kind: "none" };
  if (peak.activePeople < MIN_PEOPLE_FOR_BASELINE) return { kind: "none" };

  // Non-increasing run from the peak to the latest week. Equal steps stay in
  // the run (a collapse flattening at zero is still a collapse — review F1);
  // any RISE is a recovery and breaks the plateau. The run length is counted
  // in calendar weeks since the peak (review F7 — the rendered "N weeks"
  // must be the true span, zero weeks included).
  for (let i = peakIdx + 1; i < weeks.length; i += 1) {
    if (weeks[i].activePeople > weeks[i - 1].activePeople) {
      return { kind: "none" }; // a recovery breaks the plateau
    }
  }
  const decliningWeeks = weeks.length - 1 - peakIdx;
  if (decliningWeeks < PLATEAU_MIN_WEEKS) return { kind: "none" };

  const latest = weeks[weeks.length - 1];
  const declinePct = Math.round(
    ((peak.activePeople - latest.activePeople) / peak.activePeople) * 100,
  );
  if (declinePct < PLATEAU_MIN_TOTAL_DECLINE_PCT) return { kind: "none" };

  return {
    kind: "plateau",
    peak: toPoint(peak),
    latest: toPoint(latest),
    decliningWeeks,
    declinePct,
  };
}
