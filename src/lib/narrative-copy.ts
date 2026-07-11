// F2.4 narrative + correlation COPY (research I7/I4). Glossary-style constants
// module, in the metrics-glossary.ts tradition (G7): every user-facing sentence
// the period summary and "moved together" panel render is a template FUNCTION
// here — the composer (src/lib/narrative.ts) and the card only pick a template
// and fill measured values, they never assemble prose inline. One place to
// fact-check, one place the adversarial content reviewer reads.
//
// Two hard copy rules this module is the guardrail for:
//  - NON-CAUSAL. Correlation copy states that two measures moved the same way,
//    never that one changed the other. The causal-verb list below is swept over
//    every string this module can emit (see tests/narrative.test.ts,
//    tests/correlation.test.ts).
//  - CONFIDENCE-DISCIPLINED (G2). Measured inputs state plainly ("12 people were
//    active"); derived/directional inputs keep their qualifier ("worth a look",
//    "directional") so the reader never mistakes a directional signal for a
//    measured fact.

import type { CorrelationPairKey } from "./correlation";

/** Causal phrasings banned from EVERY narrative + correlation string. A
 * "moved together" panel that implied causation would be the exact invariant-b
 * overclaim the plan calls out (I4 must stay directional). Swept in tests. */
export const CAUSAL_BANNED_PHRASES = [
  "causes",
  "caused",
  "causing",
  "cause of",
  "drives",
  "drove",
  "driving",
  "driven by",
  "because",
  "leads to",
  "led to",
  "results in",
  "resulting in",
  "thanks to",
  "due to",
  "as a result",
] as const;

/** Pseudo-statistics phrasings banned from correlation copy specifically — the
 * plan forbids dressing a same-direction share as a coefficient or a
 * significance claim. */
export const CORRELATION_BANNED_PHRASES = [
  "correlation",
  "correlated",
  "correlate",
  "coefficient",
  "statistically",
  "significant",
  "predicts",
  "predict",
  "r =",
  "p <",
] as const;

/** UTC "Jun 30" day label — the one date format narrative prose uses. */
export function narrativeDayLabel(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "the last 4 weeks" / "the last week" / "the last 10 days" — a plain-English
 * period phrase from a day count. Whole-week counts read as weeks (the movement
 * window is 28d = 4 weeks); anything else stays in days. */
export function narrativePeriodPhrase(periodDays: number): string {
  if (periodDays % 7 === 0) {
    const weeks = periodDays / 7;
    return weeks === 1 ? "the last week" : `the last ${weeks} weeks`;
  }
  return `the last ${periodDays} days`;
}

/** Whole-dollar approximation for narrative prose ("$190", not "$190.00") —
 * a summary sentence rounds to dollars; the exact figure lives on the spend
 * card. */
export function narrativeApproxDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Period-summary sentence templates (I7). Each is MEASURED unless its name says
 * otherwise. `first` variants are the honest "first period we can measure"
 * states — never a fabricated comparison. Directional inputs (spikes, plateaus)
 * carry a "worth a look" hedge, per G2.
 */
export const NARRATIVE_COPY = {
  /** Lead: active-people count with a real prior-period comparison. */
  activityDelta: (p: {
    period: string;
    people: number;
    direction: "up" | "down";
    previous: number;
  }): string =>
    `Over ${p.period}, ${p.people} ${plural(p.people, "person", "people")} ${
      p.people === 1 ? "was" : "were"
    } active on AI tools (${p.direction} from ${p.previous}).`,
  /** Lead: active-people count that is flat vs the prior period. */
  activitySteady: (p: { period: string; people: number }): string =>
    `Over ${p.period}, ${p.people} ${plural(p.people, "person", "people")} ${
      p.people === 1 ? "was" : "were"
    } active on AI tools — about the same as the period before.`,
  /** Lead: first measurable period — no comparison exists yet. */
  activityFirst: (p: { period: string; people: number }): string =>
    `Over ${p.period}, ${p.people} ${plural(p.people, "person", "people")} ${
      p.people === 1 ? "was" : "were"
    } active on AI tools — the first period we can measure.`,
  /** Agentic adoption share (measured — stated plainly). */
  agentic: (p: { ratePct: number }): string =>
    `Agentic tools were used on ${p.ratePct}% of active days.`,
  /** Spend movement with a real prior-period comparison. */
  spendDelta: (p: {
    amount: string;
    direction: "up" | "down";
    previous: string;
  }): string =>
    `Spend ${p.direction === "up" ? "rose" : "fell"} to around ${p.amount}, ${
      p.direction
    } from ${p.previous} the period before.`,
  /** Spend flat vs the prior period. */
  spendSteady: (p: { amount: string }): string =>
    `Spend held steady around ${p.amount}.`,
  /** First measurable spend period. */
  spendFirst: (p: { amount: string }): string =>
    `Spend over the period was around ${p.amount}.`,
  /** Directional notable event — a spike. Hedged ("worth a look"), and phrased
   * as an observation, never a cause. */
  notableSpike: (p: {
    subject: string;
    multiple: number;
    day: string;
  }): string =>
    `One thing worth a look: ${p.subject} rose to about ${p.multiple}× your usual on ${p.day}.`,
  /** Directional notable event — a plateau. */
  notablePlateau: (p: { subject: string }): string =>
    `One thing worth a look: ${p.subject} has flattened out recently.`,
  /** Close: attribution coverage improving (measured). */
  closeAttributionUp: (p: {
    currentPct: number;
    previousPct: number;
  }): string =>
    `Coverage is improving too — ${p.currentPct}% of usage is now attributed to a specific person, up from ${p.previousPct}%.`,
} as const;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Plain labels for each fixed correlation pair — the two measures and the
 * joint subject the "moved together" line names. */
export const CORRELATION_PAIR_LABELS: Record<
  CorrelationPairKey,
  { joint: string }
> = {
  active_people__spend: { joint: "Active people and spend" },
  agentic_share__prompts: { joint: "Agentic usage and prompt volume" },
  active_people__prompts: { joint: "Active people and prompt volume" },
};

/**
 * "Moved together" panel copy (I4). Rigorously directional and non-causal: it
 * reports how often two measures moved the SAME way week-over-week, and the
 * disclaimer states outright that this is not cause and effect.
 */
export const CORRELATION_COPY = {
  title: "Moved together",
  intro:
    "How often these pairs moved the same way, week to week — directional only.",
  /** One measured pair line. Reads "in N of M recent weeks" — a week here means
   * a week-over-week change (the transition attributed to the later week). */
  measuredLine: (p: {
    joint: string;
    agreeing: number;
    comparable: number;
  }): string =>
    `${p.joint} moved the same way in ${p.agreeing} of ${p.comparable} recent weeks.`,
  /** Shown when no pair has enough overlapping weeks yet. */
  insufficient:
    "Not enough overlapping weeks yet to compare how these measures move together.",
  /** The standing non-causal disclaimer under the panel. */
  disclaimer:
    "Directional only: this shows weeks two measures moved the same way, not that one moved the other.",
} as const;
