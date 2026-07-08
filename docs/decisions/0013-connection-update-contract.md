# 0013 — Connection update contract (rename + pause/resume) and delete implementation

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Founder (via connections-management planning session)

## Context

The Connections page gains full management (view / add / edit / delete). The
frozen API surface covers list, create, credential PUT, poll, and a
`connectionsDelete` contract that was frozen with no implementation — but
nothing can rename a connection or pause/resume its polling. `RouteContract.method`
doesn't even include `"PATCH"`. The org-scope public API (frozen, ADR 0001)
likewise has no generic update and no delete for connections.

## Decision

- Add `connectionsUpdate` — `PATCH /api/connections/:id`, request
  `{ displayName?: string(min 1), status?: "active" | "paused" }` with **at
  least one field required** (an accepted no-op would fabricate
  `connection.update` audit entries, ADR 0010), response
  `{ connection: connectionSchema }` — and widen `RouteContract.method` with
  `"PATCH"`. Config stays create-time-only; credential material continues to go
  exclusively through the write-only `connectionCredentialPut`.
- Implement the already-frozen `connectionsDelete`.
- Add `connections.update(id, patch)` and `connections.delete(id)` to the
  org-scope public API (additive; both org-guarded in the same `and()` as their
  siblings).
- Both new handlers are **admin-only** (`handleApi { adminOnly: true }`).
  Create/credential/poll stay member-accessible (onboarding uses them).
- **DELETE is exempt from the free-band 402** (`allowOverFreeBand: true`, the
  first exemption beyond the upgrade/portal routes): deleting a connection is
  the usage-REDUCING action an over-limit unpaid org needs to get back under
  the band; gating it would lock orgs out of removing their own data. PATCH
  stays 402-gated (rename is neutral, resume is usage-increasing).
- **Resume is honest about sync state**: `PATCH { status: "active" }` on a
  connection with no `lastSuccessAt` lands `"pending"`, not `"active"` — a row
  never claims a health it hasn't demonstrated (invariant b). Implemented as a
  SQL CASE inside `connections.update`, so it is race-free.
- **DELETE enqueues an immediate `score-recompute`** (best-effort) so
  dashboards don't serve numbers computed from destroyed data until the
  nightly cron.

## Contracts affected

- `src/contracts/api.ts` — additive: `connectionsUpdate` entry + `"PATCH"` in
  the method union.
- `src/db/org-scope.ts` public API — additive: `connections.update`,
  `connections.delete`.
- No schema change, no fixture change, no `tracked_user` change.

## Workstreams to re-sync

None — additive only; no existing consumer's shape changes. The onboarding
wizard's "there is no client-side delete" retry rationale is updated in place.

## Consequences

- **Delete destroys this connection's ingested data by design.**
  `connections.delete` transactionally removes the connection's
  metric_records first (the NO ACTION `metric_records_org_connection_fk`
  blocks the delete while any record references the connection — verified
  against real Postgres; the subjects cascade does not satisfy it), then the
  frozen cascades take the credential, subjects (and their remaining
  records), raw payloads, and run history. Scores recompute without them
  (stale-result reconciliation, ADR 0012). UI copy must state this honestly
  (invariant b).
- **Pause/resume never touches `lastError`** — resuming doesn't fabricate a
  clean state; the next successful poll clears it via `markPolled`. For the
  same reason `connections.update` is a separate writer, not `setStatus`
  (which always overwrites `lastError`).
- **Pause sticks on the credential path too** (sibling-guard fix shipped with
  this ADR): `setStatus` gains the same `ne(status, "paused")` guard as
  `markPolled`/`markSynced`, so `putConnectionCredential`'s definitive-rejection
  branch no longer flips a *paused* connection to `error` — an error status is
  a dispatch candidate, so the old behavior silently un-paused polling. The 400
  still surfaces the rejection to the caller. Explicit un-pausing is the new
  `connections.update({ status })` writer's job (`setStatus` had exactly one
  caller, so no other semantics change). Accepted trade-off: a definitive
  rejection while paused persists no `lastError` (the guard skips the whole
  write); the caller sees the 400, and the next post-resume poll records the
  failure honestly.
- **Known concurrency edge (accepted):** a poll committing new metric_records
  between the delete transaction's records-delete and the connection delete
  trips the NO ACTION FK → the delete 500s, nothing is destroyed, and a retry
  succeeds (the in-flight run then resolves `skipped-gone`). Rare (requires a
  mid-flight run past its existence check) and safe-by-failure; not worth a
  retry loop yet.
- **Scale note (follow-up, not blocking):** the metric_records delete is
  unbounded within one transaction and no index leads with `connection_id`
  (org-prefix PK scan). Fine at current org sizes; a mature multi-year org may
  eventually need batched deletion (the `upsertRecords` BATCH=500 pattern)
  and/or an index — revisit before large-org GA. The delete does an existence
  pre-check so unknown/foreign ids never pay the scan.
