# 0044 — Manager role tier (`team_managers`)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team Capability Intelligence roadmap, Phase 2 workstream A
  (founder-signed decision **D-TCI-3**, `docs/product-signoffs.md`)

## Context

The org membership role is `admin | member` only (`org_members.role`, written by
Better Auth's admin plugin and the signup bootstrap). The TCI roadmap needs a
**manager** tier — a person accountable for a specific team, the eventual gate
for manager-only aggregate team surfaces (team capability summaries, coaching
baselines). The founder ratified adding it:

> **D-TCI-3 — Ratified 2026-07-16 — Founder: YES**, add a manager role tier.
> Phase 2 of the TCI roadmap is unblocked (manager role → team settings →
> capability history → aggregate surfaces).

This is a **structural** gap, not a privacy reversal (that is D-TCI-1's domain,
which governs whether a manager may ever see named per-person data — default
still **no**, self-view-only mastery stands per ADR 0036/0038). A manager grant
today confers only: (1) assignment visibility (who manages which team) and (2)
eligibility for future manager-gated **aggregate** surfaces. It grants **no**
per-person data visibility.

A new org-scoped table touches frozen `src/db/schema/**` + `drizzle/**` and the
`forOrg` public API, so it is ADR-gated (rule 1) and carries the full
three-registration burden.

## Decision

### Better Auth roles stay untouched

We do **not** add "manager" to `org_members.role` (or to Better Auth's own role
model). A membership-role enum change would ripple through the auth plugin,
`orgContextForUser`, `handleApi`'s `adminOnly` gate, and every `role === "admin"`
check — a large frozen/auth surface — to express a relationship (person ↔ team)
that a role enum cannot even represent (a role is per-org, a manager is
per-team). Instead a **manager is derived**: an org member with ≥1 `team_managers`
row. The auth schema (`src/db/auth-schema.ts`) is unchanged.

### `team_managers` table (migration 0036)

One **org-scoped** table `team_managers`, modelled on `team_members` but keyed on
an **auth user** (a dashboard account / org member) rather than a tracked person:

- Columns: `org_id uuid`, `team_id uuid`, `user_id text → user.id ON DELETE
  CASCADE`, `created_at`.
- PK `(team_id, user_id)` — a user manages a team once; `org_id` is fixed by
  `team_id` (a team belongs to exactly one org), so it need not sit in the key,
  mirroring `team_members`.
- Composite tenant FK `(org_id, team_id) → teams(org_id, id) ON DELETE CASCADE`
  (D1a): a team from another org is unrepresentable, and deleting a team tears
  down its manager grants.
- Index `(org_id, user_id)` — backs the access-seam read `managedTeamIds`.

`user_id` is `text` (Better Auth ids are text, like `people.auth_user_id`,
`audit_log.actor_user_id`, `org_members.user_id`); its cascade tears the grant
down when the account is deleted.

### `forOrg().teamManagers` namespace

`src/db/org-scope/team-managers.ts`: `list()` (all org grants, one batched read
for the Settings fold-in), `listForTeam(teamId)`, `managedTeamIds(userId)`
(access seam), `assign(teamId, userId)` (idempotent), `remove(teamId, userId)`.
Every read/write is org-filtered.

### Access seam

`managedTeamIds` is exposed from `src/lib/api-context.ts` as a **separate
`cache()`d lookup**, not a field on `appContext`. It costs one Neon round-trip
(it needs the resolved `orgId` first, so it can't pipeline into the `orgContext`
read) and **no surface consumes it yet** — paying that per-RTT cost on every
authenticated page for zero readers would violate the depth-over-count perf
model, so it runs only when asked. `navFor` (`src/lib/nav-items.ts`) gains an
optional `isManager` gate and an (empty) manager nav group so a later phase adds
items by editing config; **no manager-gated nav item ships in this slice**.

### Admin assignment UI + API

Settings → People (admin-only) gains a **Team managers** card: per team, the
current managers and a picker of workspace members to add/remove. Mutations go
through the `handleApi` choke point (`POST`/`DELETE /api/teams/:id/managers`,
`adminOnly: true`), validating that the team belongs to the org (404) and the
target user is a workspace member (400), then writing the grant and an
`audit_log` row (`team.manager_add` / `team.manager_remove`). The request body
is validated by a local zod schema rather than the frozen `contracts/api`
surface, so no API contract change is needed.

**Authorization:** assigning managers is an **admin** action. A manager is still
Better Auth role `member`, so a manager cannot assign or remove managers — the
`adminOnly` gate rejects them exactly like any other member (pinned by the
manager-vs-member authz matrix test).

## Contracts affected

- `src/db/schema/core.ts` (+ `drizzle/0036_team-managers.sql`) — new org-scoped
  table. Re-exported via the existing `schema/core` barrel line (ADR 0041).
- `src/db/org-scope.ts` public API — `teamManagers` namespace added to `forOrg`.

Both are frozen paths; this ADR is the required same-PR change (rule 1, CI-
enforced).

## Three registrations

1. `tests/tenant-isolation.test.ts` — `teamManagers.listForTeam` SCOPED_READS
   entry + a non-vacuous B-org seed (a manager grant on B's core team).
2. `src/db/account-deletion.ts` — `team_managers` added to `PURGE_TABLES`
   (deleted before `teams`), mirroring `team_members`.
3. This ADR.

## Consequences

- The manager relationship is now first-class and org-scoped, with an audit
  trail, without touching the auth role model.
- No behavioural change ships beyond the admin assignment card: the nav gate is
  empty and the access seam has no consumer yet. Phase 2's later slices
  (manager-gated aggregate team surfaces, capability history) build on this
  foundation.
- Per-person data visibility for managers remains **out of scope** and governed
  by D-TCI-1's separate, consent-machinery-bearing ADR.
