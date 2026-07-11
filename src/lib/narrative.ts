// F2.4 "Monthly narrative" (research I7) — a 3–6 sentence plain-prose summary
// of the recent period, composed from typed template fragments (narrative-copy
// NARRATIVE_COPY). Pure, no React, no I/O, NO LLM (G6 — static template
// composition over measured derivations; an LLM-written variant is out of
// scope). The composer only ever PICKS a template and fills it with a measured
// value — it never invents a sentence or a comparison.
//
// Honesty (invariant b / G2 / G4): every sentence comes from a measured input
// with an honest kind. A `first` input yields the honest "first period we can
// measure" state; a `notComparable`/`noData` input yields NO sentence, never a
// fabricated "up from". Measured inputs (activity counts, spend, agentic share,
// attribution) state plainly; directional inputs (spikes, plateaus) keep their
// "worth a look" hedge. Aggregate-only — no named individual ever appears.
//
// Notable events (spike/plateau) are an OPTIONAL, forward-compatible input:
// F2.3's anomaly/plateau derivations are not yet on the dashboard view in this
// phase, so the live page passes none. When they land, they map into
// `NarrativeNotableEvent` and flow through unchanged — the composer already
// orders and hedges them.

import { AGENTIC_WINDOW_DAYS, type AgenticAdoption } from "./agentic-adoption";
import type { AttributionTrend } from "./attribution-trend";
import {
  NARRATIVE_COPY,
  NOTABLE_EVENT_LEADS,
  PLATEAU_SUBJECT_LABELS,
  narrativeApproxDollars,
  narrativeDayLabel,
  narrativePeriodPhrase,
  type PlateauSubjectKey,
} from "./narrative-copy";
import type { MovementMetricKey, RecentMovement } from "./recent-movement";

/** A directional, "worth a look" event the narrative closes its body with.
 * Kept structurally decoupled from F2.3's anomaly/plateau result types so this
 * module doesn't depend on unmerged code — the caller maps into this shape.
 * A plateau's `subject` is a TYPED wire-format key (e.g. "active-people",
 * exactly what the F2.3 integration wiring passes), resolved to a human label
 * in the template — a raw signal key must never reach rendered prose
 * (review F2). */
export type NarrativeNotableEvent =
  | { kind: "spike"; subject: string; multiple: number; onDate: string }
  | { kind: "plateau"; subject: PlateauSubjectKey };

export type NarrativeInputs = {
  /** The 28-day recent-movement result (F1.2) — the activity + spend leads. */
  movement: RecentMovement;
  /** Agentic-adoption view (F1.4) — the agentic sentence. */
  agentic: AgenticAdoption;
  /** Attribution-coverage trend (F1.7) — the optional improving-coverage close. */
  attribution?: AttributionTrend;
  /** Optional directional events (F2.3, when available). At most two are used. */
  notableEvents?: readonly NarrativeNotableEvent[];
  /** Hard sentence cap (order-priority; the tail — close, then events — drops
   * first). Defaults to MAX_NARRATIVE_SENTENCES. */
  maxSentences?: number;
};

export type Narrative = {
  /** Ordered, capped sentences. Empty when nothing is measurable — the card
   * then renders an honest empty state, never a teaser. */
  sentences: string[];
};

/** Cap: a summary, not a report. Order is activity → agentic → spend → notable
 * events → close, so a tail-slice drops the close first. */
export const MAX_NARRATIVE_SENTENCES = 6;

/** At most this many directional events in the body — more buries the summary. */
const MAX_NOTABLE_EVENTS = 2;

function metric(movement: RecentMovement, key: MovementMetricKey) {
  return movement.metrics.find((m) => m.key === key);
}

/**
 * Composes the period-summary sentences. Order: activity lead → agentic →
 * spend → notable events → close. Each block appends a sentence ONLY when its
 * input is measurable with an honest kind; otherwise it is silently skipped
 * (never fabricated). The result is capped to `maxSentences`.
 */
export function composeNarrative(inputs: NarrativeInputs): Narrative {
  const sentences: string[] = [];
  const period = narrativePeriodPhrase(inputs.movement.periodDays);

  // ── 1. Activity lead (active people) ──
  const people = metric(inputs.movement, "active_people");
  if (people) {
    const d = people.delta;
    if (d.kind === "delta") {
      const rounded = Math.round(d.delta);
      if (rounded === 0) {
        sentences.push(
          NARRATIVE_COPY.activitySteady({ period, people: people.current }),
        );
      } else {
        sentences.push(
          NARRATIVE_COPY.activityDelta({
            period,
            people: people.current,
            direction: rounded > 0 ? "up" : "down",
            previous: Math.round(d.previous),
          }),
        );
      }
    } else if (d.kind === "first") {
      sentences.push(
        NARRATIVE_COPY.activityFirst({ period, people: people.current }),
      );
    }
    // notComparable (noData) → no activity sentence.
  }

  // ── 2. Agentic adoption (measured only) ──
  if (inputs.agentic.kind === "measured") {
    // WINDOW-HONEST (review F1): the agentic rate covers its OWN 12-week
    // window (AGENTIC_WINDOW_DAYS), not the 4-week movement period the lead
    // sentence names — the sentence states its window explicitly so an 84-day
    // figure is never framed as a 28-day one.
    sentences.push(
      NARRATIVE_COPY.agentic({
        window: narrativePeriodPhrase(AGENTIC_WINDOW_DAYS),
        ratePct: Math.round(inputs.agentic.ratePct),
      }),
    );
  }

  // ── 3. Spend ──
  const spend = metric(inputs.movement, "reported_spend");
  if (spend) {
    const d = spend.delta;
    if (d.kind === "delta") {
      const rounded = Math.round(d.delta);
      if (rounded === 0) {
        // A flat spend at zero is "no spend", not "steady around $0".
        if (spend.current > 0) {
          sentences.push(
            NARRATIVE_COPY.spendSteady({
              amount: narrativeApproxDollars(spend.current),
            }),
          );
        }
      } else {
        sentences.push(
          NARRATIVE_COPY.spendDelta({
            amount: narrativeApproxDollars(spend.current),
            direction: rounded > 0 ? "up" : "down",
            previous: narrativeApproxDollars(d.previous),
          }),
        );
      }
    } else if (d.kind === "first" && spend.current > 0) {
      sentences.push(
        NARRATIVE_COPY.spendFirst({
          amount: narrativeApproxDollars(spend.current),
        }),
      );
    }
    // notComparable / zero spend → no spend sentence.
  }

  // ── 4. Notable events (directional — hedged) ──
  // Only the FIRST event claims "One thing worth a look" — a second identical
  // lead would claim singularity twice in one paragraph (review F3).
  const events = (inputs.notableEvents ?? []).slice(0, MAX_NOTABLE_EVENTS);
  events.forEach((event, i) => {
    const lead =
      i === 0 ? NOTABLE_EVENT_LEADS.first : NOTABLE_EVENT_LEADS.subsequent;
    if (event.kind === "spike") {
      sentences.push(
        NARRATIVE_COPY.notableSpike({
          lead,
          subject: event.subject,
          multiple: event.multiple,
          day: narrativeDayLabel(event.onDate),
        }),
      );
    } else {
      sentences.push(
        NARRATIVE_COPY.notablePlateau({
          lead,
          subjectLabel: PLATEAU_SUBJECT_LABELS[event.subject],
        }),
      );
    }
  });

  // ── 5. Close (attribution coverage — measured, symmetric) ──
  // BOTH directions render (review F8): a close that only ever reported
  // improvement would be structurally good-news-only. Endpoints are weekly
  // shares; the previous week is named by its absolute date, per the
  // attribution-trend contract (review F1). A zero delta yields no close.
  if (
    inputs.attribution?.kind === "measured" &&
    inputs.attribution.delta.kind === "delta" &&
    inputs.attribution.delta.deltaPct !== 0
  ) {
    const d = inputs.attribution.delta;
    const args = {
      currentPct: Math.round(d.currentPct),
      previousPct: Math.round(d.previousPct),
      previousWeekLabel: narrativeDayLabel(d.previousWeekStart),
    };
    sentences.push(
      d.deltaPct > 0
        ? NARRATIVE_COPY.closeAttributionUp(args)
        : NARRATIVE_COPY.closeAttributionDown(args),
    );
  }

  const cap = inputs.maxSentences ?? MAX_NARRATIVE_SENTENCES;
  return { sentences: sentences.slice(0, cap) };
}
