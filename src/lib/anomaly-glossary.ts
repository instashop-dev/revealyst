import { ANOMALY_BASELINE_DAYS, type SpikeMetric, type SpikeSignal } from "./anomaly";
import type { PlateauResult } from "./plateau";

// F2.3 copy — the ONE source of truth for anomaly/plateau attention-item text
// (G7: prose is a claim surface; copy lives in a glossary-style constant module
// shared across surfaces). No React, no I/O.
//
// Copy discipline (invariant b): every string here is DIRECTIONAL. A spike is
// "unusual versus your baseline" and "worth a look" — never "wrong", never a
// verdict, never a benchmark/threshold stated as fact. The baseline is always
// the org's OWN recent history, so no cross-org comparison language appears
// (nothing here matches tests/helpers/banned-phrasing.ts).

/** The shared directional caveat appended to every anomaly/plateau body — the
 * reader must always know this is a flag for a human to judge, not a fault. */
export const ANOMALY_DIRECTIONAL_NOTE =
  "This is unusual versus your own recent baseline — worth a look, not necessarily a problem.";

const METRIC_LABEL: Record<SpikeMetric, string> = {
  spend: "Spend",
  prompts: "Prompt volume",
};

/** Lower-case noun for mid-sentence use. */
const METRIC_NOUN: Record<SpikeMetric, string> = {
  spend: "spend",
  prompts: "prompt volume",
};

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Renders "2.4×" (drops a trailing ".0" so a clean 3× reads "3×"). */
function factorText(factor: number): string {
  const rounded = Math.round(factor * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}×` : `${rounded}×`;
}

export type AttentionCopy = { title: string; body: string };

/**
 * Attention-item copy for a detected spike. Title names the metric and the
 * "N× your baseline" figure (the I2 headline); body dates the day, states the
 * factor against the org's own trailing average, and carries the directional
 * caveat. Never asserts the day was wrong or over-budget — only unusual.
 *
 * BASELINE PHRASING (review F3 — a rendered claim): `baselineDays` is the
 * count of MEASURED days (days that actually had data) inside the trailing
 * {@link ANOMALY_BASELINE_DAYS}-calendar-day window — not a count of calendar
 * days. "your average over the previous N days" therefore overstated the
 * factor whenever the window was sparse (a 14-measured-day baseline read as a
 * 14-calendar-day one). The copy now says exactly what the denominator is:
 * the days WITH data, inside the fixed 4-week window.
 */
export function spikeAttentionCopy(signal: SpikeSignal): AttentionCopy {
  const label = METRIC_LABEL[signal.metric];
  const noun = METRIC_NOUN[signal.metric];
  const factor = factorText(signal.factor);
  const weeks = ANOMALY_BASELINE_DAYS / 7;
  return {
    title: `${label} is ${factor} your recent baseline`,
    body: `On ${dayLabel(signal.day)}, ${noun} was about ${factor} your average across the ${signal.baselineDays} days with ${noun} in the last ${weeks} weeks. ${ANOMALY_DIRECTIONAL_NOTE}`,
  };
}

/**
 * Attention-item copy for a detected plateau. Frames a declining active-people
 * cohort as "worth a look", states the measured decline over the run of weeks,
 * and stays non-causal — it reports the shape, never why.
 *
 * RUN-LENGTH PHRASING (review F7): `decliningWeeks` is CALENDAR weeks from
 * the peak to the latest complete week (zero weeks included, per the F1
 * measured-zero materialization) — and a collapse can flatten at zero, where
 * "fell for N straight weeks" would misdescribe the equal-at-zero tail. The
 * copy states the drop OVER the span ("in the N weeks since"), which is true
 * for both a strict slide and a flatten-at-zero collapse.
 */
export function plateauAttentionCopy(
  plateau: Extract<PlateauResult, { kind: "plateau" }>,
): AttentionCopy {
  return {
    title: "Fewer people are using AI week over week",
    body: `Active people are down about ${plateau.declinePct}% in the ${plateau.decliningWeeks} weeks since a recent peak the week of ${plateau.peak.label}, with no week-over-week recovery in that stretch. Adoption slipping after a peak is worth a look; it's a directional signal from your own weekly trend, not a verdict.`,
  };
}
