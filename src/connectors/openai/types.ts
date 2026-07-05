// Raw payload shapes for the OpenAI org admin surface, per
// docs/connector-facts.md §4 (retrieved 2026-07-04). One connector, two
// credential modes (execution plan W1-D): personal-key mode lands here;
// org-admin mode (W2-J) reuses these shapes and the same normalize().

/** Usage/costs envelope: {object:"page", data:[bucket], has_more, next_page}. */
export type OpenAiPage<T> = {
  object: "page";
  data: T[];
  has_more: boolean;
  next_page: string | null;
};

/** /v1/organization/usage/completions — one time bucket. */
export type CompletionsBucket = {
  start_time: number; // Unix seconds, inclusive
  end_time: number; // exclusive
  results: CompletionsResult[];
};

export type CompletionsResult = {
  object: "organization.usage.completions.result";
  input_tokens: number;
  output_tokens: number;
  input_cached_tokens: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
  num_model_requests: number;
  // Grouped dims — null unless the query grouped by them (quirk: always
  // pass explicit group_by).
  project_id: string | null;
  /** The org member who OWNS the api key used — the only true person path
   * (NLV-O1). Null for service-account keys. */
  user_id: string | null;
  api_key_id: string | null;
  model: string | null;
  batch: boolean | null;
  service_tier?: string | null;
};

/** /v1/organization/costs — 1d buckets only, no user dimension. */
export type CostsBucket = {
  start_time: number;
  end_time: number;
  results: CostsResult[];
};

export type CostsResult = {
  object: "organization.costs.result";
  amount: { value: number; currency: string }; // float USD
  line_item: string | null;
  project_id: string | null;
};

/** /v1/organization/users — list envelope with `after` cursor. */
export type OrgUsersList = {
  object: "list";
  data: Array<{
    object: "organization.user";
    id: string;
    name: string | null;
    email: string;
    role: string;
  }>;
  has_more: boolean;
  last_id?: string | null;
};

/** Discriminated raw union the connector's envelopes carry. */
export type OpenAiRaw =
  | { surface: "usage_completions"; page: OpenAiPage<CompletionsBucket> }
  | { surface: "costs"; page: OpenAiPage<CostsBucket> };

export const ENVELOPE_KINDS = {
  completions: "openai.usage.completions.1h",
  costs: "openai.costs.1d",
} as const;
