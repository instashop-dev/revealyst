# 0033 — Recommendation catalog as seeded data

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** W6-C (founder-directed)

## Context

Spec V4 §8.2 makes the central design call for coaching: **catalog = data,
evaluator = code.** The shipped coaching feature is a 7-entry static TypeScript
map (`src/lib/coaching-recommendations.ts`, `COACHING_RECOMMENDATIONS`), gated
centrally in `deriveAttention` (`src/lib/score-insights.ts`) on a *measured,
weak* (normalized < 40), *sufficiently weighted* (≥ 0.2) component, deduped by
`signalGroup`, capped at 2. That map cannot grow the way the product needs: it
lacks the §8.2 catalog metadata (applicable roles/tools, learning resources,
insight-taxonomy kind, suggested-action type, structured `requiredSignals`) and
tying content to a code deploy is the wrong seam for a growing library of
human-written guidance.

This ADR **supersedes G6's "static map" letter while preserving its intent**:
G6 forbids a formula DSL and any LLM in selection or generation. Moving the
CONTENT to seeded reference data (the exact precedent of `metric_catalog`,
mig 0007, and score presets, mig 0009) keeps the evaluator a small, named,
**closed** vocabulary of comparators over measured facts — no DSL, no LLM, ever.

The change adds a new frozen-contract table (`src/db/schema.ts` + `drizzle/**`)
and grows the `forOrg` public API, so it is ADR-gated (rule 1) even though it is
purely additive.

## Decision

Add one table (migration `0029_recommendation-catalog.sql`).

**`recommendation_catalog`** — a seeded, **versioned reference table** with a
**nullable `org_id`** (NULL = global preset visible to every org; an org may
author its own rows later), mirroring `score_definitions` exactly. Rows are
**immutable per version** — a change mints a new version row, so a person's
stored interaction state stays reproducible.

- Keys/identity: `id` (uuid PK), `org_id` (nullable FK → `orgs.id`, NO ACTION),
  `slug` (the **stable recommendation id**, == the static map's `id` e.g.
  `adoption-active-days`), `version`. Unique `(org_id, slug, version)` **NULLS
  NOT DISTINCT** (the idempotent-seed conflict target; PG15+, Neon + PGlite).
  **`slug` deliberately preserves the 7 static ids** so existing
  `rec_interaction_state.rec_id` rows (W5-D, plain text, no FK) keep resolving
  across the migration — asserted by the migration-equivalence test.
- Targeting: `score_slug` (the `ScoreSlug` the component belongs to, e.g.
  `adoption` — distinct from `slug`/the rec id), `component_key` (the live preset
  component; validated against `SCORE_GLOSSARY` in the seed test),
  `signal_group` (the same-signal dedupe key), `applicable_roles` (text[],
  validated as a subset of `roles.slug` — Postgres has no array-element FK, so a
  "checked set" in the seed test, not a real FK), `applicable_tools` (text[]
  generic capability nouns).
- Content: `title`, `body` (each a claim surface — fact-checked in the seed
  test), `learning_resources` (text[]), `related_workflows` (text[]).
- Metadata (closed vocabularies, DB CHECK-enforced where cheap): `benefit`
  (the static map's `impact`), `difficulty`, `confidence`, `insight_kind`
  (§7.3 taxonomy), `suggested_action_type` (§8.2's 3-value taxonomy),
  `status` (`draft|active|retired`, default `active`), `created_at`.
- `required_signals` (jsonb): the structured comparators the evaluator gates on
  (below).

The 7 legacy entries are seeded idempotently in the migration file (`INSERT …
ON CONFLICT DO NOTHING`, like `drizzle/0009`) with **content copied verbatim**
from the static map + the W5-E metadata. Global rows (`org_id` NULL).

### `required_signals` — the closed comparator vocabulary

`required_signals` is structured data drawn from a **closed** set of comparators
(`src/lib/recommendation-catalog.ts`, zod-validated). A row fires for its
(`score_slug`, `component_key`) only when its component row satisfies EVERY
comparator:

- `measured` — the component is measured this period (not omitted).
- `normalized-below { value }` — normalized value strictly below `value`.
- `min-weight { value }` — component weight at least `value`.

These formalize the EXACT gating the static evaluator applied inline
(measured · normalized < 40 · min-weight ≥ 0.2), now catalog DATA. **Adding a
new comparator `kind` is a closed-enum change — an ADR + review-blocker
(§8.2), never a silent extension.** `signalGroup`-dedup and the cap
(`MAX_RECOMMENDATIONS`) stay EVALUATOR behaviour (aggregation over already-
selected candidates), not per-row data. A seed↔evaluator contract test parses
every seeded row's `required_signals`; an unparseable row reds CI.

### Evaluator + the batched-read design (§8.2 perf floor — an ADR REQUIREMENT)

`deriveAttention` no longer imports coaching content — it **receives** the
catalog rows as an input (`recommendations`) and evaluates each candidate on the
row's own `required_signals`. The perf floor is **explicit** here:

> **ONE per-org catalog read, folded into the caller's existing flat
> `Promise.all`; per-person evaluation IN MEMORY. NEVER N per-person round
> trips** (each Neon round trip is ~500–670ms; a naive per-person lookup is a
> multi-second page).

Wiring:

- A new `forOrg` namespace `catalog` (`src/db/org-scope/catalog.ts`) with
  `list()` — global presets (`org_id` NULL) ∪ this org's rows, active only,
  ordered global-then-org so an org row shadows a same-key preset, mapped to the
  evaluator shape with `required_signals` parsed once. Same live-read pattern as
  `scores.definitions()` (NOT a TS mirror of the content).
- **Dashboard (team):** `list()` joins `readDashboardView`'s single flat
  `Promise.all` and is returned on `DashboardView.recommendations`; the page
  passes it to `deriveAttention` (+1 query, round-trip depth 1 — the perf test
  `tests/perf/authenticated-page-queries.test.ts` still passes).
- **Dashboard (personal self-view):** `list()` joins the personal page's
  existing flat `Promise.all` (+1 query, depth 1).
- **Digest:** `list()` joins the sender's single `Promise.all`
  (`src/poller/digest.ts`) and is threaded through `assembleDigest` →
  `deriveAttention`.

The `recommendations` input is optional; omitted/empty ⇒ no recs (fully
backward-compatible). The `VALID_REC_IDS` static set (used by the interaction
route to reject unknown ids) is retired — the route now validates `recId`
against `catalog.list()` (a write path; one extra read, off any hot render).

The static map (`src/lib/coaching-recommendations.ts`) is **deleted** after
cutover; the migration-equivalence test proves the seeded catalog produces
identical recs.

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — new table `recommendation_catalog`
  (nullable-org reference table, seeded), migration
  `0029_recommendation-catalog.sql` (additive; no existing shape changed).
- Tenancy layer: new namespace on `forOrg` (`src/db/org-scope.ts`) — the public
  API grows by one member (`catalog`); existing members unchanged.
- **`src/contracts/api.ts`** — NOT changed. The existing `recInteractionSet`
  route's shape is untouched; only its handler's validation source moved from a
  static set to the catalog read (no wire-contract change).
- Not affected: `tracked_user` semantics, credential shape, `metric_catalog`,
  `connector-facts.md`, the scoring engine, attribution ladder.

## Workstreams to re-sync

- **W6-B (roles):** `applicable_roles` references `roles.slug` as a checked set.
  The 7 launch entries use empty arrays (universal adoption guidance); a future
  role-targeted row may reference any seeded role slug.
- **W5-D (interaction state):** `rec_interaction_state.rec_id` == catalog
  `slug`; the 7 ids are preserved, so existing state resolves unchanged.

## Consequences

- **Three-registration law** satisfied in this PR: (1)
  `tests/tenant-isolation.test.ts` `SCOPED_READS` gains a `catalog.list` entry
  + a non-vacuous B-org seed (an org-authored row whose UUID-valued `slug`
  joins the leak universe and is exactly what `list()` returns, so a dropped
  org filter surfaces it — the `score_definitions` analogue for a content-
  mapping read); (2) this ADR; (3) `src/db/account-deletion.ts` `PURGE_TABLES`
  gains `recommendation_catalog` (org-AUTHORED rows purged scoped to the org;
  global presets `org_id` NULL survive, like `score_definitions` presets and
  `metric_catalog`).
- Growing the catalog is a reviewed PR inserting rows of human-written,
  fact-checked copy (or a new-version data migration) — never a code change to
  selection logic.
- The only legitimate **future** (V2+) LLM use is a non-authoritative
  restatement layer rephrasing an already-selected, human-authored entry —
  never deciding which entry applies, never inventing guidance (§8.2). Not in
  this ADR's scope.
