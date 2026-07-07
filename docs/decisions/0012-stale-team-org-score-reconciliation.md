# 0012 — Stale team/org score reconciliation (W3 gate finding)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Deciders:** W3 gate check (`/gate-review W3` HIGH correctness finding);
  applied at the gate per the W2 fix-now precedent

## Context

`recomputeOrg` reconciles **person**-level `score_results` down to exactly
who was scored this round (`deleteStalePersonResults`, tested), but the
adjacent **team** and **org** branches only ever upsert: when
`evaluateDefinition` returns `null` (zero consumed rows — correct honesty
behavior), the old row is simply never touched. After a
restatement-to-empty (the poller's window delete on a vendor restatement, a
purged connection), team/org scores computed from data that **no longer
exists** render on the dashboard, trends, and the benchmark panel for the
rest of the period — beside a dashboard showing zero activity. This is the
documented "sibling guard" failure pattern (the guard existed on one of
three call sites) and an invariant-(b) violation surface: `score_results`
has no FK to `metric_records`, so nothing cascades.

Changing `src/db/org-scope.ts`'s public API is a frozen-contract change,
hence this ADR (rule 1). The change is purely **additive**.

## Decision

1. **Two additive `forOrg().scores` methods**, exact siblings of
   `deleteStalePersonResults` (same idempotency, same tight
   definition+period scoping):
   - `deleteStaleTeamResults(definitionId, period, keepTeamIds)` —
     `subjectLevel = 'team'`, deletes rows whose `teamId` was not scored
     this round (all rows when the keep-list is empty).
   - `deleteStaleOrgResults(definitionId, period)` — `subjectLevel = 'org'`,
     called only when the org-level evaluation produced no result.
2. **`recomputeOrg` wires them** in the team/org branches, mirroring the
   person branch; removals count into the existing `staleRemoved` stat.

## Contracts affected

- `src/db/org-scope.ts` — two additive methods on the existing `scores`
  sub-repo. No signature or semantic change to any existing method.
- No schema, migration, or `src/contracts/**` change.

## Workstreams to re-sync

- None open. `tests/scoring-recompute.test.ts` gains team/org stale-row
  coverage in the same change (the existing suite covered person only).

## Consequences

- A team/org score now disappears (rather than freezes) when its underlying
  window empties — matching the person-level behavior and the "no data ≠
  measured zero" honesty rule. Dashboards already handle absent scores.
- The nightly recompute remains the only writer/deleter of team/org rows;
  the delete is scoped to (org, definition, period), so historical periods
  are untouched.
