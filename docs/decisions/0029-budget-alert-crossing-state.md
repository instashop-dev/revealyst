# 0029 — Budget-alert crossing state (`budget_alert_state`)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** W5-I (Email lanes & instrumentation), founder

## Context
Spend Governance (ADR 0020) computes the budget alert on-read from
`metric_records` with NO persisted alert state — deliberately, for the in-app
banner. W5-I adds budget-threshold EMAIL alerts, evaluated on every spend
refresh (after a successful connector poll). Email is a side effect: without a
durable record of which thresholds have already been emailed this month, every
poll that still sees spend over a threshold would re-send the same alert. The
frozen `budgets` table stores config only (one row per org, no per-crossing
state) and can't express "threshold T already alerted for month M". A new
org-scoped table is therefore required — additive, but `schema.ts`, `drizzle/**`,
and the `org-scope.ts` public API are frozen, so this ADR covers the change
(rule 1).

## Decision
Add `budget_alert_state`, one row per `(org_id, month_key)` where `month_key` is
the `"YYYY-MM"` UTC calendar month and `highest_alerted_threshold` (int, default
0) is the highest percent-of-budget threshold already emailed that month. The
sender compare-and-sets it (`claimThreshold`) via an upsert whose DO-UPDATE only
advances the value when the new threshold is strictly higher, BEFORE sending
(claim-then-send). This makes each threshold email EXACTLY once per
`(org, month)` even under at-least-once queue redelivery, mirroring
`digest_preferences.claimWeekAndRotateToken` (ADR 0024). A new UTC month is a
fresh row, so the monthly budget's thresholds re-alert. Reads/writes go through
a new `forOrg(...).budgetAlertState` namespace (`get`, `claimThreshold`).

## Contracts affected
- **Schema** (`src/db/schema.ts` + `drizzle/0025_budget-alert-state.sql`): new
  `budget_alert_state` table. `org_id → orgs.id` ON DELETE CASCADE, plus the
  `(org_id, id)` composite-FK anchor and the `(org_id, month_key)` unique CAS
  target (D1a shape, like `budgets`/`digest_preferences`).
- **Tenancy layer** (`src/db/org-scope.ts` public API): new `budgetAlertState`
  namespace on the `forOrg` object. Registered in
  `tests/tenant-isolation.test.ts` (SCOPED_READS + non-vacuous B-org seed).
- **Account deletion** (`src/db/account-deletion.ts`): added to
  `PURGE_EXEMPT_TABLES` — it cascade-deletes with the org (like
  `budgets`/`digest_preferences`), so the final `orgs` delete removes it.
- `tracked_user`, credential shape, metric catalog, `connector-facts.md`: none.

## Workstreams to re-sync
None depend on this table (it is new). The PARALLEL workstream sharing
`src/lib/digest-email.ts` (coaching-lane render blocks) and `src/poller/digest.ts`
is unaffected by the table; W5-I's only edits to those files are the additive
digest-UTM `wk` param (href strings + one `renderDigestEmail` call arg).

## Consequences
- One extra small read (`budgets.get` + two `metric_records` reads) per
  successful connector poll to evaluate the alert; most orgs have no budget, so
  it early-returns after the budget read. Poller-time only — zero request-path
  cost.
- De-dup is per `(org, month, threshold)`, not per recipient: one claim covers
  the org and emails all verified admins in that claim; a per-recipient send
  failure means that admin misses this threshold's alert (safe under-delivery,
  like the digest), never a double-send.
- A spend jump past several thresholds in one poll emails once, at the highest
  crossed threshold (`evaluateBudgetAlert` returns the highest) — intentional
  (one email, not a burst).
