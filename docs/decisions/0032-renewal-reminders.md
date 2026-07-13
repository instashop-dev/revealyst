# 0032 — Renewal reminders (user-entered date + `renewal_reminder_state`)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** W6-G (Renewal reminders), founder

## Context
Execution Plan V4 §4 (W6-G) / Spec V4 §11.3 asks for renewal reminders: email an
org's admins ahead of a connection's contract renewal so a spend commitment is
never auto-renewed unnoticed. **No vendor reports renewal dates** — the date is
supplied by the user and must be surfaced as user-entered, never inferred
(invariant b, honesty). Two things are therefore needed: (1) a place to store the
per-connection renewal date, and (2) durable send-state so each reminder fires
exactly once under the at-least-once poll queue. Both touch frozen contracts —
`src/db/schema.ts`, `drizzle/**`, `src/contracts/api.ts`, and the
`src/db/org-scope.ts` public API — so this ADR covers the change (rule 1).

## Decision
**Storage — a nullable column, not a table, for the date.** Add a nullable
`connections.renewal_date` (`date`, `"YYYY-MM-DD"`). A renewal date is a single
optional annotation on an existing connection; a nullable column is the simplest
honest model, adds no join, and rides the connection's existing lifecycle
(delete/purge). It defaults NULL for every existing row, so the frozen row is not
complicated. Set/cleared through the existing `connectionsUpdate` PATCH
(admin-only) and the `forOrg(...).connections.update` writer — one edit path for
all connection fields — with an omitted key leaving it untouched and `null`
clearing it. The date is added to the frozen `connectionSchema` response so the
connections UI can show and edit the current value.

**Send-state — a new org-scoped table.** Add `renewal_reminder_state`, one row
per `(connection_id, renewal_date, threshold)`. A daily cron (one message per
org) scans connections whose user-entered date is **exactly** 30 or 7 days out
(strict per-threshold equality — 29/8/31 do not fire) and, for each due
`(connection, date, threshold)`, CAS-claims a row via insert-if-absent
(`onConflictDoNothing().returning()`) BEFORE sending (claim-then-send). A returned
row means this call won → send; an existing row means a redelivery or an
already-fired reminder → no second email. The date is part of the key on purpose:
editing a connection's renewal date changes the key, so the new date re-arms both
thresholds (a genuinely new renewal cycle) while the old date's rows stay inert.
This mirrors `budget_alert_state.claimThreshold` (ADR 0029) and the digest's
week-CAS (ADR 0024). Reads/writes go through a new `forOrg(...).renewalReminderState`
namespace (`list`, `claim`).

Reminder email follows the W5-I/budget-alert precedent: a pure render fn
(`renewal-reminder-email.ts`) + a `*-copy.ts` prose module (G7, carrying the
user-entered honesty framing) + `isEmailConfigured` guard before any claim +
per-recipient try/catch. Audience is the org's verified admins
(`listDigestRecipients`), like the digest and budget alerts. Cron/consumer-time
only — zero request-path cost.

## Contracts affected
- **Schema** (`src/db/schema.ts` + `drizzle/0027_renewal-reminders.sql`):
  additive nullable `connections.renewal_date` column; new
  `renewal_reminder_state` table with a composite tenant FK
  `(org_id, connection_id) → connections(org_id, id)` ON DELETE CASCADE, the
  `(org_id, id)` composite-FK anchor, and the
  `(connection_id, renewal_date, threshold)` unique CAS target.
- **API contract** (`src/contracts/api.ts`, frozen): `connectionSchema` gains
  `renewalDate: day.nullable()`; `connectionsUpdate.request` gains
  `renewalDate: day.nullable().optional()`. Both additive; existing callers
  unaffected.
- **Tenancy layer** (`src/db/org-scope.ts` public API): new `renewalReminderState`
  namespace on the `forOrg` object; `connections.update` writer extended with the
  optional `renewalDate` field. Registered in `tests/tenant-isolation.test.ts`
  (SCOPED_READS + non-vacuous B-org seed).
- **Account deletion** (`src/db/account-deletion.ts`): `renewal_reminder_state`
  added to `PURGE_EXEMPT_TABLES` — its composite FK cascades with `connections`,
  which `PURGE_TABLES` deletes explicitly, so no separate statement is needed.
- `tracked_user`, credential shape, metric catalog, `connector-facts.md`: none.

## Workstreams to re-sync
None depend on either the column or the table (both new/additive). The renewal
date rides existing connection read paths; a consumer that ignores it is
unaffected.

## Consequences
- One daily cross-org fan-out (one tiny message per org) plus, per org, one
  `connections.list` read and — only for connections with a due date — one CAS
  claim. Most orgs enter no renewal date, so the scan early-returns after the
  list read. Cron/consumer-time only.
- De-dup is per `(connection, date, threshold)`, not per recipient: one claim
  covers the org and emails all verified admins; a per-recipient send failure
  means that admin misses this reminder (safe under-delivery, like the digest),
  never a double-send.
- Strict exact-day equality means a day the daily cron does not run (an outage)
  can miss a threshold for connections sitting exactly on it that day. Accepted
  for V1: the reminder is a courtesy nudge over a user-entered date, not a
  guarantee, and the honest framing says so; a catch-up window can be added later
  without a schema change (the CAS already de-dups).
- Editing the renewal date intentionally re-arms reminders for the new date.
