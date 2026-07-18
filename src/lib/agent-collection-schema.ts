// App-side mirror of the Revealyst Agent's on-device collection allowlist
// (`packages/revealyst-agent/src/allowlist.ts`). The app deliberately never
// imports the CLI package at runtime (the types.ts mirror rule — the CLI
// ships to end-user machines and pulls node:fs), so the transparency panel
// and the public "what we collect" schema page (W5-N) read THIS module.
//
// Drift is impossible to ship: `tests/agent-cli-contract.test.ts` imports
// the CLI package's `AGENT_COLLECTION_FIELDS` / `AGENT_NEVER_COLLECTED` and
// asserts they are byte-identical to what's below — and the CLI package's
// own `tests/allowlist.test.ts` asserts every field there is actually read
// by parse.ts. So this list can only ever name fields the parser reads.
//
// Pure and db-free so public pages may import it.

export type CollectionField = {
  readonly field: string;
  readonly label: string;
  readonly sourceToken: string;
  readonly sent: boolean;
  readonly purpose: string;
  /** For a `sent: true` field, the SHAPE of the value that leaves the device: a
   * token/count number, the model id, or a bounded closed-enum label. Its
   * PRESENCE is the structural proof that a sent value is bounded — NOT free
   * text. The onboarding standing-privacy gate (`agentNeverUploadsPrompts`)
   * shows the "your prompts never leave this computer" line only while EVERY sent
   * field carries one of these bounded shapes; a future free-text sent field
   * would omit it, so the gate fails closed (the line is withheld) rather than
   * making the claim false. (The agent may READ prompt text on-device to classify
   * it — ADR 0059 — but only bounded values ever leave.)
   * Omitted on `sent: false` fields — nothing leaves for them. */
  readonly sentValueShape?: "count" | "model_id" | "closed_enum";
};

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
    sentValueShape: "model_id",
    purpose:
      "The model id (e.g. claude-…) is sent as a metric label, sanitized to a safe charset and length.",
  },
  {
    field: "usage.input_tokens",
    label: "Input tokens",
    sourceToken: "input_tokens",
    sent: true,
    sentValueShape: "count",
    purpose: "The input-token count is summed per day and sent as a number.",
  },
  {
    field: "usage.output_tokens",
    label: "Output tokens",
    sourceToken: "output_tokens",
    sent: true,
    sentValueShape: "count",
    purpose: "The output-token count is summed per day and sent as a number.",
  },
  {
    field: "usage.cache_read_input_tokens",
    label: "Cache-read tokens",
    sourceToken: "cache_read_input_tokens",
    sent: true,
    sentValueShape: "count",
    purpose: "The cache-read-token count is summed per day and sent as a number.",
  },
  {
    field: "usage.cache_creation_input_tokens",
    label: "Cache-write tokens",
    sourceToken: "cache_creation_input_tokens",
    sent: true,
    sentValueShape: "count",
    purpose: "The cache-write-token count is summed per day and sent as a number.",
  },
  {
    field: "ai_tool_used",
    label: "AI app in use",
    sourceToken: "detect_present",
    sent: true,
    sentValueShape: "closed_enum",
    purpose:
      "The desktop app checks which known AI desktop apps are open (from a fixed list) and sends only each app's name as a label — never its windows, files, or anything you type in it.",
  },
  {
    field: "task_category",
    label: "Kind of task",
    sourceToken: "classify_prompt",
    sent: true,
    sentValueShape: "closed_enum",
    purpose:
      "The desktop app reads your prompt on your computer to guess the kind of task (from a fixed list like research, drafting, or coding), and sends only that one label plus a daily count — never the words you typed.",
  },
  {
    field: "iteration_depth",
    label: "Refinement turns",
    sourceToken: "is_refinement_turn",
    sent: true,
    sentValueShape: "count",
    purpose:
      "How many of your prompts that day were follow-ups that refine an earlier answer, worked out on your computer and sent as a plain number — never the words you typed.",
  },
  {
    field: "verification_behavior",
    label: "Checking AI output",
    sourceToken: "is_verification_action",
    sent: true,
    sentValueShape: "count",
    purpose:
      "How many of your prompts that day asked to check the AI's work (for example verify, cite a source, or test it), worked out on your computer and sent as a plain number — never the words you typed.",
  },
];

export const AGENT_NEVER_COLLECTED: readonly string[] = [
  "Prompt text and assistant replies",
  "Tool inputs and tool outputs",
  "File paths and working directories",
  "Git branch names",
  "Session titles and summaries",
  "Queued or draft prompts",
];

/** Fields whose VALUE leaves the device (model id + token numbers). */
export const AGENT_SENT_FIELDS = AGENT_COLLECTION_FIELDS.filter((f) => f.sent);

/** Fields read on-device only and reduced to counts/buckets before any push. */
export const AGENT_ON_DEVICE_ONLY_FIELDS = AGENT_COLLECTION_FIELDS.filter(
  (f) => !f.sent,
);
