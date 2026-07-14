# 0035 — AI capability graph (relational catalog + rec→capability linkage)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** W7-1 (AI Capability Execution Plan, phase P1)

## Context

The AI Capability Execution Plan (Wave 7) adds a thin capability layer over the
shipped substrate. Phase P1 stands up the **relational capability catalog** and
links the existing `recommendation_catalog` to it — no mastery engine, no state,
no ranking change (those are P2/P3). The gap analysis is explicit: a *relational*
catalog (≈1 domain, <20 capabilities, shallow prerequisite edges) is sufficient
and a **graph database is a standing tripwire** — traversal is a bounded
in-memory walk over one batched read, the same perf law the recommendation
catalog already obeys.

The four new tables and the additive `recommendation_catalog` column touch frozen
contracts (`src/db/schema.ts` + `drizzle/**`), so the addition is ADR-gated (rule
1) even though it is purely additive and changes no existing shape.

## Decision

Add migration `0030_capability-graph.sql` with four **global reference tables**
(no `org_id`, seeded IN the migration like `roles`/`metric_catalog`) and one
additive column.

**`domains`** — top-level area a capability belongs to. `slug` PK, `label`,
`sort`, `is_active`. Seeded with the single launch domain `engineering`.

**`capabilities`** — an outcome-named durable ability. `slug` PK (one active row
per capability; a version bump is a content edit, not a new row — simpler than
`score_definitions` because there is no per-org override or history table for
reference content), `domain_slug` FK → `domains.slug`, `version`, `label`,
`summary` (one-line plain-English, a fact-checked claim surface), nullable
`workflow`/`playbook`/`learning_path` coaching prose (folds the retired static
`/playbook` page into data over P2–P4), `sort`, `is_active`. Seeded with the v0
Engineering set of **9** capabilities.

**`capability_signals`** — the reuse hinge binding a capability to EXISTING
evidence: either a canonical `metric_key` (FK → `metric_catalog.key`) OR a score
`component_key` (validated against `SCORE_GLOSSARY` in the seed-contract test —
Postgres has no reference table for component keys). Surrogate `id` PK because a
`PRIMARY KEY` forces its columns `NOT NULL` and the natural key spans the two
nullable binding columns; uniqueness is a `NULLS NOT DISTINCT` unique constraint
on `(capability_slug, metric_key, component_key)`. A CHECK enforces **exactly
one** of the two binding columns is set. **No new signals are introduced** — the
capability layer only points at what the connectors already ingest.

**`capability_dependencies`** — prerequisite edges (a shallow DAG). PK
`(capability_slug, requires_slug)`, both FK → `capabilities.slug`, a CHECK
forbidding self-edges. Acyclicity is enforced by a TS DFS in the seed-contract
test (a tiny graph — cycle detection in code, not SQL).

**`recommendation_catalog.target_capabilities text[]`** (additive, default
`'{}'`) — the capability slugs a recommendation advances, validated ⊆
`capabilities.slug` in the seed test (element-level, like `applicable_roles`).
The migration `UPDATE`s the 7 global recommendation rows to link each to its
capability. Consumed display-only in P1 (a coaching-card label); the ranker
(P3) will read it for prerequisite gating.

Reads go through a new `forOrg` namespace **`capabilities`**
(`src/db/org-scope/capabilities.ts`): `list()` (the global capability list),
`labels()` (slug → label map for the coaching card), and `graph()` (capabilities
+ dependencies + signals in one batched set, for the P2 engine and P3 ranker).
All global reference reads — not org-filtered, so NOT part of the isolation
sweep. Author-via-migration only (no CRUD write path).

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — four new global reference tables +
  `recommendation_catalog.target_capabilities` (additive; no existing shape
  changed). Migration `0030_capability-graph.sql`.
- **`src/lib/recommendation-catalog.ts`** — `CatalogRecommendation` +
  `mapCatalogRow` gain `targetCapabilities` (additive optional field).
- Tenancy layer: new namespace on `forOrg` (`src/db/org-scope.ts`) — the public
  API grows by one member; existing members byte-for-byte unchanged.
- Not affected: `tracked_user` semantics, credential shape, `connector-facts.md`
  (P1 adds ZERO signals — a premature edit there would be scope creep). Existing
  `deriveAttention` output is byte-identical except the optional display label
  (pinned by the migration-equivalence guard).

## Three-registration law

The four capability tables are **global reference data (no `org_id`)**, so — like
`roles` and `metric_catalog` — both completeness tripwires
(`tests/tenant-isolation.test.ts` SCOPED_READS, `src/db/account-deletion.ts`
PURGE_TABLES) skip them and they need no registration. They carry no per-person
data and survive account deletion. The per-person **`user_capability_state`**
(P2) is the org-scoped table that WILL take all three registrations.

## Founder sign-off note (engineering assumption)

The plan flags the ~capability seed list as a founder/product input (§7 item 1).
Executed autonomously per the program directive, the v0 Engineering set of 9
capabilities is authored to bind ONLY to signals the connectors already ingest
(every `capability_signals` binding resolves to a live `metric_catalog` key or
`SCORE_GLOSSARY` component — a claim surface held to invariant b), with a shallow
acyclic prerequisite DAG. It is deliberately conservative (9, not the aspirational
30–40 — capabilities without an evidence binding would fabricate coverage). It is
safe to expand later via an ADR-gated seed migration; nothing downstream hard-codes
the count.

## Consequences

- Every seeded recommendation links to ≥1 live capability; the coaching card can
  now say which capability a nudge advances (display-only, renders nothing when
  unlinked — never a fabricated "Unknown capability").
- The capability read folds into the dashboard/digest existing flat `Promise.all`
  (+1 batched query, no new sequential stage — §8.2 perf floor).
- The hardcoded `ROLE_SLUGS` literal in `tests/recommendation-catalog.test.ts` is
  replaced with a live `roles` read, so it and the capability seed test share one
  source of truth (§5.H latent-drift cleanup).
