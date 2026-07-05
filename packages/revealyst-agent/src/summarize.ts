// Pure local summarizer: ParsedEvents in → metric records + sub-daily
// signals out. No I/O, no clock (the window comes from the caller), no
// content — deterministic over the same events, mirroring the frozen
// Connector.normalize() purity rule.

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

function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function utcHour(timestampMs: number): number {
  return new Date(timestampMs).getUTCHours();
}

type DayAgg = {
  usage: UsageNumbers;
  spendCents: number;
  prompts: number;
  sessions: Set<string>;
  modelRequests: Map<string, number>;
  modelTokens: Map<string, number>;
  hours: number[];
  hourSessions: Array<Set<string>>;
};

function emptyDay(): DayAgg {
  return {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    spendCents: 0,
    prompts: 0,
    sessions: new Set(),
    modelRequests: new Map(),
    modelTokens: new Map(),
    hours: Array.from({ length: 24 }, () => 0),
    hourSessions: Array.from({ length: 24 }, () => new Set<string>()),
  };
}

export function summarize(
  events: ParsedEvent[],
  opts: SummarizeOptions,
): Summary {
  const days = new Map<string, DayAgg>();
  const seenAssistant = new Set<string>();
  const unknownModels = new Set<string>();

  for (const event of events) {
    const day = utcDay(event.timestampMs);
    if (day < opts.window.start || day > opts.window.end) {
      continue;
    }
    let agg = days.get(day);
    if (!agg) {
      agg = emptyDay();
      days.set(day, agg);
    }

    // Every event marks activity: session presence + hour histogram.
    agg.sessions.add(event.sessionId);
    const hour = utcHour(event.timestampMs);
    agg.hours[hour]++;
    agg.hourSessions[hour].add(event.sessionId);

    if (event.kind === "prompt") {
      agg.prompts++;
    } else if (event.kind === "assistant") {
      // Streaming writes several JSONL lines per request sharing a
      // requestId, each restating the same usage — count once.
      if (seenAssistant.has(event.dedupKey)) {
        continue;
      }
      seenAssistant.add(event.dedupKey);

      if (event.usage) {
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
  }

  const records: MetricRecordInput[] = [];
  const signals: SubjectDaySignalInput[] = [];
  const base = { subject: opts.subject, attribution: opts.attribution };

  for (const day of [...days.keys()].sort()) {
    const agg = days.get(day)!;
    const flat: Array<[MetricRecordInput["metricKey"], number]> = [
      ["active_day", 1],
      ["sessions", agg.sessions.size],
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
      peakConcurrency: Math.max(...agg.hourSessions.map((s) => s.size)),
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
