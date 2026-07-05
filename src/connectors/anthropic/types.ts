// Raw payload shapes for the Anthropic Console admin surface, per
// docs/connector-facts.md §3 (retrieved 2026-07-04). These type RECORDED
// payloads — fixtures under fixtures/vendor-payloads/anthropic_console/
// mirror them until W1-S lands real recordings (rule 2).

/** Paged envelope every Console admin endpoint returns. */
export type AnthropicPage<T> = {
  data: T[];
  has_more: boolean;
  next_page: string | null;
};

/** /v1/organizations/usage_report/messages — one time bucket. */
export type UsageBucket = {
  starting_at: string; // RFC 3339, UTC, inclusive
  ending_at: string; // exclusive
  results: UsageResult[];
};

export type UsageResult = {
  uncached_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  cache_read_input_tokens: number;
  output_tokens: number;
  server_tool_use: { web_search_requests: number };
  // Grouped dims — null unless the query grouped by them. api_key_id null
  // with grouping = Workbench usage.
  api_key_id: string | null;
  workspace_id: string | null;
  account_id: string | null; // OAuth requests (the #27780 partial workaround)
  service_account_id?: string | null;
  model: string | null;
  service_tier?: string | null;
};

/** /v1/organizations/cost_report — 1d buckets only. */
export type CostBucket = {
  starting_at: string;
  ending_at: string;
  results: CostResult[];
};

export type CostResult = {
  /** Decimal STRING of cents — parse as decimal, never assume integer. */
  amount: string;
  currency: string;
  description: string | null;
  cost_type?: string | null;
  workspace_id: string | null;
  model?: string | null;
};

/** /v1/organizations/usage_report/claude_code — one record per (date, actor). */
export type ClaudeCodeRecord = {
  date: string; // YYYY-MM-DD UTC
  actor:
    | { type: "user_actor"; email_address: string }
    | { type: "api_actor"; api_key_name: string };
  organization_id: string;
  customer_type: "api" | "subscription";
  subscription_type: "enterprise" | "team" | null;
  terminal_type: string | null;
  core_metrics: {
    num_sessions: number;
    lines_of_code: { added: number; removed: number };
    commits_by_claude_code: number;
    pull_requests_by_claude_code: number;
  };
  tool_actions: Record<string, { accepted: number; rejected: number }>;
  model_breakdown: Array<{
    model: string;
    tokens: {
      input: number;
      output: number;
      cache_read: number;
      cache_creation: number;
    };
    /** Number of cents (unlike cost_report's decimal string) — an estimate. */
    estimated_cost: { amount: number; currency: string };
  }>;
};

/** Discriminated raw union the connector's envelopes carry. */
export type AnthropicRaw =
  | { surface: "usage_messages"; page: AnthropicPage<UsageBucket> }
  | { surface: "cost_report"; page: AnthropicPage<CostBucket> }
  | { surface: "claude_code"; page: AnthropicPage<ClaudeCodeRecord> };

/** Envelope kinds (raw_payloads.kind values). */
export const ENVELOPE_KINDS = {
  usage: "anthropic.usage_report.messages.1h",
  cost: "anthropic.cost_report.1d",
  claudeCode: "anthropic.usage_report.claude_code.1d",
} as const;
