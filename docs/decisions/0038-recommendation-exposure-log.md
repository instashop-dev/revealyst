# 0038 — Recommendation exposure log (reverses "don't log rec-shown-to-X")

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** W7-7 (AI Capability Execution Plan, phase P7) — **founder-signed
  privacy-reversal** received.

## Context

To measure whether recommendations actually cause improvement (experimentation /
holdouts / lift), the system must record **which coaching recs were shown to which
person, when**. This directly **reverses a deliberate privacy choice**: today
`rec_interaction_state` is logged only when a person *acts* (snooze/dismiss/tried),
and the route comment
(`src/app/api/recommendations/interaction/route.ts:14-19`) explains that even the
audit log is skipped because "recording *person X dismissed rec Y* … would itself
be the self-view leak this feature forbids." An exposure log is a stronger form of
exactly that record. Because it reverses a recorded stance, it requires a
founder-signed ADR before any table exists — which this is.

## Decision

Add migration `0033_recommendation-exposure.sql` — one **org-scoped** append log
`recommendation_exposure`: `id`, `org_id`, `person_id`, `rec_id` (the catalog
slug shown), `surface` (`dashboard`|`digest`), `shown_at` (date), `experiment_key`
+ `variant` (nullable), composite tenant FK `(org_id, person_id) → people` ON
DELETE CASCADE, a unique key `(org_id, person_id, rec_id, surface, shown_at)`, and
index `(org_id, person_id)`.

### The privacy constraints that make the reversal acceptable

1. **Self-view only — no manager/admin READ route.** `exposures.forUser` joins
   `people.auth_user_id` so only the caller's rows return. `exposures.list` is an
   org-wide read used **server-side only** (the tenant-isolation sweep + future
   founder-side analysis) — it is **never wired to any manager-facing route or
   page**. Nothing renders another person's exposures.
2. **Never on the team-visible view.** `recommendation_exposure` is not part of
   `TeamVisibleView`, so `assertTeamOnlyPseudonymized` cannot leak it (same
   structural exclusion as `user_capability_state` / `mission_progress`).
3. **Purge-registered, before `people`** — account deletion erases a person's
   exposure log (composite-FK cascade + `PURGE_TABLES`).
4. **Impersonation caveat (named).** Platform staff can, via **audited, time-boxed
   impersonation**, load a user's session and therefore see the user's own
   exposures — as the user, audited. This is the single existing bypass; it does
   not make exposures manager-readable. Any "no one but you sees your coaching
   history" prose must carry this caveat (invariant b — prose is a claim surface).
5. **Idempotent (CAS), off the hot path.** The unique per-day key means
   at-least-once digest redelivery writes exactly one row per surfaced rec. The
   write is the background digest sender, never the authenticated render path.

### Experimentation (deterministic, no ML)

`src/lib/experiments.ts` — a deterministic holdout/variant assigner: a person is
bucketed by a **stable hash** of `(experiment key, person id)`, never per-request
random, so the same person always sees the same arm. The `EXPERIMENTS` registry
is **empty at launch** (a config list, not a hollow table); turning on an A/B test
= adding an entry (with its own ADR if it changes ranking/copy). Each exposure row
stamps the person's assignment for the active experiment (nulls when none).

### What is NOT built (still gated)

- **The Outcomes entity / lift measurement** stays gated on real "tried" volume —
  an always-empty outcome table is an invariant-b trap, so it is not shipped
  hollow. The exposure log is the foundation it will read when volume is real.
- **The offline Precision@k/NDCG@k harness** is deferred until exposure logs carry
  real data (the plan's "flag back rather than scaffold prematurely").
- **Dashboard exposure logging** (a client beacon) is a follow-up; P7 logs
  **digest** exposures (a clean, off-hot-path, self-view surface) so the table has
  a real writer from day one — not hollow.

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — new org-scoped table
  `recommendation_exposure`. Migration `0033`.
- Tenancy: new `exposures` namespace on `forOrg` (public API grows by one member).
- Poller: the digest sender logs personal-lane exposures after a successful send.
- Not affected: the frozen contracts, `rec_interaction_state` (unchanged — this is
  additive), `tracked_user`, credentials, `connector-facts.md`.

## Three registrations (all in this PR)

1. **`tests/tenant-isolation.test.ts`** — `SCOPED_READS` gains `exposures.list`
   with a non-vacuous B-org seed (B's alice gets an exposure).
2. **This ADR.**
3. **`src/db/account-deletion.ts`** — `recommendation_exposure` added to
   `PURGE_TABLES`, ordered **before `people`**.

## Consequences

- A ranking or copy change can now be A/B'd with a deterministic holdout, and the
  exposure log accumulates the raw "shown to whom, when" data lift analysis needs
  — without ever exposing one person's coaching history to a manager or admin.
- The reversal is bounded and named: the only non-self reader is audited
  impersonation, called out here so no "private forever" claim overstates it.
