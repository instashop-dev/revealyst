// Lenient structural parser for Claude Code session JSONL
// (docs/connector-facts.md §5). THE PRIVACY LINE LIVES HERE: a ParsedEvent
// carries only allowlisted structural fields — type, ids, timestamps, the
// model id, usage NUMBERS, and block-type presence. Denylisted fields
// (content, tool output, titles, paths, branches) are never read at all.
// The one free-text field the §5 allowlist permits, `message.model`, IS
// transmitted (as a metric `dim`), but it's vendor free text, so
// sanitizeModel bounds it — charset-clamped to [A-Za-z0-9._:-] and capped
// at 64 chars — so it cannot carry spaces, punctuation, newlines, a URL,
// JSON, or a large payload. We can't prove a string is a "real" model
// without a brittle hardcoded list, so this is a BOUND, not a semantic
// filter; the server dim guard is the second bound.
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

/** Model ids look like "claude-fable-5" / "claude-haiku-4-5-20251001". We
 * transmit the model (it's §5-allowlisted) but it is still vendor free
 * text, so clamp it to a safe charset and length before it can become a
 * metric `dim` ("model=<id>") or a gap detail — a hostile/corrupted log
 * must not be able to smuggle content through it. Disallowed characters
 * are dropped; an empty or overlong result collapses to a marker. */
export function sanitizeModel(raw: unknown): string | null {
  const s = asString(raw);
  if (s === null) {
    return null;
  }
  const cleaned = s.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unknown";
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
        model: sanitizeModel(message?.model),
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
