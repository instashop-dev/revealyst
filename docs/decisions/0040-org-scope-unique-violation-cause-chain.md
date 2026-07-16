# 0040 — Fix: `isUniqueViolation` walks the error cause chain

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** agent (CI fix), founder (frozen-path sign-off)

## Context
`src/db/org-scope/shared.ts`'s `isUniqueViolation` checked `error.code === "23505"`
directly on the caught error. Under the drizzle-orm version in use, driver errors are
wrapped in a `DrizzleQueryError` (`Failed query: ...`) whose own `.code` is undefined —
the real Postgres `code`/`23505` lives on `error.cause`. That silently made the check
always return `false`, which disabled `people.create()`'s designed pseudonym-collision
retry (`src/db/org-scope/people.ts`): any genuine collision on the 3,600-combination
adjective-animal pseudonym space threw immediately instead of retrying. With 40 people
seeded into one org, `tests/perf/capability-state-queries.test.ts` hit a real collision
probability of ~20% per run (birthday paradox), which is why CI failed intermittently —
not the "rare flake" class already documented in `CLAUDE.md`, but a reproducible latent
bug. `src/db/invites.ts` already had a correct, independently-written cause-walking
version of the same helper, confirming the fix shape.

`src/db/org-scope/**` is a frozen-contract path (CLAUDE.md rule 1), so even this
internal, non-signature-changing bugfix trips the CI frozen-contract guard — hence
this record.

## Decision
Change `isUniqueViolation` in `src/db/org-scope/shared.ts` to walk the `.cause` chain
(matching `src/db/invites.ts`'s existing implementation) instead of inspecting only the
top-level error. No call sites, signatures, or exported behavior change — the function's
contract ("does this error represent a Postgres unique-violation?") is unchanged; only
its previously-broken implementation is corrected.

## Contracts affected
None in substance. `isUniqueViolation`'s signature and the `people.create()` retry
contract it serves are unchanged — this restores the already-documented retry-then-suffix
behavior, it does not add new behavior.

## Workstreams to re-sync
None. No workstream built against the broken (non-retrying) behavior as a dependency;
it only manifested as an intermittent test failure.

## Consequences
Frozen-path guard satisfied by this ADR. `people.create()`'s pseudonym-collision retry
now actually fires, so `tests/perf/capability-state-queries.test.ts` (and any other org
seeded with enough people to risk a pseudonym collision) stops failing intermittently.
Follow-up worth doing later, not blocking: de-duplicate `isUniqueViolation` into one
shared export instead of two independently-maintained copies (`shared.ts` and
`invites.ts`).
