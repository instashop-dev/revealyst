# 0027 — org-scope: public-API-preserving split into namespace factories

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** W5-A (Contract seams & guardrail debt), founder

## Context

`src/db/org-scope.ts` is a **frozen contract** (tag `contracts-v1`; CLAUDE.md →
Frozen contracts) and had grown to a **1,901-line monolith**: `forOrg(db, orgId)`
returned one object literal with 15 namespaces (`org`, `people`, `teams`,
`connections`, `connectorRuns`, `subjects`, `identities`, `metrics`, `raw`,
`scores`, `billing`, `auditLog`, `heartbeats`, `budgets`, `digestPreferences`).

Three upcoming table-adding workstreams (W5-D, W6-B, W6-C) each need to extend
this file, and the execution plan (§15.3.1 / §3 W5-A) flags the monolith as a
merge-contention hazard: parallel edits to one 1.9k-line file collide, and every
such PR re-reviews the whole surface. The frozen-contract rule (rule 1) means the
file cannot be casually reorganized — a public-API change would require re-syncing
every one of the ~90 importers. But the *internal* structure is not the contract;
the **exported surface** (`forOrg`, `OrgScopedDb`, `ensureOrgOfOne`,
`membershipForUser`, and the input types) is.

We verified the 15 namespaces are already self-contained: **zero cross-namespace
calls** inside the object literal (each namespace's methods reference only `db`,
the closure-bound `orgId`, imported schema tables, and shared lib helpers). That
makes a mechanical, behavior-preserving split possible.

## Decision

Split `forOrg`'s body into **one factory per namespace** under
`src/db/org-scope/<namespace>.ts` (e.g. `scoresNamespace(db, orgId)`), and turn
`src/db/org-scope.ts` into a **thin composition root** that imports the factories
and returns `{ orgId, org: orgNamespace(db, orgId), people: peopleNamespace(...), … }`.

- The **exported surface is byte-for-byte unchanged**: `forOrg` still returns the
  identical shape (so `export type OrgScopedDb = ReturnType<typeof forOrg>` is
  unchanged), and `ensureOrgOfOne` / `membershipForUser` stay in the root module.
- The org-scoped **input types** (`CreatePersonInput`, `CreateConnectionInput`,
  `SubjectDescriptor`, `MetricRecordUpsert`, `SubjectDaySignalUpsert`,
  `RawPayloadInsert`, `ScoreResultUpsert`) move next to their namespace and are
  **re-exported** from `org-scope.ts`, so external `import { … } from
  "../db/org-scope"` sites keep resolving unchanged.
- The one shared module-level helper (`isUniqueViolation`) moves to
  `src/db/org-scope/shared.ts` — no logic duplicated.
- The new `src/db/org-scope/*.ts` files live inside `src/db/**`, so they may
  import schema modules (the `scripts/check-org-scope.mjs` guard still prints
  "org-scope guard: clean").
- **CI regex widened in the same PR**: `.github/workflows/ci.yml`'s frozen-paths
  grep changes `src/db/org-scope\.ts$` → `src/db/org-scope(\.ts$|/)`, so a
  post-split PR that touches `src/db/org-scope/**` still trips the ADR gate
  (rule 1). Without this, the split would have silently unfrozen the namespace
  files.

`src/db/schema.ts` is **NOT** split in this workstream (§3 W5-A item 5 — lower
urgency; deferred).

## Contracts affected

- **`src/db/org-scope.ts` public API** — the tenancy contract. **Surface
  unchanged** (`forOrg` / `OrgScopedDb` / `ensureOrgOfOne` / `membershipForUser`
  / all input types identical); this is an internal reorganization into
  `src/db/org-scope/*.ts` factories. No query semantics, no org-scoping, no
  method signature changes. Frozen tag `contracts-v1` still applies to the whole
  `src/db/org-scope` path (now a directory), enforced by the widened CI regex.

No other frozen artifact changes: schema, `drizzle/`, `tracked_user` semantics,
credential shape, metric catalog, and `connector-facts.md` are all untouched.

## Workstreams to re-sync

- **W5-D, W6-B, W6-C** — the table-adding workstreams. They must add their new
  namespace as a `src/db/org-scope/<name>.ts` factory and wire it into the
  composition root's `forOrg` return (and re-export any new input type from
  `org-scope.ts`), rather than appending to the old monolith. The three-point
  registration for a new org-scoped table (tenant-isolation `SCOPED_READS`,
  an ADR, and `account-deletion.ts` PURGE_TABLES/PURGE_EXEMPT_TABLES) is
  unchanged.

## Consequences

- Merge contention on org-scope drops sharply: parallel workstreams edit
  different small files instead of one 1.9k-line monolith.
- Reviews of a namespace change are scoped to that namespace's file.
- The frozen-contract guard now covers a directory; the widened regex is the
  load-bearing part — a future editor must not narrow it back to `\.ts$`.
- Follow-up (deferred, not done here): the analogous `src/db/schema.ts` split
  (§3 W5-A item 5). **Done in ADR 0041 (2026-07-16, W9-T5.2)** — same recipe
  (barrel + per-domain modules, public API unchanged, zero-diff `drizzle-kit
  generate`).
- Adds a small indirection (composition root → factory modules); the returned
  object shape and runtime behavior are identical, verified by the full test
  suite (tenant-isolation sweep, all `forOrg` consumers) staying green.
