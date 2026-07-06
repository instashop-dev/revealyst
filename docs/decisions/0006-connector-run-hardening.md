# 0006 — Connector run/dispatch hardening (adversarial-review findings)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Founder (W1-D chain review)

## Context
The W1-D `/code-review` pass (8 finder angles, adversarially verified)
confirmed a cluster of lifecycle defects in the connector framework shipped by
ADR 0005's PR: an errored connection was permanently excluded from dispatch
(the self-heal comment was unreachable), transient DB failures after vendor
I/O were classified permanent, a paused or once-failed backfill chain was
silently abandoned forever, retryable failures caused a duplicate-poll
pile-up every cron tick, a success stamped mid-run could un-pause a
connection, per-row upsert round-trips were the unmodeled half of the queue
wall-time budget, and the Anthropic connector double-emitted token metrics
across two vendor surfaces. Several fixes touch the frozen
`src/db/org-scope.ts` public API, hence this ADR (rule 1).

## Decision
1. **`connections.markPolled`** (added in ADR 0005, not yet consumed outside
   the poller): outcome union widens to
   `{ ok: true } | { ok: false; error: string; transient?: boolean }`.
   `transient` stamps `last_polled_at` only — status and `last_error` stay
   untouched while the queue message backs off. Both `markPolled` and
   `markSynced` now refuse to touch a **paused** connection (`status !=
   'paused'` in the WHERE): a user's pause always sticks, even against an
   in-flight run.
2. **Batched upserts, same public API:** `subjects.upsertMany`,
   `metrics.upsertRecords`, `metrics.upsertSignals` now execute chunked
   multi-row `INSERT … ON CONFLICT DO UPDATE` statements (≤500 rows,
   `excluded.*` refs), deduping intra-batch keys last-wins (the prior
   sequential-loop semantics). Signatures, semantics, and tenancy guards
   (ownership pre-check + org-guarded `setWhere`) are unchanged.
3. **Dispatch self-heal:** `listConnectorWorkCandidates` includes
   `status = 'error'` connections. A later successful poll re-activates them
   via `markPolled`; a wrong credential costs one visibly-failed run per
   vendor interval until fixed.
4. **Run/backfill lifecycle (non-frozen `src/poller/**`):** vendor-phase
   errors keep the retryable/permanent split; post-vendor errors (raw
   landing, normalize, upserts) rethrow for queue retry instead of bricking
   the connection. Backfill chains survive: a permanently-failed chunk is a
   recorded hole and the chain continues; a paused connection re-parks the
   same cursor with a delay; only a deleted connection ends the chain; a
   fork guard stops at-least-once redeliveries from spawning duplicate
   chains. `connector_runs.subjects_seen` now counts subjects touched by the
   run, not the connection's lifetime set.
5. **Queue config:** `max_retries: 10` set explicitly (platform default 3
   dropped a chain link after ~3.5 min of outage). DLQ remains founder
   infra (`wrangler queues create revealyst-poll-dlq`).
6. **Anthropic token canonicality (vendor module, non-frozen):**
   `usage_report/messages` is the single token source; `claude_code`
   analytics no longer emits `tokens_*`/`model_tokens` (it keeps sessions/
   commits/PRs/lines/acceptance/estimated spend, which exist nowhere else) —
   otherwise W2-K identity resolution would double-count a person's tokens
   across their usage-report and claude_code subjects (invariant b).

## Contracts affected
- `src/db/org-scope.ts` — markPolled outcome widening (additive optional
  field), pause guard on markPolled/markSynced, batching internals. No
  existing caller breaks; no schema change.
- Everything else touched (`src/poller/**`, `src/connectors/**`,
  `wrangler.jsonc`, tests) is non-frozen.

## Workstreams to re-sync
- **W1-E** (agent ingest): `markSynced` now no-ops on paused connections —
  matches the pause-sticks rule; no code change needed.
- **W2-H/W2-L** (dashboards): `connector_runs.subjects_seen` is per-run;
  "last synced" reads are unaffected.

## Consequences
- A deterministic normalize bug now retries the message (bounded by
  max_retries) instead of erroring the connection; it stays visible as
  failed run rows + a stale `last_success_at`.
- Backfill history can contain recorded holes (failed chunks) — W2 UI should
  surface `connector_runs` errors rather than assume contiguity.
- The wall-time budget's DB half shrinks by ~500× in round-trips; the CI
  budget test still models vendor latency only (known limitation, noted in
  the test).
