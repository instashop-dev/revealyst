# Architecture Decision Records

Post-freeze changes to a **frozen contract** (see `CLAUDE.md`) require an ADR here
before the change lands — rule 1. A contract change is a review-blocker until an ADR
is linked and the affected workstreams are re-synced.

- Scaffold one with **`/adr <title>`**.
- Numbering is sequential, zero-padded 4 digits; `0000-template.md` is the template.
- Keep them short — a decision record, not a design doc.
- Numbers and migration numbers are **independent sequences** — check `ls drizzle/*.sql`
  and `ls docs/decisions/` separately before claiming the next number (parallel-fan-out
  collisions have happened twice: 0009/0010 and 0014/0014 — see below).
- CI enforces unique 4-digit prefixes (`scripts/check-adr-numbers.mjs`, wired into the
  `check` job) — except the two bannered `0014` files below, which are a deliberate,
  documented collision (cite by slug, never bare number).

## Index

| # | Slug | Title | Status |
|---|---|---|---|
| 0000 | `template` | ADR template | — |
| 0001 | `tenant-isolation` | Tenant isolation: repository layer, not RLS | Accepted |
| 0002 | `agent-ingest` | Revealyst Agent device-token ingest (W1-E, additive) | Accepted |
| 0003 | `score-oracle-coverage` | Fluency + efficiency oracle rows in team-30d score-results fixture (additive) | Accepted |
| 0004 | `invite-flow` | Invite flow: invites table, membership org-resolution rule | Accepted |
| 0005 | `connector-runs` | `connector_runs` table + org-scope connectorRuns namespace (additive) | Accepted |
| 0006 | `connector-run-hardening` | Connector run/dispatch hardening (adversarial-review findings) | Accepted |
| 0007 | `benchmarks-table` | `benchmarks` table (additive) | Accepted |
| 0008 | `share-links-and-benchmark-consent` | `share_links` + `benchmark_consent` tables (additive) | Accepted |
| 0009 | `subscriptions-table` | `subscriptions` table + Paddle entitlement state (additive) | Accepted |
| 0010 | `audit-log` | Basic audit log (W3-O hardening) | Accepted |
| 0011 | `billing-checkout-portal-routes` | Billing checkout + portal API routes (additive) | Accepted |
| 0012 | `stale-team-org-score-reconciliation` | Stale team/org score reconciliation (W3 gate finding) | Accepted |
| 0013 | `connection-update-contract` | Connection update contract (rename + pause/resume) and delete implementation | Accepted |
| 0014 | `org-scope-batch-read-methods` | Add batch read methods to org-scope: `identities.all()` and `teams.allMembers()` | Accepted — **bannered numbering collision** (shares 0014 with `personal-person-level-presets`; kept as-is, cite by slug) |
| 0014 | `personal-person-level-presets` | Person-level score presets for personal orgs | Accepted — **bannered numbering collision** (shares 0014 with `org-scope-batch-read-methods`; kept as-is, cite by slug) |
| 0015 | `account-management-email-verification-and-deletion` | Account management: required email verification + account-deletion teardown | Accepted |
| 0016 | `platform-admin` | Platform-admin section: roles, guarded admin mutations, system-org audit | Accepted |
| 0017 | `org-scope-signals-batch-read-and-parallel-billing-reads` | Add `metrics.allSignals()` batch read; parallelize billing.trackedUsers reads | Accepted |
| 0018 | `settings-visibility-and-org-rename-routes` | Settings surface: org-scoped visibility-mode + rename write path | Accepted |
| 0019 | `poll-heartbeats-observed-at-index` | Add `poll_heartbeats.observed_at` index; operational-log retention | Accepted |
| 0020 | `budgets-table` | Spend Governance: `budgets` table, `forOrg.budgets` CRUD, and budget API routes | Accepted |
| 0021 | `custom-index-builder` | Custom Index Builder: org-scope methods, routes, and slug reservation | Accepted |
| 0022 | `copilot-connector-and-agentic-metrics` | GitHub Copilot connector, agentic metrics, and the AI-credits unit | Accepted |
| 0023 | `github-app-install-ownership` | Verify GitHub App installation ownership in the Copilot connect callback | Accepted |
| 0024 | `digest-preferences` | Weekly digest: `digest_preferences` table, cron/queue send, unauthenticated unsubscribe | Accepted |
| 0025 | `sync-window-incomplete-gap` | `sync_window_incomplete` honesty gap + a gap sink for the local agent | Accepted |
| 0026 | `openai-admin-key-scopes-erratum` | OpenAI admin-key scopes erratum + two-scope validateAuth probe | Accepted |
| 0027 | `org-scope-public-api-preserving-split` | org-scope: public-API-preserving split into namespace factories | Accepted |
| 0028 | `rec-interaction-state` | Recommendation interaction state (Outcomes-loop forerunner) | Accepted |
| 0029 | `budget-alert-crossing-state` | Budget-alert crossing state (`budget_alert_state`) | Accepted |
| 0030 | `roles-entity` | Roles entity (person → engineering-role assignment) | Accepted |
| 0031 | `monthly-exec-report` | Monthly executive-report send state (`exec_report_state`) | Accepted |
| 0032 | `renewal-reminders` | Renewal reminders (user-entered date + `renewal_reminder_state`) | Accepted |
| 0033 | `recommendation-catalog` | Recommendation catalog as seeded data | Accepted |
| 0034 | `migration-0018-adr-citation-erratum` | Erratum: migration 0018 ADR citation (0014 → 0015) | Accepted |
| 0035 | `capability-graph` | AI capability graph (relational catalog + rec→capability linkage) | Accepted |
| 0036 | `user-capability-state` | Per-person capability mastery state (`user_capability_state`) | Accepted |
| 0037 | `missions` | Missions & progression (measured, un-gamified) | Accepted |
| 0038 | `recommendation-exposure-log` | Recommendation exposure log (reverses "don't log rec-shown-to-X") | Accepted |
| 0039 | `otel-measured-tier` | OTel proficiency markers + the measured capability tier | Accepted |
| 0040 | `org-scope-unique-violation-cause-chain` | Fix: `isUniqueViolation` walks the error cause chain (renumbered from 0037 — T0.1) | Accepted |
| 0041 | `schema-split` | schema: public-API-preserving split into per-domain modules | Accepted |
| 0042 | `context-tokens-signal` | TEL-012 context-window usage signal (`context_tokens`); vocabulary + binding, emitter fixture-gated | Accepted |
| 0043 | `rec-interaction-clear-action` | Rec-interaction `cleared` API action (honest undo — deletes the row, never fabricates "tried") | Accepted |
| 0044 | `manager-role-tier` | Manager role tier (`team_managers`, D-TCI-3); derived from a per-team grant, Better Auth roles untouched, no per-person visibility | Accepted |
| 0045 | `manager-per-person-capability-and-spend-visibility` | Manager visibility of named per-person capability + spend (D-TCI-1/D-TCI-2); founder-signed privacy reversal, self-view rec/coaching/exposure stays forever, spend behind an admin toggle | Accepted |
| 0046 | `per-capability-team-history-rollup` | Per-capability team history rollup (D-TCI-6); append-only count-only periodic snapshot, deliberate compute-on-read exception, same-pure-function parity | Accepted |
| 0047 | `desktop-pkce-pairing` | Desktop-agent PKCE pairing (`desktop_pairing_codes` + `/api/desktop/auth/*`); stateless start, consent-time row, CAS single-use exchange minting the existing device token; Personal orgs only (D-DA-2) | Accepted |
| 0048 | `desktop-device-management` | Desktop device management (T2.4): heartbeat into `connections.config` jsonb (no migration) + `forOrg` additive `recordDeviceHeartbeat`/`deleteCredential`; self-owned `/api/desktop/heartbeat` + device rename/revoke routes + Settings → Devices tab | Accepted |
| 0049 | `desktop-signed-remote-config` | Desktop signed remote config (T4.2): `GET /api/desktop/config` device-token authed + Ed25519-signed body via `crypto.subtle` (no dep); new `DESKTOP_CONFIG_SIGNING_KEY` Worker secret (versioned, distinct from KEK) synced in deploy.yml; `defaultContentMode` pinned `analytics_only` three ways (never-broaden, spec §16.2); no frozen contract touched | Accepted |
| 0050 | `team-insight-feed` | Aggregate manager insight feed (`team_insights`, Phase 2-F); count-only, no stored prose, deterministic MIN_PEOPLE-suppressed generator, 3-insight cap, `new/viewed/dismissed` lifecycle (admin/manager dismiss); weekly brief folded into the digest (no new state table) | Accepted |
