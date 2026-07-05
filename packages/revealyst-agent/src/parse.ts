// Lenient structural parser for Claude Code session JSONL
// (docs/connector-facts.md §5). THE PRIVACY LINE LIVES HERE: a ParsedEvent
// carries only allowlisted structural fields — type, ids, timestamps,
// model, usage NUMBERS, and block-type presence. No field of a ParsedEvent
// can hold prompt text, completion text, tool output, titles, or file
// paths, so nothing downstream (summarize → push) can leak them.
//
// Lenient by design (format drift is the #1 risk): unparseable lines and
// unknown record types are counted and skipped, never fatal.

export type UsageNumbers = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ParsedEvent =
  | {
      kind: "assistant";
      sessionId: string;
      timestampMs: number;
      isSidechain: boolean;
      /** requestId ?? message.id ?? uuid — streaming splits share it. */
      dedupKey: string;
      model: string | null;
      usage: UsageNumbers | null;
    }
  | {
      kind: "prompt" | "activity";
      sessionId: string;
      timestampMs: number;
      isSidechain: boolean;
    };

export type ParseResult = {
  events: ParsedEvent[];
  /** Lines that failed JSON.parse or lacked required structure. */
  skippedLines: number;
  /** Structurally valid records of a type this parser doesn't know. */
  unknownTypes: number;
};

/** Record types that exist but carry nothing we may transmit (titles,
 * prompt snapshots, mode switches) — ignored without reading payloads. */
const IGNORED_TYPES = new Set([
  "summary",
  "ai-title",
  "custom-title",
  "last-prompt",
  "mode",
  "queue-operation",
]);

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** True when a user record is a tool-result carrier, not a human prompt:
 * a toolUseResult key is present, or any message.content block has type
 * "tool_result". Only block TYPE is inspected — never block content. */
function isToolResultCarrier(record: Record<string, unknown>): boolean {
  if ("toolUseResult" in record) {
    return true;
  }
  const message = record.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (Array.isArray(content)) {
    return content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "tool_result",
    );
  }
  return false;
}

export function parseSessionContent(content: string): ParseResult {
  const events: ParsedEvent[] = [];
  let skippedLines = 0;
  let unknownTypes = 0;

  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) {
        skippedLines++;
        continue;
      }
      record = parsed as Record<string, unknown>;
    } catch {
      skippedLines++;
      continue;
    }

    const type = asString(record.type);
    if (!type) {
      skippedLines++;
      continue;
    }
    if (IGNORED_TYPES.has(type)) {
      continue;
    }

    const sessionId = asString(record.sessionId);
    const timestampMs = Date.parse(asString(record.timestamp) ?? "");
    if (!sessionId || Number.isNaN(timestampMs)) {
      skippedLines++;
      continue;
    }
    const isSidechain = record.isSidechain === true;

    if (type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      const usageRaw = message?.usage as Record<string, unknown> | undefined;
      events.push({
        kind: "assistant",
        sessionId,
        timestampMs,
        isSidechain,
        dedupKey:
          asString(record.requestId) ??
          asString(message?.id) ??
          asString(record.uuid) ??
          `${sessionId}:${timestampMs}`,
        model: asString(message?.model),
        usage: usageRaw
          ? {
              input: asNumber(usageRaw.input_tokens),
              output: asNumber(usageRaw.output_tokens),
              cacheRead: asNumber(usageRaw.cache_read_input_tokens),
              cacheWrite: asNumber(usageRaw.cache_creation_input_tokens),
            }
          : null,
      });
    } else if (type === "user") {
      events.push({
        kind:
          isSidechain || isToolResultCarrier(record) ? "activity" : "prompt",
        sessionId,
        timestampMs,
        isSidechain,
      });
    } else if (type === "system" || type === "attachment") {
      events.push({ kind: "activity", sessionId, timestampMs, isSidechain });
    } else {
      unknownTypes++;
    }
  }

  return { events, skippedLines, unknownTypes };
}
