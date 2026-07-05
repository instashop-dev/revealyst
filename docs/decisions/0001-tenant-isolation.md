# 0001 — Tenant isolation: repository layer, not RLS

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Founder (W0-C plan approval)

## Context
The execution plan's frozen-contract item (6) left the mechanism open: "Postgres
row-level security, **or** a repository layer that makes org-scoping non-optional."
W0-C had to pick one and freeze it. RLS was evaluated and rejected on this stack:

1. **Hyperdrive pools a single connection string/role.** Per-request `SET app.org_id`
   leaks across pooled sessions; only `SET LOCAL` inside an explicit transaction is
   safe, which would force every query into a transaction wrapper.
2. **The app role owns the tables.** Migrations and the app share one Neon role, and
   table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` plus a split
   migration-role/app-role setup is added — infrastructure the walking skeleton
   doesn't have.
3. **RLS is untestable on the test stack.** PGlite runs as superuser, which always
   bypasses RLS — the isolation suite could never prove RLS actually works.

## Decision
The org-scoped repository layer **is** the frozen tenancy contract:
`forOrg(db, orgId)` in `src/db/org-scope.ts` is the only application query surface.
Three mechanical controls make it survive an agent fleet:

- **D1a — composite tenant FKs:** every child table carries `org_id` and references
  its parent via `(org_id, parent_id) → parent(org_id, id)`, making cross-org
  references unrepresentable at the DB level. Fact/result tables embed `org_id` in
  their upsert keys, so `ON CONFLICT` update paths cannot cross tenants; upsert keys
  that omit `org_id` (subjects, credentials) carry ownership pre-checks + org-guarded
  `setWhere`.
- **D1b — CI guard:** `scripts/check-org-scope.mjs` fails CI if code outside
  `src/db/**` imports the schema modules or calls `createDb` outside allowlisted
  entrypoints.
- **Credential AAD binding:** ciphertexts are AAD-bound to
  `orgId:connectionId:kind`, so even a DB-level row copy across orgs fails
  authentication.

Proven by `tests/tenant-isolation.test.ts`: a registry-driven sweep over every
`OrgScopedDb` read surface (with a completeness tripwire so new tables cannot skip
it), cross-org write rejections, and the AAD row-copy proof.

## Contracts affected
Defines frozen-contract item (6). No other frozen artifact changes.

## Workstreams to re-sync
None — decided at the freeze ceremony, before W1 fan-out.

## Consequences
- Every new table must carry `org_id`, composite tenant FKs, and a repo-layer
  namespace registered in the isolation sweep (the completeness assertion enforces
  the last part mechanically).
- Raw SQL escape hatches (`db.execute`) remain possible inside `src/db/**` only;
  system jobs live in `src/db/system.ts`.
- RLS stays available later as defense-in-depth (requires split DB roles + a
  Postgres-with-roles test harness); adopting it would be a new ADR, not a revert
  of this one.
