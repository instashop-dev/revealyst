# 0017 — Add metrics.allSignals() batch read; parallelize billing.trackedUsers reads

- **Status:** Accepted
- **Date:** 2026-07-09
- **Deciders:** Founder

## Context

A single dashboard render (25-person team org) was measured at 99 DB queries, of
which ~72 came from two separate call sites fanning out one
`scope.metrics.signals({ subjectId, from, to })` call per subject over the same
window: `src/lib/dashboard-signals.ts` `readActivityHeatmap()` and
`src/lib/shared-account/query.ts` `computeSharedAccountFlags()`. Both need every
subject's `subject_day_signals` rows for the period; neither needs them scoped to
one subject at a time. The existing `signals()` method (org-scope.ts ~1135) takes
a required `subjectId` and cannot serve an org-wide read without one query per
subject — the same shape of problem ADR 0014 fixed for `identities.forSubject`/
`forPerson` and `teams.members`.

Separately, `billing.trackedUsers()` (org-scope.ts ~1363–1389) — on the
every-request access-check path (`src/lib/access.ts` `computeAccess`) — issues two
reads with no data dependency between them (`activeSubjectDays` from
`metric_records`, `identityRows` from `identities`) sequentially with `await`
before `await`, doubling that path's latency for no reason.

## Decision

Two additive/internal, latency-only changes, no semantic change:

- `scope.metrics.allSignals({ from, to })` — returns all `subject_day_signals`
  rows for the org in the window: same column set and same shape per row as the
  existing `signals()` method (including `subjectId`, `day`, `hours`,
  `peakConcurrency`, `sourceGranularity`, `updatedAt`), same
  `eq(subjectDaySignals.orgId, orgId)` tenancy guard, ordered deterministically
  by `(orgId, subjectId, day)` so callers can group rows by `subjectId` in JS.
  Mirrors ADR 0014's naming pattern (`identities.all()`, `teams.allMembers()`).
  The existing `signals()` method is unchanged.

- `billing.trackedUsers()` — wrap the independent `activeSubjectDays` and
  `identityRows` reads in `Promise.all`. Signature and return shape are
  unchanged; `countTrackedUsers` still receives the same two arrays.

No schema changes — a read method needs no migration. `src/db/schema.ts` and
`drizzle/**` are untouched.

## Contracts affected

- `src/db/org-scope.ts` public API — additive extension only (`allSignals`); no
  existing method signature or return type changed. `trackedUsers()`'s internal
  read ordering changes (sequential → parallel); its public signature and return
  shape are untouched.

## Workstreams to re-sync

None. `allSignals` is a pure addition to the existing surface — no workstream
built against an expectation that it would be absent. The `trackedUsers()`
internal reordering is not observable from its return value.

## Consequences

- `dashboard-signals.ts` `readActivityHeatmap()` and `shared-account/query.ts`
  `computeSharedAccountFlags()` migrate from N per-subject `signals()` calls
  to one `allSignals()` call each, grouping rows by `subjectId` in JS (landed
  in the same change set as this ADR).
- `billing.trackedUsers()` — and therefore `computeAccess()` on the
  every-request access-check path — issues its two independent reads
  concurrently instead of sequentially.
- Any future caller wanting a full org signals scan for a window should use
  `allSignals()` rather than looping over `signals()` per subject.
