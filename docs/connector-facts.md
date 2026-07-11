# Connector Facts — verified vendor API surfaces (W0-A)

**Status: DRAFT pending live verification → frozen at the W0-C freeze ceremony.**
Evidence date: **2026-07-04** (all citations retrieved live that day). Every claim is either
**cited** (source + retrieval date) or tagged **`needs-live-verification` (NLV-n)** with a
matching founder script in [`scripts/verify/`](../scripts/verify/). Keys never appear in
prompts or in this repo — scripts read them from environment variables.

This file is the contract all connector agents (W1-D, W1-E, W2-J) build against.
Post-freeze changes require an ADR in `docs/decisions/`.

---

## Summary table

| Vendor | Attribution level (§6.1) | Sub-daily signals | Backfill depth | Plan gate | External approval needed |
|---|---|---|---|---|---|
| GitHub Copilot | **Person** (per-user daily NDJSON reports) | **None** — daily only; `last_activity_at` timestamps only | Reports since 2025-10-10, rolling 1 year | Copilot **Business/Enterprise** + "Copilot usage metrics" policy on | **GitHub App** (org perm: *Organization Copilot metrics* read) — file now |
| Cursor | **Person** (per-user daily + per-request events) | **Yes** — `filtered-usage-events` per-request timestamps | 30-day windows, max lookback undocumented (NLV) | Teams vs Enterprise contradictory in docs (NLV); Analytics API likely Enterprise | None (admin API key) |
| Anthropic (Console) | **Person for API-key actors; OAuth/subscription actors currently missing (live bug)** | **Yes** — usage report `1m`/`1h` buckets | Claude Code Analytics: "retained, no deletion period"; usage/cost: undocumented (NLV) | Any Console org; AWS-platform orgs excluded | None (admin key) |
| Anthropic (claude.ai Enterprise) | **Person** (stable `user_id`) | **Yes** — `1h`/`1m` usage & cost buckets | Data floor **2026-01-01**; 365-day window | **Enterprise only**; Team = dashboard CSV, no API | None (Analytics key, primary owner) |
| OpenAI | **Person only via user-owned API keys**; else key/project level | **Yes** — `1m`/`1h`/`1d` usage buckets (costs `1d` only) | Undocumented; ≥90d widely reported (NLV) | Any API org; admin key = org owner | None (admin key) |
| Claude Code local logs | **Person** (the machine's user; identity via consented `oauthAccount`) | **Yes** — millisecond timestamps per record | **~30 days only** (`cleanupPeriodDays` default) | Any (local files) | None (device token, user consent) |

**Cross-vendor consequences for the frozen contracts:**
- **Sub-daily schema (W0-C):** populatable from Cursor events, Anthropic 1h/1m buckets, OpenAI 1h buckets, and Claude Code local timestamps — but **not from Copilot**. W2-K shared-account heuristics must degrade to daily-grain + `last_activity_at` deltas for Copilot subjects.
- **Backfill (W1-D):** 30–90 days is achievable everywhere except Claude Code local (~30 days hard) and claude.ai Enterprise Analytics (floor 2026-01-01). Cursor and Anthropic Console need windowed iteration (30-day / 31-bucket caps); Copilot needs one call per day per report type.
- **Attribution honesty (invariant b):** three vendors have person-level holes that must surface in UI, never be papered over: Anthropic Console misses OAuth users (bug #27780), OpenAI is person-level only for user-owned keys, Copilot server-side-telemetry users appear in totals but not breakdowns.
- **Restatement/latency:** every vendor revises recent data (Copilot ≤3 days, Cursor ~hourly + late arrivals, Anthropic 5min–D+4, OpenAI up to ~24h). The poller must re-fetch a trailing window and **upsert** (idempotent keys are a W0-C contract item), never insert-once.

---

## 1. GitHub Copilot

> **The pre-2026 API is dead.** The Oct-2024 "Copilot Metrics API" (`GET /orgs/{org}/copilot/metrics`, `since`/`until`, 27-day history) was **sunset 2026-04-02**; the user-level Feature Engagement and Direct Data Access APIs sunset 2026-03-02 ([changelog 2026-01-29](https://github.blog/changelog/2026-01-29-closing-down-notice-of-legacy-copilot-metrics-apis/), retrieved 2026-07-04). Build only against the **usage-metrics reports API** (GA 2026-02-27).

### Endpoints
Reports API — all GET, return `{download_links: [...], report_day}` (1-day) or `{download_links, report_start_day, report_end_day}` (28-day); data is **NDJSON files behind signed URLs** (two-hop fetch). Header `X-GitHub-Api-Version: 2026-03-10`. ([REST docs](https://docs.github.com/en/rest/copilot/copilot-usage-metrics), 2026-07-04)

- Org: `/orgs/{org}/copilot/metrics/reports/{organization-1-day | organization-28-day/latest | users-1-day | users-28-day/latest | user-teams-1-day}` — 1-day endpoints require `day=YYYY-MM-DD`.
- Enterprise: same five under `/enterprises/{enterprise}/copilot/metrics/reports/...`.
- **No team endpoints** — team metrics = join `users-1-day` × `user-teams-1-day` ([changelog 2026-05-14](https://github.blog/changelog/2026-05-14-team-level-copilot-usage-metrics-now-available-via-api/)).
- No pagination/`since`/`until`; 28-day is `/latest` only — **backfill iterates the 1-day endpoints**.
- Download domains: `copilot-reports.github.com` / `copilot-reports.*.ghe.com` (legacy `copilot-reports-*.b01.azurefd.net` during transition; Azure `*.blob.core.windows.net` fallback) ([changelog 2026-05-20](https://github.blog/changelog/2026-05-20-copilot-usage-metrics-reports-now-use-github-owned-download-urls/)). Link TTL undocumented (**NLV-C2**).

Seat/user management ([docs](https://docs.github.com/en/rest/copilot/copilot-user-management), 2026-07-04; "public preview, subject to change"):
- `GET /orgs/{org}/copilot/billing` — `seat_breakdown` (`total`, `active_this_cycle`, `inactive_this_cycle`, `added_this_cycle`, `pending_cancellation`, `pending_invitation`), policy fields, `plan_type`.
- `GET /orgs/{org}/copilot/billing/seats` — paginated (`per_page` max 100); per seat: `assignee`, `assigning_team`, **`last_activity_at`**, `last_activity_editor`, `last_authenticated_at`, `plan_type`.
- `GET /orgs/{org}/members/{username}/copilot`.

Spend (AI Credits since the **2026-06-01 usage-based-billing switch**; [billing docs](https://docs.github.com/en/rest/billing/usage), 2026-07-04):
- `GET /organizations/{org}/settings/billing/ai_credit/usage` — **per-user rows**; enterprise + personal (`/users/{username}/settings/billing/ai_credit/usage`) variants. Fields: `usageItems[]{product, sku, model, unitType, pricePerUnit, grossQuantity, grossAmount, discountQuantity, discountAmount, netQuantity, netAmount}`; params `year/month/day`; 24-month lookback; day grain. Org-billed users are excluded from their personal endpoint.

### Auth
- **GitHub App (the Revealyst path): org permission "Organization Copilot metrics" (read)** covers exactly the five org report endpoints; enterprise permission "Enterprise Copilot metrics" (read) for enterprise ([App permissions reference](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps), 2026-07-04). Seat endpoints: org permission **"GitHub Copilot Business"** (read). Billing usage: **"Administration" (read)** + org-admin caller (heavyweight — see `docs/approvals.md`).
- Classic PAT: `read:org` / `manage_billing:copilot` (org), `read:enterprise` (enterprise).
- Signed download URLs need no extra auth (undocumented; **NLV-C3**).

### Plan tier
Copilot **Business or Enterprise** org/enterprise-managed plans only; the **"Copilot usage metrics" policy** must be enabled (a 403/empty may mean policy-off, not no-usage). The old 5-licensed-users org minimum is not documented for the new API; only per-team suppression is documented (**NLV-C5**). Business-on-non-Enterprise-Cloud org: **NLV-C6**.

### Granularity & sub-daily
Org aggregate, enterprise aggregate, and **true per-user daily records** (`user_id`, `user_login` per NDJSON row). Time grain: **UTC calendar day — no sub-daily signals of any kind** (event-level API sunset). Only timestamps: `sampled_at` on last-known-version fields, seat `last_activity_at`.

### Historical depth
"Reports are available starting from October 10, 2025, and historical data can be accessed for up to 1 year from the current date" (REST docs, 2026-07-04). Billing usage: 24 months. Seat `last_activity_at`: point-in-time — poll and persist.

### Rate limits
No Copilot-specific limits documented; assume standard REST pools (5,000/hr, 15,000/hr for GHEC App installs) (**NLV-C4**). Listing is cheap (1 req/day/report-type/org); downloads likely outside REST quota (**NLV-C3**).

### Field inventory → Level-1 mapping
Per-user report fields ([reference](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics), 2026-07-04): `day`, `enterprise_id`, `organization_id`, `user_id`, `user_login`, `ai_credits_used`, `user_initiated_interaction_count`, `code_generation_activity_count`, `code_acceptance_activity_count`, `loc_suggested_to_add_sum`, `loc_suggested_to_delete_sum`, `loc_added_sum`, `loc_deleted_sum`, `used_agent`, `used_chat`, `used_cli`, `used_copilot_coding_agent` (alias `used_copilot_cloud_agent`), `used_copilot_code_review_active/passive`, `ai_adoption_phase{phase_number 0–3, phase, version}`, `totals_by_cli{session_count, request_count, prompt_count, token_usage{prompt_tokens_sum, output_tokens_sum, avg_tokens_per_request}, last_known_cli_version}`, `totals_by_ide[]`, `totals_by_feature[]`, `totals_by_language_feature[]`, `totals_by_language_model[]`, `totals_by_model_feature[]`. Breakdown dimensions: `ide` (vscode, visualstudio, intellij, eclipse, xcode, neovim, vim, emacs, zed), `feature` (code_completion, chat_inline, chat_panel_ask_mode, chat_panel_edit_mode, chat_panel_agent_mode, chat_panel_plan_mode, chat_panel_custom_mode, chat_panel_unknown_mode, agent_edit, copilot_cli, others), `language`, `model` (specific ids + auto/unknown/others).

Aggregate extras: `daily/weekly/monthly_active_users` (+ chat/agent/cloud-agent/code-review/CLI actives), `totals_by_ai_adoption_phase[]`, `pull_requests{total_created, total_reviewed, total_merged, median_minutes_to_merge, total_created_by_copilot, total_merged_created_by_copilot, total_copilot_suggestions, total_copilot_applied_suggestions, ...}`.

| Level-1 metric | Source |
|---|---|
| Active users | row presence in `users-1-day`; aggregate DAU/WAU/MAU; seat `last_activity_at` corroboration |
| Sessions | **CLI only** (`totals_by_cli.session_count`) — IDE sessions: gap |
| Prompts/messages | `user_initiated_interaction_count`; CLI `prompt_count`/`request_count` |
| Tokens | **CLI only** (`token_usage.*`) — IDE tokens: gap |
| Spend | `ai_credits_used` (per-user daily, since 2026-06-19); billing API `netAmount` etc. |
| Model mix | `totals_by_language_model[]`, `totals_by_model_feature[]` |
| Acceptance | `code_acceptance_activity_count / code_generation_activity_count`; LoC ratio `loc_added_sum / loc_suggested_to_add_sum`. Retry: gap |
| Feature usage | `used_*` booleans; `totals_by_feature[]` |
| Output shipped | `loc_added_sum`/`loc_deleted_sum`; PR block (`total_merged_created_by_copilot`, `total_copilot_applied_suggestions`) |
| Engaged days | count of days user appears in `users-1-day` (engine-computed); `ai_adoption_phase` cohort |

### Attribution level
**Person** (user_id + user_login per row). Caveat (invariant b): server-side-telemetry-only users appear in active-user **totals** but may be missing from breakdown arrays — never compute actives by summing breakdowns; never fabricate per-user detail for them.

### §6a.2 gap claim
**Confirmed for usage metrics** (no `/users/{username}/copilot/metrics/*`; individuals get only the in-IDE status dashboard). **Refuted for spend**: personal-plan users can pull per-model daily AI-credit spend via `GET /users/{username}/settings/billing/ai_credit/usage` with their own token — Personal mode gets Copilot spend context, not usage metrics.

### Quirks
Two-hop fetch with expiring links · data finalizes ≤3 full UTC days and **past days are restated** (re-fetch after D+3, upsert) · all UTC · breakdown arrays under-count vs totals (server-side telemetry) · IDE-telemetry opt-out removes per-user detail but not active counts · CLI siloed from IDE metrics · teams <5 seats excluded from `user-teams-1-day` (surface, don't zero-fill) · monthly schema churn — parse NDJSON leniently · legacy metrics don't reconcile with new reports.

### Needs-live-verification → `scripts/verify/copilot.mjs`
NLV-C1 App-permission end-to-end (Organization Copilot metrics read alone suffices?) · NLV-C2 download-link TTL · NLV-C3 download auth/quota · NLV-C4 rate-limit headers · NLV-C5 <5-seat org behavior · NLV-C6 Business on non-GHEC org · NLV-C7 `day` bounds + availability lag & error shapes · NLV-C8 28-day latest-only · NLV-C9 restatement magnitude D+1..D+5 · NLV-C10 NDJSON file count/compression/sharding · NLV-C11 `ai_credits_used` vs billing reconciliation · NLV-C12 billing-API App permission + Copilot `sku` values · NLV-C13 org-billed user's personal endpoint empty · NLV-C14 personal-plan 403 on org endpoints · NLV-C15 policy-off status code · NLV-C16 suppression shape in user-teams · NLV-C17 legacy endpoint tombstone responses.

---

## 2. Cursor

Base URL **`https://api.cursor.com`**. Docs moved to `cursor.com/docs` (old `docs.cursor.com` 308-redirects). ([API overview](https://cursor.com/docs/api), 2026-07-04)

### Endpoints
**Admin API** ([docs](https://cursor.com/docs/account/teams/admin-api), 2026-07-04):

| Endpoint | Method | Purpose |
|---|---|---|
| `/teams/members` | GET | Roster: `id`, `email`, `name`, `role`, `isRemoved` |
| `/teams/daily-usage-data` | POST | **Per-user per-day** usage; body `{startDate, endDate}` epoch **ms**; ≤30-day window ("make multiple requests for longer periods" — tightened from 90 in 2025); with `page`/`pageSize` returns all members + `isActive`, **without pagination returns active users only** |
| `/teams/spend` | POST | Per-member spend, **current billing cycle only** |
| `/teams/filtered-usage-events` | POST | **Event-level** records per AI request; filters `userId`, `email`, `serviceAccountId`, `hostingType`; `page`/`pageSize` (default 10) |
| `/teams/audit-logs` | GET | Event-level audit trail (**Enterprise**); 30-day max window |
| `/teams/groups` (+`/:groupId`, `/members`) | GET/POST/PATCH/DELETE | Billing groups; `?billingCycle=YYYY-MM-DD` returns past cycles with per-member `dailySpend[]` — **the only daily spend series** |
| `/teams/user-spend-limit`, `/teams/remove-member` | POST | **Enterprise only** |

**Analytics API** ([docs](https://cursor.com/docs/account/teams/analytics-api), 2026-07-04): GET, `startDate`/`endDate` (`YYYY-MM-DD`/ISO/`7d`, default 7d, **max 30-day range**, resolve 00:00:00 UTC), optional `users` (emails or `user_abc123`). Team: `/analytics/team/{agent-edits, tabs, dau, models, client-versions, top-file-extensions, mcp, commands, plans, skills, ask-mode, leaderboard, bugbot, conversation-insights}`. Per-user: `/analytics/by-user/{agent-edits, tabs, models, top-file-extensions, client-versions, mcp, commands, plans, skills, ask-mode}` (envelope `{data: {email: [...]}, pagination, params.userMappings}`).

**AI Code Tracking API** ([docs](https://cursor.com/docs/account/teams/ai-code-tracking-api), 2026-07-04; **Enterprise, Alpha**): `/analytics/ai-code/{commits, changes}` (+`.csv`, `/commits/:commitHash`).

### Auth
Basic auth, key as username, empty password (`-u KEY:`); Bearer also accepted ("Both schemes behave identically"). Keys created by **team admins** in dashboard → API Keys; **org-scoped, visible to all admins, survive creator departure**; format `crsr_` + 64 hex; scope `admin:*` for Admin + AI Code Tracking. No documented expiry/rotation. ([API overview](https://cursor.com/docs/api), 2026-07-04)

### Plan tier — contradictory docs (**NLV-U1**)
APIs Overview table says **"Enterprise teams"** for Admin/Analytics/AI-Code-Tracking APIs, but inside the Admin API page only `user-spend-limit` and `remove-member` carry Enterprise badges (2025 behavior: Admin API worked on Teams). Pricing: Teams $40/user/mo with "usage analytics"; Enterprise adds audit logs, service accounts, AI code tracking, SCIM. Working assumption: **Teams gets core Admin API; Analytics + AI Code Tracking need Enterprise — verify live.**

### Granularity & sub-daily
`daily-usage-data`: per-user × per-day (pipeline aggregates hourly — today's row mutates; poll ≤1/hr). **Sub-daily: yes, via `filtered-usage-events`** — per-request `timestamp` (epoch-ms string) feeds the active-hours histogram + peak-concurrency schema. Analytics API strictly daily. No session concept anywhere — synthesize from event timestamps.

### Historical depth
30-day window caps per request (daily-usage-data, audit-logs, Analytics). **Max lookback undocumented** for daily-usage-data / filtered-usage-events (**NLV-U2**); `/teams/spend` current cycle only; past cycles via `groups?billingCycle=` — depth undocumented (**NLV-U3**).

### Rate limits
Admin API **20 req/min/team** (most endpoints; user-spend-limit 250, remove-member 50); Analytics team 100/min, by-user 50/min, conversation-insights 20/min; AI Code Tracking 20/min per endpoint; 429 on exceed. Docs recommend backoff + ETag caching — **304 (Not Modified) responses do not count against rate limits**, and Analytics date shortcuts (`7d`) cache better than timestamps; AI Code Tracking ingests near-real-time and "can be polled every few minutes", vs ≤1/hr for daily-usage-data/filtered-usage-events. ([API overview](https://cursor.com/docs/api), 2026-07-04, re-confirmed via Context7 index same date)

### Field inventory → Level-1 mapping
`daily-usage-data.data[]`: `userId`, `email`, `day`, `date`, `isActive`, `totalLinesAdded/Deleted`, `acceptedLinesAdded/Deleted`, `totalApplies/Accepts/Rejects`, `totalTabsShown/Accepted`, `composerRequests`, `chatRequests`, `agentRequests`, `cmdkUsages`, `bugbotUsages`, `subscriptionIncludedReqs`, `apiKeyReqs`, `usageBasedReqs`, `mostUsedModel`, `applyMostUsedExtension`, `tabMostUsedExtension`, `clientVersion`. **No tokens, no per-model breakdown here.**

`filtered-usage-events.usageEvents[]`: `timestamp`, `userEmail`, `serviceAccountId/Name`, `model`, `kind` (enum undocumented — **NLV-U11**), `maxMode`, `isHeadless`, `isTokenBasedCall`, `isChargeable`, `requestsCosts`, `tokenUsage{inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalCents, discountPercentOff}`, `chargedCents` (reconciliation field), `cursorTokenFee`.

`spend.teamMemberSpend[]`: `userId`, `email`, `role`, `spendCents`, `overallSpendCents`, `fastPremiumRequests`, `hardLimitOverrideDollars`, `monthlyLimitDollars`; top-level `subscriptionCycleStart`. (Community reports undocumented `includedSpendCents` — **NLV-U4**.)

Analytics: agent-edits/tabs daily accept/reject/LoC fields (`total_accepted_diffs`, `total_green_lines_accepted`, ...); `/team/dau` (`dau`, `cli_dau`, `cloud_agent_dau`, `bugbot_dau`); `/team/models` (`model_breakdown{model: {messages, users}}`); mcp/commands/skills/plans/ask-mode usage; leaderboard (`accept_ratio`, `line_acceptance_ratio`, `rank`). AI Code Tracking commits/changes: `commitHash`, `userId/Email`, `repoName`, `commitSource`, `tabLinesAdded/Deleted`, `composerLinesAdded/Deleted`, `nonAiLinesAdded/Deleted`, `commitTs`, per-file `metadata[]`.

| Level-1 metric | Source |
|---|---|
| Active users / engaged days | `isActive` + row presence per day (paginate or undercount!); `/team/dau` |
| Sessions | synthesized from `filtered-usage-events` timestamps only |
| Prompts/messages | `composerRequests + chatRequests + agentRequests + cmdkUsages`; event counts; `/team/models` messages |
| Tokens | `tokenUsage.*` per event only |
| Spend | `chargedCents` per event; `/teams/spend` per cycle; groups `dailySpend[]` for daily series |
| Model mix | event `model` (exact); `mostUsedModel` (coarse); `/team/models` |
| Acceptance | `totalAccepts/(totalAccepts+totalRejects)`; tabs funnel; leaderboard ratios. Retry: gap |
| Feature usage | per-surface request counts; mcp/commands/skills endpoints; event `kind` |
| Output shipped | accepted/total LoC; AI Code Tracking commit-level AI-vs-human lines (Enterprise) |

### Attribution level
**Person** (numeric `userId` + `email`). Service accounts (`serviceAccountId`) = unresolved subjects — surfaced, not billed (tracked_user rule).

### §6a.2 gap claim
**Confirmed**: no personal usage API for Hobby/Pro individuals; all usage/analytics APIs are team surfaces ([forum, Dec 2025](https://forum.cursor.com/t/get-usage-stats-by-api/144767), 2026-07-04). Individuals get the web dashboard only. Caveat: community references to a personal usage-events **CSV export** in the dashboard — undocumented officially (**NLV-U9**); if real, it's a manual-upload candidate for Personal mode, not an API.

### Quirks
Privacy mode does **not** suppress usage metrics (governs content retention/training; AI Code Tracking may omit `fileName`) · hourly aggregation latency, today's row mutates, trailing 24–48h unstable · Analytics dates resolve to UTC midnight; daily-usage-data timezone unconfirmed (**NLV-U6**) · known dashboard/API discrepancies — reconcile spend by summing `chargedCents`; don't promise dashboard parity · spend cycle silently rolls (`subscriptionCycleStart`) — snapshot before rollover · `isActive` only with pagination · AI Code Tracking Alpha: amended commits appear twice, hashes not unique · conversation-insights returns **401** when feature-disabled (not an auth failure) · SCIM-synced groups immutable via API.

### Needs-live-verification → `scripts/verify/cursor.mjs`
NLV-U1 Admin/Analytics API on Teams plan (200 vs 401/403 per endpoint) · NLV-U2 max lookback daily-usage-data + events · NLV-U3 `billingCycle` past-cycle depth · NLV-U4 undocumented spend fields · NLV-U5 legacy `key_` prefix validity · NLV-U6 daily-usage-data timezone straddle test · NLV-U7 latency + row-mutation window · NLV-U8 privacy-mode field diff · NLV-U9 personal dashboard CSV export schema · NLV-U10 events window/pageSize caps + 429/`Retry-After` · NLV-U11 `kind` enum values · NLV-U12 1-seat Teams org (Personal-as-org-of-one) · NLV-U13 rate-limit accounting shared vs per-endpoint.

---

## 3. Anthropic

> **Three separate surfaces, split by org type — a structural fact the connector must model** ([Analytics APIs](https://platform.claude.com/docs/en/manage-claude/analytics-api); [Admin API keys](https://platform.claude.com/docs/en/manage-claude/admin-api-keys), 2026-07-04). Docs moved to `platform.claude.com`; API base stays `https://api.anthropic.com`.

| Surface | Org type | Key |
|---|---|---|
| Usage & Cost + Claude Code Analytics | Claude Console (API) orgs | Admin key `sk-ant-admin01-…` (admin-role members create; no scopes — full access) |
| **Claude Enterprise Analytics API** (data floor 2026-01-01) | claude.ai Enterprise orgs | Analytics key `sk-ant-api01-…` with `read:analytics`, created by **primary owner** in claude.ai |
| Org management (users/workspaces/keys) | Console orgs | Admin key or OAuth `org:admin` |

Keys are **not interchangeable** across surfaces; one org's key never reads another org. Regular API keys read none of it. Claude Code via Bedrock/Vertex/Foundry/AWS platform is tracked by **neither** analytics surface; AWS-platform orgs lack Usage/Cost + Claude Code Analytics entirely.

### Endpoints (Console)
- `GET /v1/organizations/usage_report/messages` — `starting_at` (RFC 3339), `bucket_width` **`1m`/`1h`/`1d`** (caps 1440/168/31 buckets per request), `group_by[]`: `account_id`, `api_key_id`, `context_window`, `inference_geo`, `model`, `service_account_id`, `service_tier`, `speed` (beta), `workspace_id`; matching filters. ([reference](https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-messages-usage-report), 2026-07-04)
- `GET /v1/organizations/cost_report` — **`1d` only**; `group_by[]`: `description`, `workspace_id`. Priority Tier excluded; code execution appears only here. ([reference](https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-cost-report), 2026-07-04)
- `GET /v1/organizations/usage_report/claude_code` — `starting_at` = **one UTC day per call** (`YYYY-MM-DD`), `limit` ≤1000, cursor `page`. 90-day backfill = 90 calls. ([reference](https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_claude_code), 2026-07-04). **Param discrepancy (NLV-A13):** the `platform.claude.com/docs/en/api/admin` reference (via Context7 index, retrieved 2026-07-04) shows a `start_date`/`end_date` **range** variant with an `Authorization: Bearer $ANTHROPIC_OAUTH_TOKEN` example, while the guide page shows single-day `starting_at` + `x-api-key`. If the range variant is live, a 90-day backfill is 1 paginated call, not 90 — the verify script probes both param styles.
- Org management: `/v1/organizations/{me, users, invites, workspaces, workspaces/{id}/members, api_keys}`; keys cannot be created via API; service-account/WIF endpoints need OAuth `org:admin`. Rate Limits API since 2026-04-24.

### Endpoints (claude.ai Enterprise Analytics, all under `/v1/organizations/analytics/`)
`summaries` (org DAU/WAU/MAU, seats, per-product actives incl. `claude_code_daily_active_user_count`; params `starting_date` ≥2026-01-01, ≤366-day span) · `users` (**per-user daily** incl. `claude_code_metrics`; `limit` ≤1000) · `usage_report` + `user_usage_report` (tokens, `bucket_width` `1d|1h|1m`; group_by adds `product`, `rbac_group_id`; filter `user_ids[]`) · `cost_report` + `user_cost_report` (**per-user spend**, `amount`/`list_amount`). ([reference](https://platform.claude.com/docs/en/api/admin/analytics), 2026-07-04)

### Plan tier
Console Admin API: any Console **organization** ("unavailable for individual accounts" — but every API account is an org; Claude Code Analytics "free to use for all organizations with access to the Admin API"). Enterprise Analytics: **Enterprise only**; seat-based plans get usage-credit views. **claude.ai Team: dashboard + CSV export only, no API** (**NLV-A6**) ([analytics dashboard](https://code.claude.com/docs/en/analytics), 2026-07-04).

### Granularity & sub-daily
Usage report: **1m/1h/1d** — sub-daily yes, per api_key/workspace/account. Cost report: 1d. Claude Code Analytics: daily per **actor**; identity = `actor.email_address` (`user_actor`, OAuth) or `actor.api_key_name` (`api_actor`) — **email is the identity key; no stable user UUID** (Console). Enterprise: stable `user_id` (survives deletion), 1h/1m usage+cost buckets (1m capped: 256 buckets; per-user 1m ≤24h span).

### Historical depth
Console usage/cost: undocumented floor (**NLV-A3**); windowed iteration per bucket caps. Claude Code Analytics: "retained... no specified deletion period" (**NLV-A4**). Enterprise: floor 2026-01-01, ≤365 days back, ≤31-day usage/cost span per request; cost revisable ≤30 days.

### Rate limits
Console usage/cost: none hard-documented; guidance "polling once per minute for sustained use; bursts acceptable for pagination" (**NLV-A5**). Enterprise Analytics: **60 req/min per org** (documented), raisable.

### Field inventory → Level-1 mapping
Usage report result: `uncached_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `.ephemeral_1h_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `server_tool_use.web_search_requests`, `api_key_id`, `workspace_id`, `account_id` (OAuth requests), `service_account_id`, `model`, `service_tier`, `context_window`, `inference_geo`. **No request count** (Enterprise version has `requests`).

Cost report result: `amount` (**decimal string, cents** — parse as decimal, never float), `currency`, `description`, `cost_type` (`tokens|web_search|code_execution|session_usage` — `session_usage` new/undocumented, **NLV-A7**), `token_type`, `model`, `service_tier`, `context_window`, `workspace_id`.

Claude Code Analytics record: `date`, `actor{type, email_address | api_key_name}`, `organization_id`, `customer_type` (`api|subscription`), `subscription_type` (`enterprise|team`|null — no pro/max value), `terminal_type`, `core_metrics{num_sessions, lines_of_code{added, removed}, commits_by_claude_code, pull_requests_by_claude_code}`, `tool_actions{edit_tool|multi_edit_tool|write_tool|notebook_edit_tool}{accepted, rejected}`, `model_breakdown[]{model, tokens{input, output, cache_read, cache_creation}, estimated_cost{amount (number, cents), currency}}`.

Enterprise `claude_code_metrics`: same concepts, **different names** (`distinct_session_count`, `commit_count`, `pull_request_count`, `lines_of_code.added_count/removed_count`, `tool_actions.*.accepted_count/rejected_count`) — normalize in the connector. Money: decimal-string cents here vs number cents in Claude Code Analytics — normalize.

| Level-1 metric | Console source | Enterprise source |
|---|---|---|
| Active users / engaged days | distinct actors per day in `/claude_code` | `summaries` actives; `/users` per day |
| Sessions | `num_sessions` | `distinct_session_count` |
| Prompts/messages | **gap** (no request count) | `chat_metrics.message_count`; `requests` |
| Tokens | usage report; per-user via `model_breakdown` | usage/user_usage reports |
| Spend | cost report (authoritative); per-user `estimated_cost` (estimate — label it) | cost/user_cost reports (`amount`, `list_amount`) |
| Model mix | `group_by=model`; `model_breakdown` | `group_by=model` |
| Acceptance | `tool_actions accepted/(accepted+rejected)` | same (`_count`) |
| Retry | **gap everywhere** | gap |
| Feature usage | `terminal_type`, `server_tool_use`, `service_tier` | per-product blocks, connector/skill usage |
| Output shipped | `commits_by_claude_code`, `pull_requests_by_claude_code`, LoC | `commit_count`, `pull_request_count`, LoC |

Sub-daily for W2-K: 1m/1h usage buckets per `api_key_id`/`account_id` (Console) or per user (Enterprise) → active-hours histogram + concurrency proxy.

### Attribution level
Console: **person for API-key actors** (via key→owner mapping) and email-identified OAuth actors *when returned* — see gap below; account-level otherwise. Enterprise: **person** (stable `user_id` + email).

### Spec gap claim — CONFIRMED, and worse than stated
Docs say `/usage_report/claude_code` returns OAuth `user_actor` records with `customer_type: "subscription"` (`subscription_type` ∈ enterprise|team). In practice, per **open bug [anthropics/claude-code#27780](https://github.com/anthropics/claude-code/issues/27780)** (opened 2026-02-23; predecessors auto-closed unanswered): **only `customer_type:"api"` records are ever returned — OAuth/subscription actors are missing**. One org lost visibility of ~15 engineers after migrating to OAuth auth. Population map today:
- API-key Claude Code users (Console org): ✔ reliable.
- OAuth users billed to Console org: documented but **missing in practice** (NLV-A1). Possible partial workaround: `account_id`/`account_ids[]` on the messages usage report for token counts (**NLV-A2**).
- claude.ai Enterprise seats: covered by the separate Enterprise Analytics API (data ≥2026-01-01).
- claude.ai **Team** seats: **no API at all** — dashboard CSV only (the real hole).
- Individual Pro/Max: invisible to every org API → Personal mode uses the local-ingest path (§5 below).
**Connector must surface "OAuth users may be missing" for Console orgs — never fabricate.**

### Quirks
Everything UTC; `starting_at` inclusive, `ending_at` exclusive · freshness: usage/cost ~5min; Claude Code ~1h (only returns data >1h old); Enterprise engagement D+4, cost ~4–24h, revisable ≤30 days — pin `ending_at ≤ data_refreshed_at` · pagination `has_more`/`next_page`; Enterprise cursors bound to exact query (param change mid-walk → 400) · money-format inconsistency (decimal-string vs number cents) · field-name drift Console vs Enterprise · `api_key_id: null` = Workbench; `workspace_id: null` = default workspace · `inference_geo: "not_available"` for pre-Feb-2026 models · `speed` needs `anthropic-beta: fast-mode-2026-02-01` · bracket-repeat list params · send a distinctive `User-Agent`.

### Needs-live-verification → `scripts/verify/anthropic.mjs`
NLV-A1 subscription/OAuth actors in `/claude_code` (bug #27780 repro) · NLV-A2 `account_id` group_by as OAuth workaround + join to org users · NLV-A3 usage/cost history floor (binary-search `starting_at`) · NLV-A4 `/claude_code` earliest date ≥90d · NLV-A5 real 429 thresholds/headers · NLV-A6 Team-org Analytics-key creation rejected; CSV automation feasibility · NLV-A7 `session_usage` cost_type semantics · NLV-A8 dedup key: one record per (date, actor) or split by terminal_type? · NLV-A9 estimated_cost vs cost_report divergence · NLV-A10 Enterprise D+4 lag + 60rpm headers · NLV-A11 does subscription token usage appear in the messages usage report at all? · NLV-A12 usage-report `next_page` opacity · NLV-A13 `/claude_code` param style: does the `start_date`/`end_date` range variant work (1 ranged backfill call), or only single-day `starting_at` (90 calls for 90 days)?

---

## 4. OpenAI

One connector, two credential modes (per execution plan W1-D): personal-key mode (individual = own org) and org-admin mode. Docs: developers.openai.com (platform.openai.com 403s unauthenticated fetches). All retrieved 2026-07-04.

### Endpoints
Usage (all `GET https://api.openai.com/v1/organization/usage/...`): `completions`, `embeddings`, `images`, `audio_speeches`, `audio_transcriptions`, `moderations`, `vector_stores`, `code_interpreter_sessions`, `file_search_calls`, `web_search_calls` (last two newer; exact result-object names **NLV-O10**).

Costs: `GET /v1/organization/costs`.

Params (usage): `start_time` (required, Unix s, inclusive), `end_time` (exclusive), `bucket_width` **`1m`/`1h`/`1d`** (default 1d; caps 1440/168/31 buckets), `limit`, `page` (cursor), `group_by` ⊆ {`project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier`} (+`source`/`size` images; vector_stores & code_interpreter_sessions: `project_id` only), filters `project_ids`, `user_ids`, `api_key_ids`, `models`, `batch`.
Params (costs): `bucket_width` **`1d` only**, `limit` 1–180, `group_by` ⊆ {`project_id`, `line_item`, `api_key_id`} — **no user_id on costs**.

Org listing (same admin key): `/v1/organization/users` (+`emails[]` filter), `/projects`, `/projects/{id}/api_keys`, `/projects/{id}/users`, `/projects/{id}/service_accounts`, `/projects/{id}/rate_limits`, `/admin_api_keys`, `/invites`, `/audit_logs`, and **new `/groups`** endpoints (**NLV-O13**).

### Auth
**Admin API key `sk-admin-…`**, `Authorization: Bearer`. Created only by **Organization Owners** (help-center claim, fetch-blocked — NLV-O14); via UI or `POST /v1/organization/admin_api_keys` (`name`, optional `expires_in_seconds` 1–31,536,000; omit = non-expiring); key object carries `owner`. **ERRATUM (verified live 2026-07-11, ADR 0026 — supersedes "No scopes — all-or-nothing"):** the admin surface enforces **per-endpoint scopes**, gated separately — `api.management.read` for the org listing (`/organization/users` etc.), `api.usage.read` for `/organization/usage/*` and `/organization/costs` — and the platform's 403 body references "restricted API key … necessary scopes", so a key can hold one scope without the other. Onboarding must therefore probe **both** scopes (`checkAdminKey` does: users + costs); a users-only probe passes usage-blind keys whose every poll then 403s. Admin keys can't call inference; project keys (`sk-proj-…`) can't read org usage/costs — **verified live (closes NLV-O2)**: HTTP **403**, body `{"error":"You have insufficient permissions for this operation. Missing scopes: api.management.read. …"}` (`api.usage.read` on usage/costs; note `error` is a **bare string**, not the usual `{error:{message}}` object).

### Plan tier
No documented plan restriction for usage/costs — available to API orgs generally (**NLV-O3** on free/tier-1). **ChatGPT is a different universe**: Enterprise/Edu get a Compliance API + User Analytics surface (workspace entitlement, not `sk-admin-` reachable); **ChatGPT Team has no analytics API** — out of scope, noted for §6a.2 honesty.

### Granularity & sub-daily
**1m/1h/1d usage buckets — sub-daily yes** (1h buckets → active-hours histogram). Costs: 1d only. **`user_id` = the org member who owns the API key used** (converging evidence: key `owner_type: user|service_account`; dashboard "top users" via key ownership; `/users` ids match filter). **The inference-request `user`/`safety_identifier` field does NOT surface in the Usage API.** Service-account keys attribute to no human. This is the most load-bearing attribution fact — **NLV-O1 (critical)**.

### Historical depth
Undocumented. Bucket caps per request but cursors walk further; community reports of a year+. 90-day daily backfill = 3 paginated usage calls or 1 costs call. Whether 1m/1h grain is retained for old dates: **NLV-O5**.

### Rate limits
None published for these endpoints (inference tiers don't apply). Implement generic 429/`Retry-After` backoff (**NLV-O6**).

### Field inventory → Level-1 mapping
Envelope: `{object: "page", data: [bucket], has_more, next_page}`; bucket `{start_time, end_time, results[]}`.
Results: completions `input_tokens`, `output_tokens`, `input_cached_tokens`, `input_audio_tokens`, `output_audio_tokens`, `num_model_requests` + grouped dims (null unless grouped); embeddings/moderations `input_tokens`, `num_model_requests`; images `images`, `num_model_requests` (+`source`, `size`); audio `characters`/`seconds`; vector_stores `usage_bytes`; code_interpreter_sessions `num_sessions`; costs `amount{value: float, currency: "usd"}`, `quantity`, `line_item`.

| Level-1 metric | Source |
|---|---|
| Active users / engaged days | `group_by=user_id`, 1d buckets: distinct users with `num_model_requests > 0` (key-owner attribution only) |
| Sessions | **gap** — no concept; 1h activity buckets as histogram proxy; never fabricate per-user sessions |
| Prompts/messages | `num_model_requests` (API calls; filter `batch=false` for interactive proxy) |
| Tokens | `input_tokens`, `output_tokens`, `input_cached_tokens`, audio splits |
| Spend | costs `amount.value` per day by project/key/`line_item`; **per-user spend must be derived** (usage × price list) and labeled estimated |
| Model mix | `group_by=model`; costs `line_item` |
| Acceptance/retry | **not available on this surface** |
| Feature usage | endpoint family + `service_tier`, `batch`, images `source` |
| Output shipped | not available |

### Attribution level & requirements (the key question)
1. **Per-user-owned API keys → person-level** (join `user_id` → `/organization/users` email). The only true person path.
2. Project-per-person convention → project-level, person-mapped by customer assertion — label inferred.
3. Shared/service-account keys → **key/account level**; key→person mapping is customer metadata.
4. Passing end-user ids in requests buys **nothing** here. A single backend key = zero person-level signal.
Fit to `tracked_user`: only user-owned-key usage resolves to billable persons; everything else is surfaced-not-billed. Peak concurrency per key is **not** derivable (no concurrency field) — heuristics limited to request-count-per-1h-bucket shapes.

### Personal-mode check
**Very likely works** (every API account is an org; owner creates admin key; no size gate documented) — matches "Personal mode = org of one". **NLV-O4** end-to-end on a real personal account.

### Quirks
Ungrouped responses null the dimension fields — always pass explicit `group_by` · `start_time` inclusive / `end_time` exclusive, Unix seconds; 1d buckets UTC-midnight (verify — NLV-O8) · latency: usage minutes-fresh, costs up to ~24h — re-fetch trailing ≥48h window and upsert (NLV-O7) · usage×price ≠ costs exactly; `/costs` is authoritative for spend; `line_item` coverage vs invoice **NLV-O9** · `api_key_id` grouping on costs is newer; join key names via `/projects/{id}/api_keys` · vector_stores + code_interpreter_sessions have no user/key dimension — never present per-person · batch inflates request counts · admin keys can expire → handle 401 re-auth · empty/zero buckets: confirm zero-fill (NLV-O8) · endpoint family grows — registry, not hardcoded list · fine-tuning training usage: costs-only (verify NLV-O9).

### Needs-live-verification → `scripts/verify/openai.mjs`
NLV-O1 **`user_id` semantics** (service-account key + `safety_identifier` vs user-owned key; assert null vs owner id; ids join `/users`) · ~~NLV-O2 project-key rejection status/body~~ **resolved 2026-07-11** (403 + bare-string `error` body, see Auth erratum) · NLV-O3 admin-key creation on fresh tier-1 org, non-owner blocked · NLV-O4 personal-org end-to-end · NLV-O5 history depth at 1d/1h/1m (30/90/180/400 days) · NLV-O6 429 threshold + headers · NLV-O7 usage & costs latency · NLV-O8 UTC bucketing + zero-fill · NLV-O9 costs `line_item` coverage vs invoice · NLV-O10 file_search/web_search result objects · NLV-O11 costs `api_key_ids` × `group_by=api_key_id` · NLV-O12 admin-key expiry behavior · NLV-O13 `/groups` availability on non-Enterprise · NLV-O14 re-confirm owner-only admin-key creation (help 9687866).

---

## 5. Claude Code local logs (Revealyst Agent source)

Evidence: live read-only inspection of a real Windows machine (Claude Code **2.1.197**, plus 2.1.146-era records; 982 records / 8 files) on 2026-07-04, corroborated by official docs + ccusage. Field names below are verbatim from real records; no message content was read.

### Locations
- Windows (observed): `%USERPROFILE%\.claude\projects\<encoded-cwd>\<sessionId>.jsonl`. macOS/Linux default `~/.claude/projects/` per docs ([data-usage](https://code.claude.com/docs/en/data-usage), 2026-07-04) — **NLV-L1** live confirm.
- Overrides: `CLAUDE_CONFIG_DIR` (comma-separated multi-path per ccusage; not on the official settings page — **NLV-L2**); ccusage also scans `~/.config/claude`. **Agent must scan `~/.claude/projects`, `~/.config/claude/projects`, and every `CLAUDE_CONFIG_DIR` path.**
- `.claude` root (v2.1.197): `projects/`, `sessions/`, `session-env/`, `plans/`, `backups/`, `shell-snapshots/`, `skills/`, `plugins/`, `settings.json`, `.last-cleanup`. No `todos/`/`statsig/` on this install — version-dependent. Identity/global state in `~/.claude.json` (`userID`, `machineID`, `oauthAccount`, `firstStartTime`, per-project map).
- Transcripts can be disabled (`CLAUDE_CODE_SKIP_PROMPT_HISTORY`, `--no-session-persistence`, SDK `persistSession: false`) — handle zero-transcript machines.

### Format
- Project dir encodes cwd lossily (`C:\Users\X\Desktop\y` → `C--Users-X-Desktop-y`); **trust the `cwd` field in records, not the dir name**. One append-only JSONL per session (`<uuid>.jsonl`). Subagents: `projects/<proj>/<sessionId>/subagents/agent-<id>.jsonl` + `.meta.json` (`agentType`, `spawnDepth`), records flagged `isSidechain: true`, **carry their own `usage` — include them or undercount spend**.
- Record types observed: `user`, `assistant`, `system` (`stop_hook_summary`), `attachment`, `queue-operation`, `last-prompt`, `ai-title`, `custom-title`, `mode`. Legacy types `summary` + field `costUSD` are **gone** in current versions (0/982 records) — parser must accept both eras (**NLV-L8**).
- Envelope fields: `uuid`, `parentUuid`, `sessionId`, `timestamp` (ISO-8601 ms), `type`, `cwd`, `version`, `gitBranch`, `isSidechain`, `userType`, `entrypoint`, `slug`. Assistant adds `requestId` + `message{id, model, role, content[], stop_reason, usage}`; user adds `message`, `promptId`, `toolUseResult` (polymorphic: dict/string/list), `permissionMode`, `isMeta`.
- `message.usage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}`, `server_tool_use{web_search_requests, web_fetch_requests}`, `service_tier`, `speed`, `inference_geo`, `iterations[]` (new; semantics undocumented — **NLV-L7**).
- Retention: `cleanupPeriodDays` **default 30**, deletion at startup ([settings](https://code.claude.com/docs/en/settings), 2026-07-04); live machine corroborates (install 2026-04-10, only recent files survive). mtime-vs-record-age semantics **NLV-L3**.

### ccusage compatibility (github.com/ccusage/ccusage, ccusage.com, 2026-07-04)
Parses all `*.jsonl` under both default roots + `CLAUDE_CONFIG_DIR`; reads `message.usage.*`, `message.model`, `message.id`, `requestId`, `timestamp`, legacy `costUSD`; cost modes auto/calculate/display — with `costUSD` gone, cost is always tokens × pricing tables (LiteLLM). **Revealyst must likewise compute spend and label it estimated.** Dedup: same `requestId` on multiple streamed entries, last-wins (ccusage #888) — **group by `requestId` (fallback `message.id`), keep final entry** (duplicate emission version-dependence: **NLV-L5**). Concepts: daily/monthly/session/5-hour billing blocks.

### OTel export (alternative managed path; [monitoring-usage](https://code.claude.com/docs/en/monitoring-usage), 2026-07-04)
Opt-in `CLAUDE_CODE_ENABLE_TELEMETRY=1`; OTLP push to a configured collector — **push-only, no local scrape endpoint, no backfill**. Metrics: `claude_code.session.count`, `.lines_of_code.count`, `.commit.count`, `.pull_request.count`, `.cost.usage`, `.token.usage`, `.active_time.total`, `.code_edit_tool.decision`. Events: `user_prompt` (text redacted unless `OTEL_LOG_USER_PROMPTS=1` — Revealyst never sets this), `api_request`, `api_error`, `tool_result`, `tool_decision` (the only true accept/reject signal). Attributes: `session.id`, `user.id`, `user.email`, `organization.id`, `terminal.type`. **Consequence: log-reading CLI is the zero-config + backfill path (V1); OTel receiver is a complementary enterprise path (later) — same metric names map to both.**

### Sub-daily — confirmed
Millisecond `timestamp` on every record; session = file; gives session start/end/gaps, active-hours histograms, cross-session concurrency, turn latency. Fully feeds the W0-C sub-daily schema.

### Historical depth
**≤ ~30 days** (default cleanup), less if user lowered it, zero if disabled. Agent must ingest immediately on install, then watch continuously. **Do not promise deep backfill for local data.**

### Field → Level-1 mapping
| Level-1 metric | Source (exact fields) |
|---|---|
| Active users | records present per machine/day; identity via `~/.claude.json` `oauthAccount` **with explicit consent** |
| Sessions | distinct `sessionId` (`isSidechain: false` = human sessions) |
| Prompts/messages | `type:"user"` records, `isMeta` false, non-tool-echo (check content block types); or `last-prompt` count |
| Tokens | `message.usage.*` deduped by `requestId` (subagent files included) |
| Spend | tokens × pricing per `message.model` — estimated, no `costUSD` |
| Model mix | `message.model` |
| Acceptance/retry | proxies only: `permissionMode` distribution, `plan_mode_exit` attachments, `toolUseResult.userModified`, hook `preventedContinuation`, `usage.iterations[]` length (NLV-L7); true accept/reject only via OTel `tool_decision` |
| Feature usage | `tool_use` block `name` (Edit/Bash/Agent/`mcp__*` → MCP + subagent adoption), `attachment.type: skill_listing` |
| Output shipped | `toolUseResult.gitOperation` key presence (commits/PRs detected without reading command text) — corroboration only; GitHub connector is truth |
| Engaged days | distinct active days; active time via timestamp-gap clustering (OTel `active_time.total` is the precise version) |

### Privacy line (frozen-contract input — §7: never raw prompt content)
**Allowlist (may summarize + transmit as aggregates):** `type`, `subtype`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `version`, `gitBranch` (**hash**), `cwd` (**hash or drop**), `isSidechain`, `userType`, `entrypoint`, `permissionMode`, `promptSource`, `origin.kind`, `requestId`, `message.id`, `message.model`, `message.stop_reason`, all `message.usage.*` numbers/enums, `diagnostics.cache_miss_reason`, content-block **types and counts**, `tool_use.name` (name only, never `input`), `attachment.type` (string only), `queue-operation.operation`, hook counters, `toolUseResult` **key presence only**, subagent `agentType`/`spawnDepth`.
**Denylist (never read beyond structural skip, never transmit):** `message.content` (all text/thinking/tool_use.input/tool_result), `toolUseResult` values (`stdout`, `stderr`, `originalFile`, `oldString`, `newString`, `structuredPatch`, ...), `lastPrompt`, `aiTitle`, `custom-title`, **`slug`** (prompt-derived — treat as content), attachment payloads, `queue-operation.content`, `plans/` (filenames included), `shell-snapshots/`, `session-env/`; `~/.claude.json` only `oauthAccount` email/org and only with explicit consent.
**Parser rule:** stream-parse per line, extract allowlisted keys, discard the buffer; never log raw lines on error.

### Version drift — high risk, plan for it
Already observed across two versions on one machine: `costUSD` removed, `summary` type replaced by sidecar records, new `usage.iterations[]`/`cache_creation.ephemeral_*`/`server_tool_use`/`speed`/`inference_geo`/`queue-operation`/`attachment` fields, polymorphic `toolUseResult`, directory-layout churn. **Parser requirements:** key off per-record `version`; unknown type → count-and-skip; every field optional; string-or-list content; dedup `requestId`→`message.id`; missing usage keys = 0; ship a schema-drift telemetry counter.

### Needs-live-verification → `scripts/verify/claude-code-local.mjs`
NLV-L1 macOS/Linux paths + POSIX cwd encoding · NLV-L2 `CLAUDE_CONFIG_DIR` official behavior + multi-path · NLV-L3 cleanup mtime-vs-record-age; subagent pruning · NLV-L4 other entrypoints' transcript variants (cli, sdk-ts, sdk-py, vscode) · NLV-L5 streaming duplicate `requestId` emission on current versions · NLV-L6 OTel traces-beta surface stability · NLV-L7 `usage.iterations[]` semantics (controlled experiment) · NLV-L8 obtain v1.x transcripts (`summary` + `costUSD`) to pin the legacy schema.

---

## Change log
- 2026-07-04: Initial draft from W0-A research fan-out (5 parallel agents, all claims cited or NLV-tagged). Pending: founder runs `scripts/verify/` with live keys; results fold back in before the W0-C freeze.
- 2026-07-04 (post-merge): Cross-checked all five vendors against Context7-indexed docs (GitHub REST, cursor.com/docs, platform.claude.com, developers.openai.com, code.claude.com). All core claims confirmed. Added: Cursor ETag/304 rate-limit exemption + AI Code Tracking near-real-time polling cadence; **NLV-A13** — Claude Code Analytics API shows two documented param styles (`starting_at` single-day vs `start_date`/`end_date` range with OAuth bearer); verify script now probes both, as the answer changes W1-D's backfill call count 90×→1×.
- 2026-07-11: **OpenAI Auth erratum (ADR 0026):** live 403s prove the admin surface enforces per-endpoint scopes (`api.management.read` vs `api.usage.read`, gated separately) — the "No scopes — all-or-nothing" claim was wrong. NLV-O2 resolved (project-key rejection = 403, bare-string `error` body). Drove the `checkAdminKey` two-scope probe + transient-rethrow fix in the OpenAI connector.
