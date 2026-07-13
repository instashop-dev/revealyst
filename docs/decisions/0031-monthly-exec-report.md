# 0031 — Monthly executive-report send state (`exec_report_state`)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** W6-F (Monthly Executive narrative one-pager), founder

## Context
W6-F ships the monthly executive memo (Spec V4 §5.4, §7.1): a distributable,
plain-English board one-pager composed from the existing AI-maturity read
(`readMaturityView`), the spend-governance read (`readSpendGovernance`), and the
attribution-coverage trend — a MEMO, not a chart wall, template-composed with
zero LLM (G6). It is emailed to workspace admins on a monthly cron, fanned out
through the existing `revealyst-poll` queue (one message per org), and also
served on demand as a downloadable HTML one-pager.

Two pieces of durable state are needed and neither fits an existing table:
1. **Idempotency.** The send runs on an at-least-once queue. Without a durable
   record of which month a memo has been sent for, a redelivery would re-mail
   every admin. The memo is ORG-LEVEL (one board memo per workspace, sent to all
   admins), unlike the per-user weekly digest, so the de-dup key is `(org,
   month)`, not `(org, user, week)`.
2. **Opt-in.** Admins need a workspace-level toggle to turn the monthly memo
   off. Because the memo is org-level, this is a single per-org setting, not a
   per-user preference — so reusing `digest_preferences` (per `(org, user)`,
   with its own `digest_enabled` lane default) would both mis-key the setting
   and risk flipping a user's unrelated digest default when a row is inserted.

`schema.ts`, `drizzle/**`, and the `org-scope.ts` public API are frozen, so this
additive change requires an ADR (rule 1).

## Decision
Add `exec_report_state`, **one row per `org_id`** (like `budgets`), carrying BOTH
concerns in a single row:
- `exec_report_enabled` (boolean, default `true`) — the workspace opt-in toggle.
  Default true because an exec memo is a wanted artifact; an org with no row yet
  is treated as enabled by the sender's absent-row default.
- `last_sent_month` (text, `"YYYY-MM"` UTC, nullable) — the idempotency
  high-water mark.

The monthly sender compare-and-sets the month via an upsert (`claimMonth`) whose
DO-UPDATE advances `last_sent_month` to the target month ONLY when the row is
enabled AND the stored month differs, BEFORE sending (claim-then-send). This
gates idempotency AND opt-out in the SAME atomic CAS: a disabled workspace never
claims (so never sends), and a redelivery for an already-sent month is a no-op.
A crash mid-send under-delivers (safe) rather than re-mailing. The claim is
per-org, so ONE claim covers the whole workspace and the sender then emails all
verified admins in that claim (reusing `listDigestRecipients`); a per-recipient
send failure means that admin misses this month's memo (safe under-delivery,
like the digest), never a double-send. Reads/writes go through a new
`forOrg(...).execReportState` namespace (`get`, `setEnabled`, `claimMonth`).

The compose path (`readExecReport`) is shared by the poller and the on-demand
export route, so the emailed memo and the downloadable one-pager are the same
composition. Compose reuses `composeNarrative` verbatim for the memo's opening
prose (extending the team-dashboard narrative into a distributable).

## Contracts affected
- **Schema** (`src/db/schema.ts` + `drizzle/0028_exec-report-state.sql`): new
  `exec_report_state` table. `org_id → orgs.id` ON DELETE CASCADE, plus the
  `(org_id, id)` composite-FK anchor and the `(org_id)` unique upsert/CAS target
  (D1a shape, like `budgets`).
- **Tenancy layer** (`src/db/org-scope.ts` public API): new `execReportState`
  namespace on the `forOrg` object. Registered in
  `tests/tenant-isolation.test.ts` (SCOPED_READS + non-vacuous B-org seed).
- **Account deletion** (`src/db/account-deletion.ts`): added to
  `PURGE_EXEMPT_TABLES` — it cascade-deletes with the org (like
  `budgets`/`digest_preferences`/`budget_alert_state`), so the final `orgs`
  delete removes it.
- **System read** (`src/db/system.ts`): additive `readOrgName` (cron-path,
  cross-org) so the poller can personalize the memo — no frozen surface.
- `tracked_user`, credential shape, metric catalog, `connector-facts.md`: none.

## Workstreams to re-sync
None depend on this table (it is new). W6-F pre-claimed **ADR 0031** and
**migration 0028** (W6-B claims 0030/0026 in parallel — no overlap; ADR and
migration are independent sequences). If a parallel workstream merges an ADR or
migration between this ADR's numbering and its merge, renumber before merging
(fleet parallel-fan-out rule).

## Consequences
- One extra per-org compose (the maturity + spend + usage reads in a single flat
  Promise.all, round-trip depth 1) per org per month at cron time — poller-time
  only, zero request-path cost. The on-demand export shares the same read path
  and IS on the request path (user-initiated, 402-gated like every data route).
- De-dup is per `(org, month)`: the whole workspace's memo sends once per month;
  a disabled workspace never claims. A workspace that re-enables mid-month still
  gets that month's memo on the next cron (the month was never claimed while
  disabled), because `setEnabled` leaves `last_sent_month` untouched.
- The toggle is workspace-level: one admin turning the memo off turns it off for
  all admins — intentional for a board artifact (documented in Settings).
