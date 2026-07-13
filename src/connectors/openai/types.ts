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

/** /v1/organization/projects — org-admin coverage discovery (W2-J). */
export type OrgProjectsList = {
  object: "list";
  data: Array<{
    object: "organization.project";
    id: string;
    name: string;
    status?: string;
  }>;
  has_more: boolean;
  last_id?: string | null;
};

/** /v1/organization/projects/{id}/api_keys — which keys resolve to a person
 * (owner.type "user") vs stay key-level ("service_account"). The key `id`
 * is the same value usage groups by as `api_key_id`. */
export type ProjectApiKeysList = {
  object: "list";
  data: Array<{
    object: "organization.project.api_key";
    id: string;
    name: string | null;
    owner: {
      type: "user" | "service_account";
      user?: { id: string } | null;
      service_account?: { id: string } | null;
    };
  }>;
  has_more: boolean;
  last_id?: string | null;
};

/** /v1/organization/usage/web_search_calls — one 1d bucket (W5-E re-scope,
 * §1.2 (3)). Newer endpoint; the exact result-object name is NLV-O10, and the
 * call-count field name is unverified — the normalizer reads it leniently. Can
 * be grouped by user_id/api_key_id (NOT in the project-only restriction), so it
 * carries the same person/key/org attribution dims as completions. */
export type WebSearchCallsBucket = {
  start_time: number;
  end_time: number;
  results: WebSearchCallsResult[];
};

export type WebSearchCallsResult = {
  object?: string;
  /** Call count — vendor field name unverified (NLV-O10); both spellings read. */
  num_calls?: number;
  num_model_requests?: number;
  project_id: string | null;
  user_id: string | null;
  api_key_id: string | null;
};

/** /v1/organization/usage/code_interpreter_sessions — one 1d bucket. Grouped by
 * `project_id` ONLY: it has NO user/key dimension (connector-facts §4), so it is
 * NEVER presented per person — org-level feature presence only. */
export type CodeInterpreterSessionsBucket = {
  start_time: number;
  end_time: number;
  results: CodeInterpreterSessionsResult[];
};

export type CodeInterpreterSessionsResult = {
  object?: string;
  num_sessions?: number;
  project_id: string | null;
};

/** Discriminated raw union the connector's envelopes carry. */
export type OpenAiRaw =
  | { surface: "usage_completions"; page: OpenAiPage<CompletionsBucket> }
  | { surface: "costs"; page: OpenAiPage<CostsBucket> }
  | { surface: "usage_web_search"; page: OpenAiPage<WebSearchCallsBucket> }
  | {
      surface: "usage_code_interpreter";
      page: OpenAiPage<CodeInterpreterSessionsBucket>;
    };

export const ENVELOPE_KINDS = {
  completions: "openai.usage.completions.1h",
  costs: "openai.costs.1d",
  webSearch: "openai.usage.web_search_calls.1d",
  codeInterpreter: "openai.usage.code_interpreter_sessions.1d",
} as const;
