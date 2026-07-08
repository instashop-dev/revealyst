# 0014 — Add batch read methods to org-scope: identities.all() and teams.allMembers()

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Founder

## Context

Every dashboard page load was executing 100–300 sequential DB round-trips through two
`for…await` loops in `readDashboard()` — one calling `scope.identities.forPerson(id)`
for every tracked person, another calling `scope.identities.forSubject(id)` for every
subject. `listTeams()` similarly issued N parallel queries for member counts. The
existing per-row methods (`forPerson`, `forSubject`, `members`) cannot batch these
lookups without exposing the full identity table to callers.

## Decision

Extend the `forOrg` public API with two additive, org-scoped read methods:

- `scope.identities.all()` — returns all identity rows for the org (same column set as
  the existing `forSubject`/`forPerson` methods, same `eq(identities.orgId, orgId)`
  guard). Mirrors the pattern already used internally by `countOrgTrackedUsers` at
  org-scope.ts line ~1333.

- `scope.teams.allMembers()` — returns `{ teamId, personId }` pairs for every
  team-member row in the org, scoped by `eq(teamMembers.orgId, orgId)`.

Both methods are read-only, purely additive, and apply the same org-ID tenancy guard
as every existing method in `forOrg`. No schema changes. No changes to existing methods.

## Contracts affected

- `src/db/org-scope.ts` public API — additive extension only; no existing method
  signatures or return types changed.

## Workstreams to re-sync

None. The new methods are additions to the existing surface; no workstream built
against an expectation that these methods would be absent.

## Consequences

- Dashboard `readDashboard()` and `api-impl.ts listTeams()` now load all required rows
  in two parallel queries instead of N sequential ones.
- Any future caller wanting a full org identity or team-member scan should use these
  methods rather than looping over per-row accessors.
