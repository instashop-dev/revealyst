// Raw payload shapes for the GitHub Copilot usage-metrics reports API, per
// docs/connector-facts.md §1 (retrieved/re-verified 2026-07-04). The legacy
// metrics APIs are sunset; this is the ONLY surface: per-user daily NDJSON
// reports behind signed download links (two-hop fetch), header
// `X-GitHub-Api-Version: 2026-03-10`.
//
// Attribution: PERSON (user_id + user_login per row). No email is exposed by
// the metrics API — identity resolution keys on user_id/login. No sub-daily
// signals of any kind (event API sunset) — Copilot subjects carry
// source_granularity 'none'. Fields are optional/lenient by design: the
// NDJSON schema churns monthly (facts quirks) so the parser never assumes a
// field is present.

/** `totals_by_cli` — the ONLY per-user token + IDE-independent session source
 * Copilot exposes (IDE tokens/sessions are a documented gap). */
export type CopilotCliTotals = {
  session_count?: number;
  request_count?: number;
  prompt_count?: number;
  token_usage?: {
    prompt_tokens_sum?: number;
    output_tokens_sum?: number;
    avg_tokens_per_request?: number;
  };
  last_known_cli_version?: string;
};

/** A `totals_by_*` breakdown entry (feature / model). Under-counts vs totals
 * for server-side-telemetry-only users (facts) — used for adoption flags and
 * agent-mode request counts, never to recompute active-user totals. */
export type CopilotBreakdown = {
  feature?: string;
  model?: string;
  user_initiated_interaction_count?: number;
  code_generation_activity_count?: number;
  code_acceptance_activity_count?: number;
};

/** One row of `users-1-day` — a true per-user daily record. */
export type CopilotUserDayRecord = {
  day: string; // UTC calendar day, YYYY-MM-DD
  organization_id?: number | string;
  enterprise_id?: number | string | null;
  user_id: number | string;
  user_login: string;
  /** Usage-based-billing AI Credits — present only since 2026-06-19; absent
   * (undefined) on earlier days, which is ABSENCE, never a measured zero. */
  ai_credits_used?: number;
  user_initiated_interaction_count?: number;
  code_generation_activity_count?: number;
  code_acceptance_activity_count?: number;
  loc_suggested_to_add_sum?: number;
  loc_suggested_to_delete_sum?: number;
  loc_added_sum?: number;
  loc_deleted_sum?: number;
  used_agent?: boolean;
  used_chat?: boolean;
  used_cli?: boolean;
  used_copilot_coding_agent?: boolean;
  /** Documented alias for used_copilot_coding_agent (facts §1). */
  used_copilot_cloud_agent?: boolean;
  used_copilot_code_review_active?: boolean;
  used_copilot_code_review_passive?: boolean;
  ai_adoption_phase?: {
    phase_number?: number;
    phase?: string;
    version?: string;
  };
  totals_by_cli?: CopilotCliTotals;
  totals_by_ide?: CopilotBreakdown[];
  totals_by_feature?: CopilotBreakdown[];
  totals_by_language_feature?: CopilotBreakdown[];
  totals_by_language_model?: CopilotBreakdown[];
  totals_by_model_feature?: CopilotBreakdown[];
};

/** One row of `user-teams-1-day` — per-user team membership for the
 * users×user-teams join (team-level segmentation lives on the subject's
 * meta). Teams with <5 seats are suppressed (surface, don't zero-fill). */
export type CopilotUserTeamRecord = {
  user_id: number | string;
  user_login: string;
  team_slug: string;
  team_name?: string | null;
};

/** The reports listing response — 1-day endpoints return download links for
 * one `report_day`. Data is NDJSON behind these signed URLs (two-hop). */
export type CopilotReportListing = {
  download_links: string[];
  report_day?: string;
  report_start_day?: string;
  report_end_day?: string;
};

/** Personal-mode spend context (§6a.2 upgrade): a personal-plan user reads
 * their OWN per-model daily AI-credit spend with their own token. Usage
 * metrics stay org-only — this is spend context, not usage. */
export type CopilotAiCreditUsageItem = {
  product?: string;
  sku?: string;
  model?: string;
  unitType?: string;
  pricePerUnit?: number;
  grossQuantity?: number;
  grossAmount?: number;
  discountQuantity?: number;
  discountAmount?: number;
  netQuantity?: number;
  netAmount?: number;
  /** Day grain — the billing usage is per-day (facts §1). */
  date?: string;
  day?: string;
};

export type CopilotAiCreditUsage = {
  usageItems: CopilotAiCreditUsageItem[];
};

/** Discriminated raw union the connector's envelopes carry. Each `users_daily`
 * envelope is ONE UTC day's fully-downloaded per-user records, so normalize()
 * sums a (person, day) in a single pass — metric upsert is replace-on-conflict,
 * never additive. Team membership (the users×user-teams join) rides on the
 * subject's meta via discover(), not on the metric envelope. */
export type CopilotRaw =
  | {
      surface: "users_daily";
      day: string;
      records: CopilotUserDayRecord[];
    }
  | {
      surface: "personal_spend";
      username: string;
      usage: CopilotAiCreditUsage;
    };

export const ENVELOPE_KINDS = {
  usersDaily: "copilot.users-1-day",
  personalSpend: "copilot.ai-credit-usage",
} as const;

/** IDE agent modes whose interaction counts are genuinely agent requests
 * (facts feature enum). Used to derive agent_requests from totals_by_feature
 * without conflating plain completion/chat. `copilot_cli` is deliberately
 * EXCLUDED here — CLI agent requests come from totals_by_cli.request_count, so
 * counting the feature entry too would double-count. */
export const AGENT_FEATURES = new Set<string>([
  "chat_panel_agent_mode",
  "agent_edit",
]);
