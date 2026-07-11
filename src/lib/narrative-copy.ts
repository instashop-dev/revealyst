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
 * overclaim the plan calls out (I4 must stay directional). Swept in tests —
 * the sweep covers every template here AND the card copy exported below
 * (NARRATIVE_CARD_COPY), so the rendered card can't drift causal either. */
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
  "explains",
  "impact of",
  "boosted",
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
  /** Agentic adoption share (measured — stated plainly). WINDOW-HONEST: the
   * rate is computed over its own window (12 weeks — AGENTIC_WINDOW_DAYS),
   * NOT the 4-week movement period the lead sentence covers, so the sentence
   * must name its window or the paragraph frames an 84-day figure as a
   * 28-day one (review F1). */
  agentic: (p: { window: string; ratePct: number }): string =>
    `Over ${p.window}, agentic tools were used on ${p.ratePct}% of active days.`,
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
  /** Directional notable event — a spike. Hedged (a "worth a look" lead), and
   * phrased as an observation, never a cause. The multiple is rounded to one
   * decimal IN the template (review F5) — a caller passing 2.3777 must never
   * render "2.3777×". */
  notableSpike: (p: {
    lead: string;
    subject: string;
    multiple: number;
    day: string;
  }): string =>
    `${p.lead}: ${p.subject} rose to about ${round1(p.multiple)}× your usual on ${p.day}.`,
  /** Directional notable event — a plateau. Takes the human LABEL (from
   * PLATEAU_SUBJECT_LABELS), never a raw signal key (review F2). */
  notablePlateau: (p: { lead: string; subjectLabel: string }): string =>
    `${p.lead}: ${p.subjectLabel} has flattened out recently.`,
  /** Close: attribution coverage improving (measured). WINDOW-HONEST (review
   * F1): currentPct is the LATEST WEEK's share and previousPct the earliest
   * displayed week's — the attribution-trend contract requires rendering the
   * absolute previous week date, never a bare "up from N%". */
  closeAttributionUp: (p: {
    currentPct: number;
    previousPct: number;
    previousWeekLabel: string;
  }): string =>
    `Coverage is improving too — in the latest measured week, ${p.currentPct}% of usage was attributed to a specific person, up from ${p.previousPct}% the week of ${p.previousWeekLabel}.`,
  /** Close: attribution coverage declining (measured) — the honest symmetric
   * counterpart (review F8): a close that only ever reports improvement would
   * be structurally good-news-only. Same weekly basis and dated comparison. */
  closeAttributionDown: (p: {
    currentPct: number;
    previousPct: number;
    previousWeekLabel: string;
  }): string =>
    `Coverage slipped — in the latest measured week, ${p.currentPct}% of usage was attributed to a specific person, down from ${p.previousPct}% the week of ${p.previousWeekLabel}.`,
} as const;

/** Round to one decimal for prose ("2.4", "3") — trailing ".0" dropped by
 * number formatting. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Sentence leads for notable events: only the FIRST event may claim "One
 * thing" — a second "One thing worth a look" in the same paragraph claims
 * singularity twice (review F3). */
export const NOTABLE_EVENT_LEADS = {
  first: "One thing worth a look",
  subsequent: "Also worth a look",
} as const;

/** The typed plateau subjects narrative prose can name. The KEY is the wire
 * format callers pass (kept stable — the F2.3 integration wiring passes
 * "active-people" verbatim); the value is the human phrase rendered in prose.
 * A raw signal key must never reach a rendered sentence (review F2). */
export const PLATEAU_SUBJECT_LABELS = {
  "active-people": "the number of active people",
} as const;

export type PlateauSubjectKey = keyof typeof PLATEAU_SUBJECT_LABELS;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Card-level copy for the period-summary surface — exported from here (not
 * hardcoded in the component) so the banned-phrase sweeps cover every rendered
 * string (review F6). CLAIM DISCIPLINE (review F7): the description does NOT
 * say "no estimates" — a notable-event sentence can carry a baseline-derived
 * multiple ("about 2.4× your usual"), which is a measured-baseline derivation,
 * not a raw measurement. "No forecasts" is the claim the surface actually
 * keeps (nothing here projects forward).
 */
export const NARRATIVE_CARD_COPY = {
  title: "Period summary",
  description:
    "Composed from your measured metrics and their measured baselines — no forecasts.",
  empty:
    "A plain-English summary of the recent period appears here once there's enough measured activity — active people, spend, and agentic usage over a few complete weeks. No forecasts, and nothing is shown until it's measured.",
} as const;

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
