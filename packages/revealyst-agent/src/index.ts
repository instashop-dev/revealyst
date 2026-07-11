// Composition root for the pure pipeline: session-file contents in →
// ingest-ready AgentIngestRequest out. File I/O stays in the caller (CLI /
// tests), so this module remains fixture-testable end-to-end.

import {
  parseSessionContent,
  type ParsedEvent,
  type ParseResult,
} from "./parse";
import { SUMMARIZER_VERSION } from "./prices";
import { summarize, utcDay } from "./summarize";
import type { LocalIdentity } from "./identity";
import type { AgentIngestRequest, DateWindow, HonestyGap } from "./types";

export { claudeConfigDirs, listSessionFiles } from "./discover";
export { readOauthEmail, resolveLocalIdentity } from "./identity";
export { createSessionParser, parseSessionContent } from "./parse";
export { parseSessionFilesStreaming } from "./stream";
export { SUMMARIZER_VERSION } from "./prices";
export { summarize } from "./summarize";
export type { LocalIdentity } from "./identity";
export type { ParsedEvent, ParseResult } from "./parse";
export type { SummarizeOptions, Summary } from "./summarize";
export type * from "./types";

export type BuildOptions = {
  /** Raw JSONL contents of every discovered session file (sidechains
   * included — they carry their own usage). Fixture/test path. */
  sessionContents?: string[];
  /** Pre-parsed events from the streaming reader (the CLI path) — merged
   * with any sessionContents. */
  parsed?: ParseResult;
  window: DateWindow;
  identity: LocalIdentity;
  agentVersion: string;
};

/** Pin the declared window's start to the earliest surviving event day.
 * The server treats the declared window as authoritative (delete-then-
 * upsert), so a lookback wider than local log retention would DELETE
 * previously-captured days whose logs are pruned and upsert nothing in
 * their place (plan R2 / research Fix 1). Pinning is global across all
 * config dirs (events are already flattened). With no events at all the
 * requested window passes through — callers must not push such a batch
 * (an empty authoritative window is pure history destruction; the CLI
 * aborts on zero records). */
function pinWindow(window: DateWindow, events: ParsedEvent[]): DateWindow {
  // Numeric min first — one Date/ISO conversion total, not one per event.
  let earliestMs = Infinity;
  for (const event of events) {
    if (event.timestampMs < earliestMs) {
      earliestMs = event.timestampMs;
    }
  }
  if (!Number.isFinite(earliestMs)) {
    return window;
  }
  const earliest = utcDay(earliestMs);
  if (earliest <= window.start) {
    return window;
  }
  return {
    start: earliest > window.end ? window.end : earliest,
    end: window.end,
  };
}

export function buildIngestRequest(opts: BuildOptions): AgentIngestRequest {
  const contents = opts.sessionContents ?? [];
  // Don't copy the (potentially multi-million-entry) streamed events array
  // unless there are string contents to merge in.
  const events: ParsedEvent[] =
    contents.length > 0 ? [...(opts.parsed?.events ?? [])] : (opts.parsed?.events ?? []);
  let skippedLines = opts.parsed?.skippedLines ?? 0;
  let unknownTypes = opts.parsed?.unknownTypes ?? 0;
  for (const content of contents) {
    const result = parseSessionContent(content);
    events.push(...result.events);
    skippedLines += result.skippedLines;
    unknownTypes += result.unknownTypes;
  }

  const window = pinWindow(opts.window, events);
  const { records, signals, gaps } = summarize(events, {
    subject: {
      kind: opts.identity.descriptor.kind,
      externalId: opts.identity.descriptor.externalId,
    },
    attribution: opts.identity.attribution,
    window,
  });

  const allGaps: HonestyGap[] = [...gaps];
  if (skippedLines > 0 || unknownTypes > 0) {
    allGaps.push({
      kind: "other",
      detail: `log parse drift: ${skippedLines} lines skipped, ${unknownTypes} unknown record types`,
    });
  }
  // ADR 0025: when the pin narrowed the window, say so honestly — the days
  // between the requested start and the covered start were left untouched
  // server-side (never zeroed), and the dashboard should be able to say why.
  if (window.start !== opts.window.start) {
    allGaps.push({
      kind: "sync_window_incomplete",
      detail:
        `local logs only cover from ${window.start}; requested lookback ` +
        `started ${opts.window.start} — earlier days were left untouched`,
    });
  }

  return {
    agentVersion: opts.agentVersion,
    summarizerVersion: SUMMARIZER_VERSION,
    // The PINNED window — never the requested one. batch.window is the
    // range the server deletes; it must match what summarize() covered.
    window,
    subjects: [opts.identity.descriptor],
    records,
    signals,
    gaps: allGaps,
  };
}
