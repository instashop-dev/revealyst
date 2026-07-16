# 0041 — schema: public-API-preserving split into per-domain modules

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** W9-T5.2 (Closure — frozen-monolith merge contention), founder

## Context

`src/db/schema.ts` is a **frozen contract** (tag `contracts-v1`; CLAUDE.md →
Frozen contracts) and had grown to a **1,749-line monolith**: 5 `pgEnum`
definitions + 40 `pgTable` calls in one file, plus the 5 Better Auth tables
re-exported from `src/db/auth-schema.ts`.

Every table-adding workstream since W3 has had to append to this one file, and
the Closure Execution Plan (§3, T5.2) flags the monolith as the **last remaining
merge-contention hazard**: parallel edits to one 1.7k-line file collide, and
every such PR re-reviews the whole surface. The W6 parallel-frozen-contract
lesson (CLAUDE.md wave banner) was concrete — four workstreams all appended to
`schema.ts`/migrations/`org-scope.ts`, forcing heavy per-rebase renumbering and a
snapshot-drift bug. This is the direct mirror of **ADR 0027**, which split
`src/db/org-scope.ts` for the same reason and explicitly left this schema split as
its deferred follow-up.

The frozen-contract rule (rule 1) means the file cannot be casually reorganized —
a public-API change would require re-syncing every one of the ~90 importers. But
the *internal* structure is not the contract; the **exported surface** (every
table object, every enum, and the trailing `export * from "./auth-schema"`) is.

We verified the split is mechanical and behavior-preserving before choosing module
boundaries. Two real constraints shaped them:

1. **Circular-import ordering.** `src/db/auth-schema.ts` imports `orgs` back from
   `./schema` (the barrel), so the auth-table re-export must come **after** `orgs`
   initializes. The old monolith encoded this as its trailing
   `export * from "./auth-schema"`.
2. **Composite tenant FKs use direct column references.** Simple
   `.references(() => x)` FKs are lazy thunks (safe across modules regardless of
   load order), but the composite tenant FKs (`foreignKey({ foreignColumns:
   [connections.orgId, connections.id] })`) evaluate their `foreignColumns` array
   **at module load**, so each composite FK's parent table must be evaluated
   before its children. We mapped every composite FK (below) and ordered the
   modules so each parent is upstream of its children — no cycle, no merge or
   move was forced.

**Composite-FK parent → child map** (the acyclicity proof):

| Child (module) | Parent (module) |
|---|---|
| `team_members` (core) | `teams`, `people` (core) |
| `connection_credentials` (connections) | `connections` (connections) |
| `renewal_reminder_state` (connections) | `connections` (connections) |
| `subjects` (tracking) | `connections` (connections) |
| `identities` (tracking) | `subjects` (tracking), `people` (core) |
| `metric_records` (tracking) | `subjects` (tracking), `connections` (connections) |
| `subject_day_signals` (tracking) | `subjects` (tracking) |
| `score_results` (scoring) | `people`, `teams` (core) |
| `connector_runs` (poller) | `connections` (connections) |
| `share_links` (sharing) | `people` (core) |
| `rec_interaction_state` (recommendations) | `people` (core) |
| `recommendation_exposure` (recommendations) | `people` (core) |
| `role_assignments` (roles) | `people` (core) |
| `user_capability_state` (capability-graph) | `people` (core) |
| `mission_progress` (missions) | `people` (core) |

Every parent's module (`core`, `connections`, `tracking`) is upstream of, or the
same as, every child's module. The barrel's `export *` order (below) is exactly
this topological order.

## Decision

Split `src/db/schema.ts`'s 5 enums + 40 tables into **13 per-domain modules**
under `src/db/schema/<domain>.ts`, and turn `src/db/schema.ts` into a **thin
barrel** that re-exports them in dependency order, with `auth-schema` last.

- The **exported surface is byte-for-byte unchanged**: every table/enum keeps its
  exported name and definition (a pure move, zero semantic edits), so
  `type`-level and value consumers of `@/db/schema` / `../db/schema` resolve
  unchanged and no importer outside `src/db/schema*` was touched.
- `drizzle.config.ts` stays pointed at `./src/db/schema.ts` — a barrel is a valid
  single entry; drizzle-kit follows the re-exports.
- The new `src/db/schema/*.ts` files live inside `src/db/**`, so they may import
  schema modules and one another (`scripts/check-org-scope.mjs` still prints
  "org-scope guard: clean" — its schema-zone allowance is `src/db/`).
- File/directory coexistence (`schema.ts` + `schema/`) was already proven by
  `org-scope.ts` + `org-scope/` (ADR 0027).

**Module list and table membership** (barrel order):

| Module | Enums / tables |
|---|---|
| `core` | 5 enums (`subject_kind`, `attribution_level`, `score_subject_level`, `subscription_status`, `rec_interaction_state_kind`) + `orgs`, `people`, `teams`, `team_members`, `invites` |
| `connections` | `connections`, `connection_credentials`, `renewal_reminder_state` |
| `tracking` | `subjects`, `identities`, `metric_catalog`, `raw_payloads`, `metric_records`, `subject_day_signals` |
| `scoring` | `score_definitions`, `score_results`, `benchmarks` |
| `poller` | `poll_heartbeats`, `connector_runs` |
| `sharing` | `share_links`, `benchmark_consent` |
| `billing` | `subscriptions`, `budgets`, `budget_alert_state` |
| `audit` | `audit_log` |
| `digest` | `digest_preferences`, `exec_report_state` |
| `recommendations` | `rec_interaction_state`, `recommendation_catalog`, `recommendation_exposure` |
| `roles` | `roles`, `role_assignments` |
| `capability-graph` | `domains`, `capabilities`, `capability_signals`, `capability_dependencies`, `user_capability_state` |
| `missions` | `missions`, `mission_steps`, `mission_progress` |

**Placement notes** (the plan's suggested grouping named 13 modules but did not
enumerate every table; these are the derived placements, none FK-forced into a
merge or move):

- `renewal_reminder_state` → **connections** (not a standalone module): it holds a
  composite tenant FK to `connections`, so it must be in `connections`' module or
  a strictly-downstream one; co-locating it with its parent is the simplest and
  keeps the module count at the planned 13.
- `budgets` + `budget_alert_state` → **billing**, alongside `subscriptions` — the
  spend-governance family; all three are org-level financial/entitlement state.
- `exec_report_state` → **digest**, alongside `digest_preferences` — both are
  email-reporting send-state/opt-in rows (weekly digest, monthly exec memo).

No FK cycle appeared, so **no domain merge and no table move away from its natural
domain was required** — the plan's suggested grouping held as-is.

The circular-import ordering is preserved in the barrel: `core` is re-exported
first and `auth-schema` last, carrying the same comment as the old monolith.

## Contracts affected

- **`src/db/schema.ts` (frozen, `contracts-v1`)** — **surface unchanged**. Every
  exported table/enum keeps its name and definition; this is an internal
  reorganization into `src/db/schema/*.ts` modules re-exported by the barrel. No
  column, index, constraint, FK, or enum-value change (proven by a zero-diff
  `drizzle-kit generate` — see Consequences). The frozen tag still applies to the
  whole `src/db/schema` path (now also a directory).

No other frozen artifact changes: `drizzle/` migrations, `src/db/org-scope.ts`,
`tracked_user` semantics, the credential row shape, the metric catalog, and
`connector-facts.md` are all untouched. `drizzle.config.ts` is unchanged.

## Workstreams to re-sync

- **Any future table-adding workstream** — add the new table to the appropriate
  `src/db/schema/<domain>.ts` module (or a new module wired into the barrel in
  dependency order), rather than to the old monolith. The three-point
  registration for a new org-scoped table (tenant-isolation `SCOPED_READS`, an
  ADR, and `account-deletion.ts` PURGE_TABLES/PURGE_EXEMPT_TABLES) is unchanged.
  A new composite tenant FK still needs its parent's module upstream in the
  barrel order — extend the FK map above when adding one.

## Consequences

- Merge contention on the schema drops sharply: parallel workstreams edit
  different small files instead of one 1.7k-line monolith, ending the W6-class
  serialize-the-builds tax for schema-touching work.
- Reviews of a table change are scoped to that domain's file.
- The frozen-contract guard now covers a directory as well as the barrel file;
  the barrel's `export *` **order is load-bearing** (circular-import + composite-FK
  acyclicity) — a future editor must not reorder it casually.
- **Acceptance evidence** (the split is a pure move — the migration output is the
  proof):
  - `npx tsc --noEmit` — clean.
  - `npx drizzle-kit generate` — "No schema changes, nothing to migrate"; no new
    `drizzle/*.sql`, no new `drizzle/meta/_journal.json` entry;
    `git status --porcelain drizzle/` empty.
  - `node scripts/check-org-scope.mjs` — "org-scope guard: clean".
  - Targeted suite (tenant-isolation, account-deletion, authenticated-page
    queries, scoring-evaluate, capability-catalog, org-scope-guard, contracts) —
    104 tests green across 7 files.
- Closes ADR 0027's deferred follow-up (it named this schema split as pending).
