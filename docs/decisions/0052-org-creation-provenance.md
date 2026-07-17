# 0052 — Creation provenance: `orgs.created_by_user_id` (D-ONB-1 cap semantics)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** User-facing team-onboarding workstream (adversarial review
  finding on the `p5-team-onboarding` build), coordinator-directed.

## Context

D-ONB-1 ships user-facing team-workspace creation (`POST /api/workspaces`)
with a modest per-user cap as an abuse guard. The first cut enforced the cap
by counting the user's **admin memberships** in team orgs
(`countAdminTeamWorkspaces`). Adversarial review rejected that:

1. **Wrong denominator.** Being invited as an admin to someone else's team
   workspace consumed the caller's cap — a user invited as admin to 5 team
   orgs was permanently blocked from ever creating their own.
2. **Impossible remediation in the copy.** The cap message said "Leave one you
   no longer need", but no leave/delete-workspace affordance exists anywhere
   (only full account deletion removes `org_members` rows) — an
   invariant-(b)-style overclaim in rendered copy.

The cap's real meaning is *workspaces you CREATED*, and the schema had no
record of who created an org. `bootstrapUserId` cannot be reused for this: it
is the **UNIQUE** per-user signup-org marker owned by the personal org (the
constraint that closes the `ensureOrgOfOne` race) — a user bootstraps exactly
one personal org but may create several team workspaces, so a unique column
structurally cannot carry creation provenance.

`src/db/schema.ts` + `drizzle/**` are frozen, so the column addition requires
this ADR (rule 1). Adding a column to the existing `orgs` table needs no new
tenant-isolation/purge registration — `orgs` is the tenant root itself, already
covered.

## Decision

- **New nullable column** `orgs.created_by_user_id text REFERENCES user(id)
  ON DELETE SET NULL` (migration **0042** — a single additive
  `ALTER TABLE ... ADD COLUMN` + FK, no backfill, no index: the cap count
  filters a user's created team orgs, a per-user handful of rows).
- **Stamped only by `provisionTeamWorkspace`** (`src/db/org-provisioning.ts`),
  the shared transaction both the platform-admin seam and the user-facing
  route call. Signup personal orgs (`ensureOrgOfOne`) are deliberately NOT
  stamped: their provenance is already `bootstrapUserId`, and stamping a
  second column with the same fact invites drift between two claim surfaces.
  Rows predating the column stay NULL (honest: provenance unknown).
- **Cap semantics:** `countCreatedTeamWorkspaces` counts
  `kind = 'team' AND created_by_user_id = :userId`. Invited-admin memberships
  no longer consume the cap. Pre-column team orgs (NULL provenance) count
  against nobody — acceptable: the cap is an abuse guard, not billing.
- **Copy:** the at-cap message states the fact and prescribes nothing
  impossible ("You've created N team workspaces, which is the maximum for one
  account."), deriving N from `MAX_TEAM_WORKSPACES_PER_USER`.
- **Race hardening (same review, defect 2):** the cap check moves INSIDE the
  provisioning transaction, serialized by a per-user
  `pg_advisory_xact_lock(hashtext('team-ws-create:' || userId))` taken as the
  transaction's first statement — concurrent creates by one user queue behind
  the lock, so N simultaneous requests at cap−1 cannot all pass the count.
  The lock is taken only when a cap is requested (the user path); the
  platform-admin seam stays uncapped and lock-free. Verified against PGlite
  (real Postgres WASM — both functions available), which is also what the
  route tests run on.

## Contracts affected

- `src/db/schema.ts` (via `src/db/schema/core.ts`): additive `orgs` column.
- `drizzle/0042_org-created-by.sql`: the migration.
- No API contract change (`src/contracts/api.ts` untouched); the cap error
  shape is the standard `handleApi` ApiError envelope.

## Workstreams to re-sync

- None beyond `p5-team-onboarding` itself — the column is additive and only
  the provisioning/cap path reads it.
