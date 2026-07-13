// The same-click reward (W5-G / Spec §10): a same-day score recompute is
// structurally impossible (it anchors on the PREVIOUS UTC day), so the
// payoff at sync time is composed from data ALREADY computed — the server's
// echoed counts plus one honest superlative drawn from the batch the CLI
// just built on-device. No network, no clock, pure over its inputs.
//
// HONESTY GATE (invariant b, mirrored from the app's EmptyState rule): the
// "one thing you did well" line is emitted ONLY when the data genuinely
// supports a superlative. Thin data (a single active day, a single model)
// yields `positive: null` — the caller then prints just the factual
// headline, never a fabricated compliment.

import type { AgentIngestRequest, DateWindow } from "./types";

/** Superlatives computed from the just-built batch — all on-device, all
 * already aggregated by `summarize`. */
export type SyncHighlights = {
  /** Distinct calendar days with at least one metric record. */
  activeDays: number;
  /** Distinct models seen (from `model=<id>` record dims). */
  distinctModels: number;
  /** The day carrying the most records, or null when there are none. */
  busiestDay: string | null;
  /** Max peak-concurrency across day signals, or null when unknown. */
  peakConcurrency: number | null;
};

export function summarizeBatchHighlights(
  batch: AgentIngestRequest,
): SyncHighlights {
  const recordsByDay = new Map<string, number>();
  const models = new Set<string>();
  for (const r of batch.records) {
    recordsByDay.set(r.day, (recordsByDay.get(r.day) ?? 0) + 1);
    if (r.dim.startsWith("model=")) {
      models.add(r.dim.slice("model=".length));
    }
  }

  let busiestDay: string | null = null;
  let busiestCount = -1;
  // Iterate sorted so ties resolve to the earliest day, deterministically.
  for (const day of [...recordsByDay.keys()].sort()) {
    const count = recordsByDay.get(day)!;
    if (count > busiestCount) {
      busiestCount = count;
      busiestDay = day;
    }
  }

  let peakConcurrency: number | null = null;
  for (const s of batch.signals) {
    if (s.peakConcurrency != null) {
      peakConcurrency = Math.max(peakConcurrency ?? 0, s.peakConcurrency);
    }
  }

  return {
    activeDays: recordsByDay.size,
    distinctModels: models.size,
    busiestDay,
    peakConcurrency,
  };
}

export type SyncRewardInput = {
  /** Echoed straight from the server ingest response. */
  records: number;
  signals: number;
  subjects: number;
  /** The PINNED window the CLI pushed (batch.window). */
  window: DateWindow;
  highlights: SyncHighlights;
};

export type SyncReward = {
  /** Always factual: the counts and window. */
  headline: string;
  /** The honest "one thing you did well" — null on thin data. */
  positive: string | null;
};

/** Compose the reward. `headline` is always the plain-fact count line;
 * `positive` is the honesty-gated superlative. */
export function composeSyncReward(input: SyncRewardInput): SyncReward {
  const { records, window, highlights } = input;
  const days = highlights.activeDays;
  const dayWord = days === 1 ? "day" : "days";
  const recordWord = records === 1 ? "record" : "records";
  const headline =
    `This sync captured ${records} ${recordWord} across ${days} active ` +
    `${dayWord} (${window.start} → ${window.end}).`;

  return { headline, positive: pickPositive(records, highlights) };
}

/** Positive-first, honesty-gated. Returns null when nothing is genuinely
 * worth celebrating (no records, or too little to claim a superlative). */
function pickPositive(records: number, h: SyncHighlights): string | null {
  // No data at all → no claim. (The CLI aborts before an empty push, so
  // this is a belt-and-braces guard against a degenerate response.)
  if (records <= 0 || h.activeDays <= 0) {
    return null;
  }
  // Breadth: two or more models is a real, non-trivial fact.
  if (h.distinctModels >= 2) {
    return `Here's one thing you did well: you put ${h.distinctModels} different models to work — nice breadth.`;
  }
  // Consistency: three or more active days is a genuine habit signal.
  if (h.activeDays >= 3) {
    return `Here's one thing you did well: ${h.activeDays} active days in this window — steady, consistent practice.`;
  }
  // A "busiest day" is only meaningful once there's more than one day to
  // compare — otherwise it's just "the day you synced".
  if (h.busiestDay && h.activeDays >= 2) {
    return `Here's one thing you did well: your most active day was ${h.busiestDay}.`;
  }
  // Single day, single model — real data, but nothing to crown. Stay honest.
  return null;
}

/** The in-app transparency view the CLI points users to after a push (the
 * "what this sync sent" panel lives on the Connections page). Derived from
 * the configured API origin so it follows a custom `--api`. */
export function transparencyUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/connections`;
}
