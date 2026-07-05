# 0002 — connector_runs table + org-scope connectorRuns namespace (additive)

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Founder (W1-D kickoff plan approval)

## Context
W1-D's charter (execution plan, Wave 1) mandates a `connector_runs` log table —
"retries, backoff, per-vendor rate limits, `connector_runs` log table (surfaced
later as 'last synced 2h ago')" — and chunked, resumable backfill. The table and
its repository namespace did not exist at the W0-C freeze because no connector
existed yet. `src/db/schema.ts`, `drizzle/**`, and the `src/db/org-scope.ts`
public API are frozen paths, so even this charter-mandated addition requires an
ADR in the same PR (rule 1 / CI `frozen-contracts` job).

## Decision
Purely **additive** changes — no existing shape is modified:

1. **`connector_runs` table** (migration `0010_connector-runs.sql`): one row per
   poll or backfill-chunk attempt, per connection. Columns: `kind`
   (`poll | backfill`), `status` (`running | success | error`), the covered
   day window (`window_start`/`window_end`), `attempt`, result counters
   (`subjects_seen`, `records_upserted`, `signals_upserted`), `gaps` (the
   connector's HonestyGap[] for the run, surfaced to the UI), `error`,
   `started_at`/`finished_at`. Tenancy per ADR 0001: `org_id` on the row, a
   `(org_id, id)` unique anchor, a composite `(org_id, connection_id)` FK
   cascading from `connections`, and coverage in the tenant-isolation sweep.
   Backfill resume state is **derived** from these rows (and from queue-message
   cursors), so no separate cursor table exists.
2. **`forOrg(...).connectorRuns` namespace** in `src/db/org-scope.ts`:
   `start` / `finish` / `fail` / `list` / `latest` — all org-guarded like every
   other namespace.
3. **`connections.markPolled`** on the existing connections namespace: stamps
   `last_polled_at` (+ `last_success_at`, `status`, `last_error`) after a run,
   so "last synced 2h ago" reads from `connections` without a join.

## Contracts affected
- `src/db/schema.ts` + `drizzle/0010_connector-runs.sql` — new table only.
- `src/db/org-scope.ts` — new namespace + one new method; no existing method's
  signature or semantics change.
- `src/contracts/**`, `src/lib/credentials.ts`, fixtures shapes: untouched.

## Workstreams to re-sync
None: additive surface consumed only by W1-D's poller (and later W2 dashboards
reading `connectorRuns.list`/`connections.lastSuccessAt`). Existing consumers of
the frozen API are unaffected.

## Consequences
- The tenant-isolation completeness tripwire forces `connector_runs` entries in
  `SCOPED_READS` (done in the same PR).
- W2 dashboards get sync-status data without further schema work.
- If a vendor ever needs run state richer than (window, counters, gaps), that
  is a new ADR, not a widening of this one.
