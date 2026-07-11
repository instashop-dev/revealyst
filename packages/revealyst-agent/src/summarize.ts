// Pure local summarizer: ParsedEvents in → metric records + sub-daily
// signals out. No I/O, no clock (the window comes from the caller), no
// content — deterministic over the same events, mirroring the frozen
// Connector.normalize() purity rule.
//
// Two correctness rules from docs/connector-facts.md §5 are load-bearing:
//   • Dedup usage by requestId, **last-wins** ("keep final entry") — the
//     final streamed line restates cumulative usage; first-wins undercounts.
//   • Sessions = distinct sessionId with isSidechain:false ("human
//     sessions"); subagent usage is still summed, but a sidechain is not a
//     session. Streamed duplicate lines are not extra activity either.

import { estimateCents, ratesForModel } from "./prices";
import type { ParsedEvent, UsageNumbers } from "./parse";
import type {
  AttributionLevel,
  DateWindow,
  HonestyGap,
  MetricRecordInput,
  SubjectDaySignalInput,
  SubjectRef,
} from "./types";

export type SummarizeOptions = {
  subject: SubjectRef;
  attribution: AttributionLevel;
  /** Inclusive UTC calendar-day window; events outside are ignored. */
  window: DateWindow;
};

export type Summary = {
  records: MetricRecordInput[];
  signals: SubjectDaySignalInput[];
  gaps: HonestyGap[];
};

/** Exported so window pinning (index.ts) buckets days identically —
 * one formatter, no silent drift between pinning and aggregation. */
export function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function utcHour(timestampMs: number): number {
  return new Date(timestampMs).getUTCHours();
}

/** Peak simultaneous sessions: the max number of inclusive [min,max] event
 * intervals overlapping at any instant (which always occurs at some
 * interval's start). Real temporal overlap — not an hourly bucket count —
 * so "peak concurrency" means what it says. */
function peakConcurrency(intervals: Array<{ min: number; max: number }>): number {
  let peak = 0;
  for (const a of intervals) {
    let count = 0;
    for (const b of intervals) {
      if (b.min <= a.min && a.min <= b.max) {
        count++;
      }
    }
    if (count > peak) {
      peak = count;
    }
  }
  return peak;
}

type DayAgg = {
  usage: UsageNumbers;
  spendCents: number;
  prompts: number;
  /** Human sessions only (isSidechain:false) — the §5 sessions metric. */
  humanSessions: Set<string>;
  /** Every session's active interval this day (incl. sidechains) — feeds
   * true concurrency. */
  sessionIntervals: Map<string, { min: number; max: number }>;
  modelRequests: Map<string, number>;
  modelTokens: Map<string, number>;
  hours: number[];
};

function emptyDay(): DayAgg {
  return {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    spendCents: 0,
    prompts: 0,
    humanSessions: new Set(),
    sessionIntervals: new Map(),
    modelRequests: new Map(),
    modelTokens: new Map(),
    hours: Array.from({ length: 24 }, () => 0),
  };
}

export function summarize(
  events: ParsedEvent[],
  opts: SummarizeOptions,
): Summary {
  // Pass 1 — collapse streamed assistant lines to ONE event per request,
  // last-wins (the final line carries cumulative usage). Non-assistant
  // events pass through unchanged. This dedup happens BEFORE any
  // aggregation, so histograms and session presence never double-count a
  // streamed turn.
  const assistantByKey = new Map<string, ParsedEvent>();
  const otherEvents: ParsedEvent[] = [];
  for (const event of events) {
    if (event.kind === "assistant") {
      assistantByKey.set(event.dedupKey, event); // last-wins
    } else {
      otherEvents.push(event);
    }
  }
  const dedupedEvents = [...otherEvents, ...assistantByKey.values()];

  const days = new Map<string, DayAgg>();
  const unknownModels = new Set<string>();

  for (const event of dedupedEvents) {
    const day = utcDay(event.timestampMs);
    if (day < opts.window.start || day > opts.window.end) {
      continue;
    }
    let agg = days.get(day);
    if (!agg) {
      agg = emptyDay();
      days.set(day, agg);
    }

    agg.hours[utcHour(event.timestampMs)]++;
    if (!event.isSidechain) {
      agg.humanSessions.add(event.sessionId);
    }
    const interval = agg.sessionIntervals.get(event.sessionId);
    if (interval) {
      interval.min = Math.min(interval.min, event.timestampMs);
      interval.max = Math.max(interval.max, event.timestampMs);
    } else {
      agg.sessionIntervals.set(event.sessionId, {
        min: event.timestampMs,
        max: event.timestampMs,
      });
    }

    if (event.kind === "prompt") {
      agg.prompts++;
    } else if (event.kind === "assistant" && event.usage) {
      agg.usage.input += event.usage.input;
      agg.usage.output += event.usage.output;
      agg.usage.cacheRead += event.usage.cacheRead;
      agg.usage.cacheWrite += event.usage.cacheWrite;

      const model = event.model ?? "unknown";
      const { rates, known } = ratesForModel(model);
      if (!known) {
        unknownModels.add(model);
      }
      agg.spendCents += estimateCents(rates, event.usage);
      agg.modelRequests.set(model, (agg.modelRequests.get(model) ?? 0) + 1);
      agg.modelTokens.set(
        model,
        (agg.modelTokens.get(model) ?? 0) +
          event.usage.input +
          event.usage.output,
      );
    }
  }

  const records: MetricRecordInput[] = [];
  const signals: SubjectDaySignalInput[] = [];
  const base = { subject: opts.subject, attribution: opts.attribution };

  for (const day of [...days.keys()].sort()) {
    const agg = days.get(day)!;
    const flat: Array<[MetricRecordInput["metricKey"], number]> = [
      ["active_day", 1],
      ["sessions", agg.humanSessions.size],
      ["prompts", agg.prompts],
      ["tokens_input", agg.usage.input],
      ["tokens_output", agg.usage.output],
      ["tokens_cache_read", agg.usage.cacheRead],
      ["tokens_cache_write", agg.usage.cacheWrite],
      ["spend_cents_estimated", Math.round(agg.spendCents * 100) / 100],
    ];
    for (const [metricKey, value] of flat) {
      records.push({ ...base, metricKey, day, dim: "", value });
    }
    for (const [model, count] of [...agg.modelRequests].sort()) {
      records.push({
        ...base,
        metricKey: "model_requests",
        day,
        dim: `model=${model}`,
        value: count,
      });
    }
    for (const [model, tokens] of [...agg.modelTokens].sort()) {
      records.push({
        ...base,
        metricKey: "model_tokens",
        day,
        dim: `model=${model}`,
        value: tokens,
      });
    }
    signals.push({
      subject: opts.subject,
      day,
      hours: agg.hours,
      peakConcurrency: peakConcurrency([...agg.sessionIntervals.values()]),
      sourceGranularity: "event",
    });
  }

  const gaps: HonestyGap[] = [
    {
      kind: "other",
      detail: "spend_cents_estimated uses public list prices, not invoices",
    },
  ];
  if (unknownModels.size > 0) {
    gaps.push({
      kind: "other",
      detail: `unknown model rates defaulted high: ${[...unknownModels]
        .sort()
        .slice(0, 5)
        .join(", ")}`,
    });
  }

  return { records, signals, gaps };
}
