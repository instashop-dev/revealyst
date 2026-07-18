// The on-device collection allowlist, made into structured data so the
// in-app "what this sync sent" transparency panel (W5-G) and the public
// "what we collect" schema page (W5-N) can render EXACTLY the fields the
// parser reads — never a hand-maintained prose list that silently drifts
// from parse.ts.
//
// THE PRIVACY LINE still lives in parse.ts; this file is its machine-
// readable shadow. Two CI links keep them honest:
//   1. `tests/allowlist.test.ts` (this package) asserts every entry's
//      `sourceToken` actually appears in parse.ts — so we can only name a
//      field the parser genuinely reads (derive-from-code, forward).
//   2. `tests/agent-cli-contract.test.ts` (repo) asserts the app-side
//      mirror (`src/lib/agent-collection-schema.ts`) equals this list — so
//      the rendered panel can't drift from the parser either.
//
// `sent: true` means the field's VALUE leaves the device: the model id, the
// usage token NUMBERS, and (from the resident desktop agent only) a known AI
// app's identity label from a fixed list (`ai_tool_used`, ADR 0057).
// Everything else is reduced to counts and day/hour buckets on your machine
// BEFORE anything is transmitted; the raw value never leaves — which is
// exactly what the output-key guard in `tests/privacy.test.ts` enforces on the
// CLI payload.

export type CollectionField = {
  /** Stable key for React lists / cross-references. */
  readonly field: string;
  /** Human label shown in the transparency panel. */
  readonly label: string;
  /** Literal substring that MUST appear in parse.ts, proving the parser
   * reads this field (the forward derive-from-code check). */
  readonly sourceToken: string;
  /** Does the field's VALUE leave the device? Only model + token numbers. */
  readonly sent: boolean;
  /** Honest, positive-first explanation of why it is read and what (if
   * anything) leaves. User-facing copy — kept byte-identical in the app
   * mirror by the contract test. */
  readonly purpose: string;
};

/** Everything the parser reads from a Claude Code session line, in the order
 * a curious user would scan it. Grouped implicitly by `sent`. */
export const AGENT_COLLECTION_FIELDS: readonly CollectionField[] = [
  {
    field: "type",
    label: "Record type",
    sourceToken: "record.type",
    sent: false,
    purpose:
      "Whether a line is an assistant reply, a prompt, or activity — counted, never its text.",
  },
  {
    field: "sessionId",
    label: "Session id",
    sourceToken: "record.sessionId",
    sent: false,
    purpose:
      "Groups lines into sessions and measures overlap on your machine. The id itself never leaves.",
  },
  {
    field: "timestamp",
    label: "Timestamp",
    sourceToken: "record.timestamp",
    sent: false,
    purpose:
      "Bucketed on your machine to a calendar day and an hour-of-day histogram. The exact time never leaves — only the day and coarse hour counts do.",
  },
  {
    field: "isSidechain",
    label: "Sidechain flag",
    sourceToken: "record.isSidechain",
    sent: false,
    purpose:
      "Distinguishes your sessions from subagent work so session counts stay honest. A boolean, counted only.",
  },
  {
    field: "requestId",
    label: "Request / message id",
    sourceToken: "record.requestId",
    sent: false,
    purpose:
      "De-duplicates streamed reply lines so usage isn't double-counted. Used on-device; never transmitted.",
  },
  {
    field: "uuid",
    label: "Line uuid",
    sourceToken: "record.uuid",
    sent: false,
    purpose:
      "Fallback de-duplication key when no request id is present. Read on-device only.",
  },
  {
    field: "content_block_type",
    label: "Content block type",
    sourceToken: 'type === "tool_result"',
    sent: false,
    purpose:
      "Only the TYPE of a content block is inspected (e.g. tool-result vs text) — the block's contents are never read.",
  },
  {
    field: "toolUseResult",
    label: "Tool-result marker",
    sourceToken: "toolUseResult",
    sent: false,
    purpose:
      "Presence-only: marks a line as tool output so it isn't miscounted as a prompt. The tool output itself is never read.",
  },
  {
    field: "model",
    label: "Model id",
    sourceToken: "message?.model",
    sent: true,
    purpose:
      "The model id (e.g. claude-…) is sent as a metric label, sanitized to a safe charset and length.",
  },
  {
    field: "usage.input_tokens",
    label: "Input tokens",
    sourceToken: "input_tokens",
    sent: true,
    purpose: "The input-token count is summed per day and sent as a number.",
  },
  {
    field: "usage.output_tokens",
    label: "Output tokens",
    sourceToken: "output_tokens",
    sent: true,
    purpose: "The output-token count is summed per day and sent as a number.",
  },
  {
    field: "usage.cache_read_input_tokens",
    label: "Cache-read tokens",
    sourceToken: "cache_read_input_tokens",
    sent: true,
    purpose: "The cache-read-token count is summed per day and sent as a number.",
  },
  {
    field: "usage.cache_creation_input_tokens",
    label: "Cache-write tokens",
    sourceToken: "cache_creation_input_tokens",
    sent: true,
    purpose: "The cache-write-token count is summed per day and sent as a number.",
  },
  {
    field: "ai_tool_used",
    label: "AI app in use",
    sourceToken: "detect_present",
    sent: true,
    purpose:
      "The desktop app checks which known AI desktop apps are open (from a fixed list) and sends only each app's name as a label — never its windows, files, or anything you type in it.",
  },
];

/** What the parser NEVER reads — the denylist, stated plainly for the trust
 * surface. These strings do not appear as reads in parse.ts and are barred
 * from the output payload by `tests/privacy.test.ts`. */
export const AGENT_NEVER_COLLECTED: readonly string[] = [
  "Prompt text and assistant replies",
  "Tool inputs and tool outputs",
  "File paths and working directories",
  "Git branch names",
  "Session titles and summaries",
  "Queued or draft prompts",
];
