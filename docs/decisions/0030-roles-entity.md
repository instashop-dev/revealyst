# 0030 — Roles entity (person → engineering-role assignment)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** W6-B (founder-directed)

## Context

Spec V4 §6.4 and Execution Plan V4 §4 W6-B want a real, FK-able **role** entity
before any role-specific content lands. W6-C's recommendation catalog will carry
an `applicable_roles` column that must FK a stable target; without a roles table
it would either hard-code role strings or invent an ad-hoc enum. The role model
is deliberately small and **manual**: engineering-only seed values, assigned by
an admin in Settings — **NOT** derived from an HRIS / org-chart sync (the §14
NOT-list; org-chart features are a scope tripwire for this workstream).

Two tables are new frozen contracts (`src/db/schema.ts` + `drizzle/**`), and the
assignment write path needs a route (`src/contracts/api.ts`), so the addition is
ADR-gated (rule 1) even though it is purely additive.

## Decision

Add two tables (migration `0026_roles-entity.sql`):

**`roles`** — a seeded **global reference table** (no `org_id`), mirroring
`metric_catalog` / `benchmarks.score_slug`: not a pg enum (the set is expected to
grow; post-launch changes are ADR-gated data migrations), and the same rows are
visible to every org.

- Columns: `slug` (text PK), `label`, `sort` (integer, presentation order),
  `is_active` (boolean), `created_at`.
- Seeded idempotently in the migration file (`INSERT … ON CONFLICT DO NOTHING`,
  like `drizzle/0007`) with the closed engineering launch set: `backend`,
  `frontend`, `fullstack`, `mobile`, `platform`, `data`, `ml`, `sre`.
- **`roles.slug` is the FK target for W6-C's `applicable_roles`.** It is the
  stable text id — chosen (over a surrogate uuid) so a catalog migration can
  reference roles by their human-meaningful slug and the ids survive unchanged.

**`role_assignments`** — an **org-scoped** table mapping a tracked person to at
most one role.

- Columns: `org_id`, `person_id`, `role_slug` (FK → `roles.slug`),
  `assigned_by_user_id` (nullable, `ON DELETE SET NULL` — audit of which admin
  set it; the row survives that user's deletion), `created_at`, `updated_at`.
- Primary key `(org_id, person_id)` — one role per person; `org_id` sits IN the
  key so a cross-org row is unrepresentable, and `assign` upserts on it.
- Composite tenant FK `(org_id, person_id) → people(org_id, id)` `ON DELETE
  CASCADE` (D1a) — a person from another org is unrepresentable; the assignment
  is torn down with the person.
- Index `(org_id, role_slug)` for the future role-scoped read (W6-C).

Reads go through a new `forOrg` namespace `roles`
(`src/db/org-scope/roles.ts`): `list()` (the GLOBAL reference list — not
org-filtered, so NOT part of the isolation sweep), `assignments()` (the org-
scoped batch read that folds into the Settings page's existing flat
`Promise.all`, G10), `getForPerson(personId)`, `assign(...)` (upsert on the PK),
and `unassign(personId)`.

Add ONE frozen route to `src/contracts/api.ts`: **`roleAssignmentSet`** —
`PUT /api/people/:id/role`, served via `handleApi`/`appContext`. Admin-set org
config (a manager assigns roles — **not** self-view), so `adminOnly` at the
handler and the 402 free-band gate applies by default (NOT opted out). Body
`{ roleSlug: string | null }`; null unassigns. The handler (`setPersonRole` in
`src/lib/api-impl.ts`) validates `personId` belongs to the org (404 otherwise)
and `roleSlug` against the reference table (400 otherwise) so bad input is a
clean status, not a composite-FK 500, then writes a `person.role_set` /
`person.role_unset` audit entry (write-then-audit, like every sibling admin
mutation). WRITE-ONLY by shape: only `ok` comes back — assignments are read
server-side into the Settings page (no assignment-read route).

**UI:** a `RoleManagementCard` in Settings (team orgs, admin-only — rendered
beside the people/teams roster) with an inline `<select>` per person (the same
native-select pattern as the platform-role control). Nothing else consumes roles
until W6-C.

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — new tables `roles` (global reference,
  seeded) and `role_assignments` (org-scoped), migration `0026_roles-entity.sql`
  (additive; no existing shape changed).
- **`src/contracts/api.ts`** — new route contract `roleAssignmentSet`
  (additive; no existing route changed).
- Tenancy layer: new namespace on `forOrg` (`src/db/org-scope.ts`) — the public
  API grows by one member; existing members byte-for-byte unchanged.
- Not affected: `tracked_user` semantics, credential shape, metric catalog,
  `connector-facts.md`.

## Workstreams to re-sync

- **W6-C** (recommendation catalog): FK `applicable_roles` → **`roles.slug`**.
  The seeded slug set above is the FK universe; a catalog row may reference any
  of them. If W6-C needs a role not in the launch set, add it via an ADR-gated
  seed data migration (never widen the set ad hoc).

## Consequences

- The three-registration law is satisfied in this PR for BOTH new tables:
  `tests/tenant-isolation.test.ts` `SCOPED_READS` gains a `roles.assignments`
  entry (+ a non-vacuous B-org seed row keyed on B's alice); this ADR;
  `src/db/account-deletion.ts` `PURGE_TABLES` gains `role_assignments`
  (person-scoped, FK to people → purged BEFORE `people`). The global `roles`
  reference table has no `org_id`, so both completeness tripwires skip it and it
  needs no registration — exactly how `metric_catalog` is handled (never purged;
  survives account deletion).
- One role per person in v1 (PK `(org_id, person_id)`). A multi-role model, if
  ever needed, is a future migration (drop the person-unique PK for a
  `(org_id, person_id, role_slug)` PK) — deferred until content demands it.
- Roles are manual org config: no connector, poller, or sync writes them. This
  keeps the org-chart tripwire firmly out of scope.
