// Composition root for the pure pipeline: session-file contents in →
// ingest-ready AgentIngestRequest out. File I/O stays in the caller (CLI /
// tests), so this module remains fixture-testable end-to-end.

import { parseSessionContent, type ParsedEvent } from "./parse";
import { SUMMARIZER_VERSION } from "./prices";
import { summarize } from "./summarize";
import type { LocalIdentity } from "./identity";
import type { AgentIngestRequest, DateWindow, HonestyGap } from "./types";

export { claudeConfigDirs, listSessionFiles } from "./discover";
export { readOauthEmail, resolveLocalIdentity } from "./identity";
export { parseSessionContent } from "./parse";
export { SUMMARIZER_VERSION } from "./prices";
export { summarize } from "./summarize";
export type { LocalIdentity } from "./identity";
export type { ParsedEvent, ParseResult } from "./parse";
export type { SummarizeOptions, Summary } from "./summarize";
export type * from "./types";

export type BuildOptions = {
  /** Raw JSONL contents of every discovered session file (sidechains
   * included — they carry their own usage). */
  sessionContents: string[];
  window: DateWindow;
  identity: LocalIdentity;
  agentVersion: string;
};

export function buildIngestRequest(opts: BuildOptions): AgentIngestRequest {
  const events: ParsedEvent[] = [];
  let skippedLines = 0;
  let unknownTypes = 0;
  for (const content of opts.sessionContents) {
    const result = parseSessionContent(content);
    events.push(...result.events);
    skippedLines += result.skippedLines;
    unknownTypes += result.unknownTypes;
  }

  const { records, signals, gaps } = summarize(events, {
    subject: {
      kind: opts.identity.descriptor.kind,
      externalId: opts.identity.descriptor.externalId,
    },
    attribution: opts.identity.attribution,
    window: opts.window,
  });

  const allGaps: HonestyGap[] = [...gaps];
  if (skippedLines > 0 || unknownTypes > 0) {
    allGaps.push({
      kind: "other",
      detail: `log parse drift: ${skippedLines} lines skipped, ${unknownTypes} unknown record types`,
    });
  }

  return {
    agentVersion: opts.agentVersion,
    summarizerVersion: SUMMARIZER_VERSION,
    window: opts.window,
    subjects: [opts.identity.descriptor],
    records,
    signals,
    gaps: allGaps,
  };
}
