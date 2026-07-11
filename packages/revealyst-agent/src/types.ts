// Local mirrors of the frozen W0-C contract shapes (src/contracts/**) the
// agent emits. The CLI is a separate package that runs on end-user machines
// and must not import the monolith; drift between these mirrors and the
// frozen zod schemas is caught by the repo-side contract test
// (tests/agent-cli-contract.test.ts), which validates a real built batch
// against the frozen schemas — the rule-2 seam.

export type SubjectKind =
  | "person"
  | "api_key"
  | "service_account"
  | "workspace"
  | "project"
  | "account";

export type AttributionLevel = "person" | "key_project" | "account";

/** Only the canonical metric keys this summarizer emits. */
export type AgentMetricKey =
  | "active_day"
  | "sessions"
  | "prompts"
  | "tokens_input"
  | "tokens_output"
  | "tokens_cache_read"
  | "tokens_cache_write"
  | "spend_cents_estimated"
  | "model_requests"
  | "model_tokens";

export type SubjectRef = { kind: SubjectKind; externalId: string };

export type MetricRecordInput = {
  subject: SubjectRef;
  metricKey: AgentMetricKey;
  day: string; // YYYY-MM-DD, UTC calendar day
  dim: string; // "" or "model=<id>"
  value: number;
  attribution: AttributionLevel;
};

export type SubjectDaySignalInput = {
  subject: SubjectRef;
  day: string;
  hours: number[] | null; // 24 slots
  peakConcurrency: number | null;
  sourceGranularity: "event" | "1m" | "1h" | "none";
};

export type HonestyGap = {
  kind:
    | "oauth_actors_missing"
    | "telemetry_only_users_in_totals"
    | "shared_key_not_person_level"
    | "service_accounts_unresolved"
    | "sub_daily_unavailable"
    | "sync_window_incomplete" // ADR 0025: lookback exceeded surviving local logs
    | "other";
  detail?: string;
};

export type SubjectDescriptor = {
  kind: SubjectKind;
  externalId: string;
  email: string | null;
  displayName: string | null;
};

export type DateWindow = { start: string; end: string };

/** Body of POST /api/agent/ingest (ADR 0002). */
export type AgentIngestRequest = {
  agentVersion: string;
  summarizerVersion: number;
  window: DateWindow;
  subjects: SubjectDescriptor[];
  records: MetricRecordInput[];
  signals: SubjectDaySignalInput[];
  gaps: HonestyGap[];
};
