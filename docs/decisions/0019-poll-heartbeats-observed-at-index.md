# 0019 — Add poll_heartbeats.observed_at index; operational-log retention

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Founder

## Context

Three append-only operational logs grow without bound today — `poll_heartbeats`
(one row per org per 5-min cron tick), `connector_runs` (one row per poll /
backfill-chunk attempt), and `audit_log` (user-initiated admin actions). Only
`raw_payloads` has a purge job. W4-Q (debt & hardening) adds retention for the
other three.

`poll_heartbeats` is the acute case: it has no index at all, yet
`latestHeartbeatAt` (`src/db/system.ts`, behind `/api/health`) does an
`ORDER BY observed_at DESC LIMIT 1` on every probe, and the new retention purge
does a `WHERE observed_at < cutoff` range delete — both seqscans over a table
that only ever grows. The read-side comment on `latestHeartbeatAt` already
flagged the missing index + retention as a follow-up; this is that follow-up.

Adding the index touches the frozen `src/db/schema.ts` + `drizzle/**`, hence
this ADR (rule 1).

## Decision

Add a single-column btree index on `poll_heartbeats.observed_at`:

```
index("poll_heartbeats_observed_at_idx").on(t.observedAt)
```

Migration `drizzle/0020_poll-heartbeats-observed-at-index.sql`
(`CREATE INDEX ... USING btree ("observed_at")`), generated offline with
`drizzle-kit generate`. `observed_at` only — heartbeats are system telemetry
read and purged **across** orgs (never per-org), so no leading `org_id` column
is warranted. The index serves both the `latestHeartbeatAt` top-1 read and the
retention range delete.

The retention jobs themselves are NOT a schema change — they live in
`src/db/system.ts` (`purgeExpiredRetention`), wired through a new
`purge-retention` queue message dispatched once nightly from `src/worker.ts`
(alongside the score recompute), and delete in bounded batches exactly like the
existing `purgeExpiredRawPayloads`. Retention windows are ops decisions (no
compliance floor promises any of these; the only stated promise — raw payloads
~90 days — is honored by the separate `purgeExpiredRawPayloads` job):

- **audit_log — 365 days.** Low-volume, security-relevant; a full year is a
  conservative window that keeps a useful trail without unbounded growth.
- **poll_heartbeats — 30 days.** Pure liveness telemetry where only the newest
  row is ever read; 30 days is ample for debugging poller history.
- **connector_runs — 90 days, `kind = 'poll'` ONLY.** Aligns with the
  raw-payload window. Backfill rows are **never** purged: `backfillStarted` in
  `src/poller/dispatch.ts` is derived from the mere existence of a `backfill`
  run per connection, so deleting a connection's last backfill row would make
  the dispatcher re-trigger a full backfill. Backfill rows are a handful per
  connection lifetime (already bounded); poll rows are the high-volume ones.

Only `poll_heartbeats` gets a new index. `audit_log` and `connector_runs` keep
their existing org-leading composite indexes (which the cross-org `... < cutoff`
delete predicate can't use), by design: these are append-only tables, so
expired rows cluster at the heap front and the `LIMIT batchSize` select finds
them without a full scan while a backlog is draining; the only full scan is the
once-nightly zero-match confirmation, acceptable off-peak. `poll_heartbeats`
earns its index on the READ side — the hot `ORDER BY observed_at DESC LIMIT 1`
on every `/api/health` probe — which the other two have no equivalent of. A
capped run re-enqueues itself (`src/poller/process.ts`) so a high-volume table
still drains across successive runs rather than outpacing one nightly pass.

## Contracts affected

- `src/db/schema.ts` + `drizzle/**` — additive index on an existing frozen
  table. No column, type, constraint, or upsert-key change; the row shape and
  tenancy anchor are untouched. Purely a read/delete-performance addition.

## Workstreams to re-sync

None. An index is transparent to every query; no workstream built against an
expectation that it would be absent. The retention jobs and `purge-retention`
message live entirely in non-frozen modules (`src/db/system.ts`,
`src/poller/messages.ts`, `src/poller/process.ts`, `src/worker.ts`).

## Consequences

- `/api/health`'s heartbeat read and the nightly retention purge both use the
  index instead of seqscanning an ever-growing log.
- The three operational logs stay bounded in steady state; each nightly run
  deletes only the trickle of rows crossing its cutoff, in bounded batches
  (`batchSize` × `maxBatches`) so no run can exceed the Workers CPU budget.
- `connector_runs` backfill history is retained indefinitely by design (it is
  poller resume/idempotency state, not disposable telemetry).
