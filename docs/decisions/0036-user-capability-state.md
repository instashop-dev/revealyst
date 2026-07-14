# 0036 — Per-person capability mastery state (`user_capability_state`)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** W7-2 (AI Capability Execution Plan, phase P2)

## Context

P1 (ADR 0035) shipped the relational capability graph. P2 adds the per-person
**mastery state** — the report's "capability state" and Spec V4's proficiency
band + marker breakdown, unified. It must NOT extend the frozen score engine
(`src/scoring/evaluate.ts`, `recompute.ts`) or its determinism contract: the
Maturity Model is the precedent — a parallel pure lib over the same org-scoped
readers, persisting to its own ADR-gated table. A new org-scoped table touches
frozen `schema.ts` + `drizzle/**`, so it is ADR-gated (rule 1) and carries the
full three-registration burden.

## Decision

Add migration `0031_user-capability-state.sql` — one **org-scoped** table
`user_capability_state`, PK `(org_id, person_id, capability_slug)`, composite
tenant FK `(org_id, person_id) → people(org_id, id)` `ON DELETE CASCADE`, FK
`capability_slug → capabilities.slug`, indexes `(org_id, person_id)` (self-view
read) and `(org_id, capability_slug)` (aggregate coverage rollup, P6). Columns:
`mastery`/`confidence` `numeric(6,4)` in [0,1], `confidence_tier` (the
`ConfidenceTier` vocabulary, **hard-capped `directional`** this phase),
`evidence_count`, `last_evidence_at` (date), `staleness` (days), `next_capability`
(the person's eligible-next hint, denormalized for a one-read card), `components`
jsonb (per-signal explainability breakdown).

**The engine** (`src/scoring/capability-state.ts`, pure) computes mastery from
the person's already-computed **score components** (normalized 0–100, the priors)
plus a **bounded recent-metric window** (28 days) — so a run is O(current state),
never O(history). The v0 formula (interpretable, no ML — L8):

- per bound signal → a score in [0,1]: a component binding is `normalized/100`;
  a metric binding is `min(evidenceDays / EVIDENCE_TARGET_DAYS, 1)`.
- `mastery` = mean of the per-signal scores, times a staleness `decayFactor`.
- `confidence` = `0.5·coverage + 0.3·evidenceVolume + 0.2·signalCompleteness`.
- Every directional constant is a named, exported, greppable value.

**Honesty (invariant b), reused verbatim:** a capability with NO evidence for the
person gets **NO row** (never `mastery: 0`); a real recent-but-low reading is kept
(a measured low, not an absence); evidence too stale (fully decayed) is withheld
(no row), never a fabricated 0. Mastery is capped `directional` until the OTel
receiver (P8) supplies ≥2 corroborating markers (L7).

**The reducer** (`src/scoring/recompute-capability-state.ts`) runs as a PARALLEL
step in the poller `score-recompute` message, AFTER the score recompute (reads
the fresh components). Every read is batched ONCE for the whole org (identities,
people, connections, subjects, person-level scores, prior-state person ids, and
one query per distinct bound metric key — a fixed ~14), so the query count is
**independent of person count and of history depth**. Idempotent + recompute-
derivable, so the backfill is safe to ship empty and populate on the next nightly
pass; a job-health line is logged so a silent no-op is visible.

**Reads** go through a new `forOrg` namespace `mastery`
(`src/db/org-scope/mastery.ts`): `forPerson(personId)` (self-view read — the
caller passes the SIGNED-IN person's own id; there is NO other-person/team read
surface), `replaceForPerson` (the reducer's upsert + reconcile-down),
`personIdsWithState`, and `coverageCounts` (aggregate, count-only, for P6).

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — new org-scoped table
  `user_capability_state`, migration `0031` (additive; no existing shape changed).
- Tenancy layer: new `mastery` namespace on `forOrg` — public API grows by one
  member; existing members unchanged.
- Poller: the `score-recompute` message gains a parallel reducer step (no new
  message kind; re-delivery harmless — idempotent).
- Not affected: the frozen score engine, `tracked_user` semantics, credential
  shape, `connector-facts.md` (P2 adds ZERO signals).

## Three registrations (all in this PR)

1. **`tests/tenant-isolation.test.ts`** — `SCOPED_READS` gains `mastery.forPerson(B)`
   with a non-vacuous B-org seed row (keyed on B's alice).
2. **This ADR.**
3. **`src/db/account-deletion.ts`** — `user_capability_state` added to
   `PURGE_TABLES`, ordered **before `people`** (its composite FK to people would
   otherwise block the people delete).

The four capability-graph reference tables (P1) remain global (no `org_id`) and
correctly stay outside both completeness tripwires.

## Self-view enforcement

Per-person mastery **never leaves self-view**. Enforced by: (a) `forPerson` is
`(org, person)`-filtered and only ever called with the signed-in person's own id;
(b) there is no other-person/team read route on the namespace; (c) `user_capability_state`
is never added to `TeamVisibleView`, so `assertTeamOnlyPseudonymized` cannot leak
it. P6's team rollup reads the table separately as an **aggregate, count-only**
surface (`coverageCounts` + `MIN_PEOPLE`). This mirrors `rec_interaction_state`'s
three-layer posture.

## Founder sign-off note (engineering assumption)

The plan flags the "third-ladder" confirmation as a founder input (§7 item 2).
Executed autonomously per directive: the capability profile is a **decomposition
of the one person proficiency band**, NOT a competing third ladder — the UI
renders bands + a confidence tier, keeps the raw 0–100 behind the existing
diagnostic expander (no second expander), and orders positive-first ("discovery,
never deficiency"). Person-level scores exist only in personal orgs (ADR 0014),
so capability state is populated there first — consistent with W6-A (Companion in
Team orgs) staying gated.

## Consequences

- The founder sees their own per-capability band + confidence + eligible-next; a
  manager provably cannot (self-view enforced three ways).
- Every row is `directional`; zero-evidence → no row; the reducer is idempotent
  under redelivery and its cost scales with the window, not history.
