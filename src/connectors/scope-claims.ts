// U2 — plain-English "what this connector can and can't measure" claims,
// keyed by vendor id. This is a CLAIM SURFACE (invariant b / the W3-N/W3-P
// rule): every sentence here is fact-checked against docs/connector-facts.md,
// per vendor, and understates when the doc is uncertain. Pages must render
// these — never hard-code vendor-capability prose in a page (the same
// discipline the landing "Connects" strip follows).
//
// Kept as a pure data module (no server-only imports) so it is import-safe
// from client components too — the RegisteredConnector entries reference it by
// vendor id, and the connections page/scope drawer read it directly for the
// local agent (which is a push source, not a registered connector).

export type ScopeClaims = {
  /** What Revealyst can honestly see through this connector. */
  measures: string[];
  /** Known holes — surfaced, never papered over. */
  cannotMeasure: string[];
};

/**
 * Every claim below cites docs/connector-facts.md. Summary of the load-bearing
 * facts:
 *  - Anthropic Console: person for API-key actors; OAuth/subscription actors
 *    missing (bug #27780); usage report 1m/1h buckets; NO request count;
 *    Claude Code core_metrics (sessions/LoC/commits/PRs); AWS-platform orgs
 *    excluded.
 *  - OpenAI: person-level only via user-owned keys; costs are 1d and have NO
 *    user_id (org total only); acceptance not on this surface; 1h buckets.
 *  - Cursor: person (userId+email); per-request events → time-of-day; accepts/
 *    rejects; per-member spend; service accounts unresolved; no personal-plan
 *    usage API (Team/Enterprise only); retry is a gap.
 *  - GitHub Copilot: person daily only — NO sub-daily of any kind; tokens/
 *    prompts CLI-only; ai_credits per user; PR block; individual plans get
 *    spend context only, need Business/Enterprise.
 *  - Claude Code local logs: person (this machine's user); ms timestamps;
 *    ~30-day retention; spend estimated from tokens (no costUSD); prompt/code
 *    content never read; true accept/reject only via OTel (proxies otherwise).
 */
export const SCOPE_CLAIMS: Record<string, ScopeClaims> = {
  anthropic_console: {
    measures: [
      "Tokens used, by person, when each person has their own API key",
      "Claude Code work — sessions, lines of code, commits, and pull requests",
      "Which AI models were used, and activity by hour of day",
    ],
    cannotMeasure: [
      "People who sign in with their Anthropic login instead of an API key — they may be missing",
      "How many prompts or messages were sent",
      "Anything billed through AWS, Google Cloud, or Azure",
    ],
  },
  openai: {
    measures: [
      "Tokens and request counts — tied to a person when they use their own API key",
      "Which AI models were used, and activity by hour of day",
      "Total spend for the whole organization, by day",
    ],
    cannotMeasure: [
      "Who is behind a shared or service-account key — that usage stays account-level",
      "Spend for each person (only an organization-wide total is reported)",
      "Whether AI suggestions were accepted",
    ],
  },
  cursor: {
    measures: [
      "Each person's daily requests, lines added, and accept and reject counts",
      "Which AI models were used, and spend per person",
      "Activity by time of day, from per-request timestamps",
    ],
    cannotMeasure: [
      "Activity from shared service accounts — it can't be tied to a person",
      "Anyone on an individual (Hobby or Pro) plan — this needs a Team or Enterprise plan",
      "How often a request was retried",
    ],
  },
  github_copilot: {
    measures: [
      "Each person's daily Copilot activity, acceptance, and lines of code",
      "Which features and AI models were used, and AI Credits spent per person",
      "Pull requests created and merged with Copilot",
    ],
    cannotMeasure: [
      "Activity by time of day — Copilot reports whole days only",
      "Prompt and token counts outside the command line",
      "Usage for people on individual plans — they get spend context only, and it needs a Business or Enterprise plan",
    ],
  },
  claude_code_local: {
    measures: [
      "Your own Claude Code sessions, tokens, and which AI models you used — read from local log files",
      "Activity down to the minute",
      "Estimated spend, worked out from token counts",
    ],
    cannotMeasure: [
      "Anything older than about 30 days — older local logs are deleted automatically",
      "The content of your prompts or code — only counts and structure are ever read",
      "Whether you accepted or rejected each suggestion exactly (only rough signals)",
    ],
  },
};

/** Resolve claims for a vendor id, or null if none are registered. */
export function scopeClaimsFor(vendor: string): ScopeClaims | null {
  return SCOPE_CLAIMS[vendor] ?? null;
}
