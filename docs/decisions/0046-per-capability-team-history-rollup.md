# 0046 — Per-capability team history rollup

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team Capability Intelligence roadmap, Phase 2 (founder-signed
  decision **D-TCI-6**, `docs/product-signoffs.md`).
- **Implemented:** by the `p2d-capability-history` build PR — migration **0037**
  (`team_capability_history`), writer `src/scoring/recompute-capability-history.ts`
  (poller `score-recompute` slot), read namespace `forOrg().capabilityHistory`,
  render-time floor `src/lib/capability-history.ts`. No UI in that PR (the growth
  chart consumer is a later workstream).

## Context

The team dashboard computes capability coverage on-read (`readDashboardView` →
`mastery.coverageCounts`). There is no persisted history, so **trends, movement
counts, and coaching baselines cannot be computed** — a period-over-period
"improving/declining" arrow has nothing to diff against. The obvious source is
poisoned: `score_results.computed_at` is **rewritten by the nightly recompute
upsert** (`org-scope.ts` `upsertResults`; CLAUDE.md timestamp gotcha), so it
reads as "recomputed today", not "measured then" — it cannot serve as a history
axis. The founder signed the exception:

> **D-TCI-6 — Ratified (override) 2026-07-16 — Founder: YES**, persist
> per-capability team history. Needs its own ADR (deliberate compute-on-read
> exception; derive snapshots from the same pure functions the dashboard uses +
> shared-source parity test). Unblocks §6.5 Growth trends, movement counts,
> coaching baselines.

This ADR authorizes a later build PR; it ships **no schema or code** itself. A
new org-scoped table touches frozen `src/db/schema/**` + `drizzle/**`, so the
build is ADR-gated (rule 1) and carries the full three-registration burden.

## Decision

Add an **append-only periodic rollup** table (working name
`team_capability_history`) — a deliberate exception to the repo's compute-on-read
preference, justified because the underlying timestamp source is rewritten and
therefore history is otherwise unrecoverable.

### Row shape — count-only, no person data

Keyed `(org_id, team_id, capability_slug, period_start)` with `period_end`:

- `org_id uuid` (tenant), `team_id uuid NULL`, `capability_slug text`,
  `period_start` / `period_end` (date).
- Count-only aggregates: `represented_count` (people with a state row for this
  capability), `total_count` (team/org member denominator), coverage counts by
  mastery band, and a `confidence_tier` summary.
- **NO per-person values, NO person id** in the row shape — a per-person leak is
  structurally impossible (mirrors `mastery.coverageCounts`, which never emits a
  person id).
- Composite tenant FK `(org_id, team_id) → teams(org_id, id) ON DELETE CASCADE`
  when `team_id` is non-null; index `(org_id, capability_slug, period_start)` for
  the trend read.

### Org-level rows, optional `team_id`

Rows are **org-level by default with an optional `team_id`**: an org **is** one
team for most customers today (assumptions ledger §1), so an org-level series is
the common case and always populatable, while `team_id` lets a multi-team org
carry per-team series without a schema change. `team_id NULL` = the org-wide
series. This avoids forcing a per-team row where a team structure doesn't
meaningfully exist yet, and keeps the denominator honest (org member count vs
team member count).

### Drift guard — same pure functions, parity-pinned

Rows are derived from the **same pure functions the dashboard uses** —
`mastery.coverageCounts` / the `src/scoring/capability-state.ts` outputs — never
a parallel re-implementation, so a snapshot can never disagree with the live
dashboard for the same inputs. A **shared-source parity test** pins this (the
digest/dashboard shared-source pattern): the value written for a period equals
what the dashboard computes from the same state.

### Where it's computed — poller, batch-once, idempotent

Written in the poller `score-recompute` slot, following the
`recompute-capability-state.ts` pattern: **all reads batched once** for the whole
org (query count **independent of person count** and of history depth), a
parallel step after the score/capability recompute (reads the fresh state).

**Upsert strategy: natural-key upsert** on `(org_id, team_id, period_start,
capability_slug)` — **idempotent per period**. A re-delivered or re-run nightly
pass for the same period overwrites that period's row with the same computed
values (same inputs → same row); it never appends a duplicate period. History
accumulates one row per (key, period); only the *current, still-open* period's
row is rewritten within the period, and it freezes once the period closes and the
window moves on. (This is CAS-free — the natural key + deterministic derivation
make a compare-and-set unnecessary; re-computation is safe by construction.)

### MIN_PEOPLE floor applied at READ time

Store the **true** counts; apply the `MIN_PEOPLE` floor at **render/read** time,
not at write. Flooring at write would destroy history — a capability that is
below the floor this period but crosses it later would have gaps or zeros baked
into the stored series, making a later trend uncomputable and dishonest. Storing
true counts and suppressing below-floor capabilities only at the moment of
display keeps the series continuous and the floor a presentation rule (the same
posture as P6's coverage card: drop below-floor capabilities entirely at render,
never a suppressed-but-implied number).

## Contracts affected

- **`src/db/schema/**` + `drizzle/**`** — new org-scoped table (additive; no
  existing shape changed). Its migration lands with the build PR.
- **`src/db/org-scope.ts` public API** — a new read/write namespace (e.g.
  `capabilityHistory`) for the trend read + the reducer write.
- Poller: the `score-recompute` message gains a parallel rollup step (no new
  message kind; re-delivery harmless — idempotent per period).
- Not affected: `tracked_user` semantics, credential shape, `connector-facts.md`,
  the frozen score engine (this reads its outputs, never extends it).

## Workstreams to re-sync

- **TCI Phase 2** (per the gap analysis §9 sequencing, item 3) — this table is
  the substrate for the Growth/movement card and trend-based insight categories;
  build against this ADR.
- **Privacy/tenancy seam owner (W1-S)** — the three registrations below land with
  the build PR.

## The three registrations the future table PR must carry

1. **`tests/tenant-isolation.test.ts`** — a `SCOPED_READS` entry for the history
   read with a **non-vacuous B-org seed** row (the completeness tripwire fails
   otherwise).
2. **This ADR** (the frozen-contract change record).
3. **`src/db/account-deletion.ts`** — the table added to `PURGE_TABLES`
   (org-scoped, cascade-to-`teams`; ordered before `teams`) or
   `PURGE_EXEMPT_TABLES` as its FK posture dictates, so the purge-completeness
   tripwire stays green.

## Retention / purge posture

Account deletion erases an org's history via the composite-FK cascade +
`PURGE_TABLES`. The table is append-only per period and unbounded in principle;
a retention window (e.g. trailing N periods) is a **follow-up** and is **not**
required for the first build — the rollup is count-only and small (one row per
team × capability × period), so no retention pressure blocks shipping.

## Consequences

- Per-capability team **trends, movement counts, and coaching baselines** become
  computable — the §6.5 Growth surface and every "improving/declining" arrow gain
  a stable history axis that `score_results.computed_at` could never provide.
- A deliberate compute-on-read exception now exists; its risk (a snapshot
  disagreeing with the live dashboard — gap analysis §10, "history table drift")
  is contained by the same-pure-function derivation + the shared-source parity
  test. No per-person value or id is ever stored, so the count-only + MIN_PEOPLE
  privacy posture is preserved end to end.
