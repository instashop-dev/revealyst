# 0021 — Custom Index Builder: org-scope methods, routes, and slug reservation

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Founder
- **Workstream:** W4-U (V1.5 flagship — Spec V3 §8.5)

## Context

Spec V3 §8.5 adds a no-code Custom Index Builder: a Team admin composes a bespoke
AI-adoption index from the closed aggregation vocabulary, previews it against the
org's own data, and publishes a versioned definition that joins the nightly
recompute. This is **UI over the existing engine**, not a new engine — a custom
index is an ordinary `score_definitions` row whose `components` are the same
frozen, zod-validated `scoreComponentsSchema` shapes the presets use. No formula
DSL, no per-tenant expressions, no rules engine (tripwire, §7).

The `score_definitions` schema **already anticipates org-scoped custom rows**
(`org_id` set instead of NULL; the schema comment reads
`'adoption' | 'fluency' | 'efficiency' (+ org customs in V1.5)`), so **no schema
change or migration is required**. The two frozen contracts that must change are:

1. The `src/db/org-scope.ts` public API — the builder needs org-scoped read/write
   methods for custom definitions (frozen tenancy contract, ADR 0001).
2. The API-route surface — new `/api/indexes*` routes. `src/contracts/api.ts` is a
   closed contract; like the share-links routes (ADR 0008) these live **outside**
   `apiRoutes`, inline-validated, so `api.ts` itself is untouched.

## Decision

### 1. Additive `forOrg` methods (`src/db/org-scope.ts`, under `scores`)

All strictly org-scoped (every WHERE pins `org_id`) and never touch a global preset
(`org_id` NULL). Custom rows are distinguished by an `org_id` **and** a `custom-`
slug prefix:

- `scores.customDefinitions()` — every version of every custom index the org owns.
- `scores.publishCustomDefinition({slug,name,subjectLevel,components})` —
  transactionally inserts a new immutable version (retiring the prior active
  version of that slug), enforcing the active-definition cap.
- `scores.archiveCustomDefinition(slug)` — retires the active version (status flip;
  never a delete).
- `scores.unarchiveCustomDefinition(slug)` — reactivates the head version,
  re-checking the cap.

Additive only; no existing method signature or return type changes.

### 2. Six §8.5 guardrails, enforced as code

1. **Team/org subject level only.** `person` is rejected at the zod layer
   (`customSubjectLevelSchema` admits only `team`/`org`) and defensively in the repo.
2. **No fabricated comparability.** Custom scores never render on the benchmark
   panel (the panel is hard-keyed to the three preset slugs and the benchmark
   source omits any slug with no norm) and are **not shareable** — the `/api/share`
   route and `shareLinksForOrg.create()` both reject `custom-` slugs.
3. **Reserved slugs.** `adoption`/`fluency`/`efficiency` are reserved and all custom
   slugs are `custom-`-prefixed, enforced at the API/schema layer because the DB
   uniqueness key `(org_id, slug, version)` NULLS-NOT-DISTINCT permits shadowing.
4. **Bounded cost.** Per-org cap of **10 active** custom definitions
   (`MAX_ACTIVE_CUSTOM_DEFINITIONS`), with archive/unarchive via status flip —
   versioned rows are immutable and never deleted.
5. **Lapse behavior.** When an org is not on the Team plan, custom definitions are
   excluded from the nightly recompute (`recomputeOrg`'s `customIndexesEntitled`
   gate); their last `score_results` rows are left untouched so the UI renders an
   explicit "paused" state, never silently stale numbers. Presets always recompute.
6. **Tier gating.** Team (paid) only — Personal/free orgs get a teaser. Enforced in
   the page and in every mutating/preview route (`assertCustomIndexEntitled`).

### 3. Routes (outside frozen `api.ts`)

`GET|POST /api/indexes`, `POST /api/indexes/preview`,
`POST /api/indexes/:slug/archive`, `POST /api/indexes/:slug/unarchive` — all
admin-only (`handleApi({adminOnly:true})`) and Team-paid gated. Preview reuses the
recompute engine's evaluate path read-only (no persistence), inheriting the honesty
rules (a ratio component with data on only one side is omitted, never floored to 0).

## Contracts affected

- **`src/db/org-scope.ts` public API** (ADR 0001) — four additive, org-scoped
  methods under `scores`. No existing method changed.
- **API-route surface** — new `/api/indexes*` routes, inline-validated outside the
  frozen `apiRoutes` map; `src/contracts/api.ts` is untouched.
- **`src/db/share-links.ts` / `/api/share`** — additive guardrail: `custom-` slugs
  rejected (guardrail 2). No shape change.
- **No `src/db/schema.ts` or `drizzle/**` change** — org-scoped custom rows already
  fit the frozen `score_definitions` shape.

## Workstreams to re-sync

None. All changes are additive. The recompute change is backward-compatible
(`customIndexesEntitled` is optional and resolved from the subscription when
omitted; presets are unaffected).

## Consequences

- Nightly recompute cost grows by at most the active-cap (10) custom definitions
  per entitled org; archived/lapsed definitions cost nothing.
- `score_definitions` now holds three row classes: global presets (`org_id` NULL),
  personal-org preset clones (ADR 0014, non-custom slug), and org customs
  (`custom-` slug). The slug prefix is the single discriminator downstream.
- The tenant-isolation sweep gains a `scores.customDefinitions` entry; the table
  (`score_definitions`) was already covered, so the completeness tripwire is
  unaffected.
