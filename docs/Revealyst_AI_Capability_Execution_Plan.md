# Revealyst — AI Capability Execution Plan (V4 Wave 7–8)

> Execution-ready plan for the AI Capability program: capability graph, per-person
> capability/mastery state, recommendation ranker, personal coaching, missions, and
> privacy-safe team rollups. Extends [V4 Execution Plan](Revealyst_Execution_Plan_V4.md)
> (at W6) as **Wave 7** (non-gated) + **Wave 8** (gated tail). Grounded in
> [AI Capability Gap Analysis](ai-capability-implementation-gap-analysis.md) and the
> [AI-capability deep-research report]. Every workstream follows the operating rules in
> [CLAUDE.md](../CLAUDE.md) (rules 1–7, three-registration law, honesty invariants a–d).
>
> **Wave numbering note (avoids the doc-collision the gap analysis flagged):** the gap
> analysis numbers its roadmap "Wave 0–8" *internally*. In the Execution Plan's live
> sequence (W5/W6 shipped, W7 next-free) those become the **phases W7-0 … W7-6 of Wave 7**
> plus **Wave 8** for the gated tail (experimentation; OTel measured-tier + role expansion).
> This document uses the phase labels **P0–P8**; the Wave mapping is in §3.

---

## 0. Plan-on-a-page

**The thesis.** Revealyst already shipped ~60–65% of a capability system without naming it:
an org-scoped tenancy layer, a durable per-person identity model, four connectors, a
**catalog-as-data / evaluator-as-code** recommendation engine, per-person scoring, interaction
state, and privacy enforced *in code*. This program adds the thin missing layer — a relational
capability graph, a parallel per-person mastery-state engine, a ranker that finally consumes the
catalog metadata it already stores, missions, and aggregate team rollups — **evolving, not
rewriting**, and staying inside the product's hard constraints (no third ladder, no fixed persona
labels, no XP/streaks/leagues, no graph DB, no ML service, no LMS).

**The spine (each phase ships whole — no half-integrated systems).**

| Phase | Milestone | User-visible value | Effort | Risk |
|---|---|---|---|---|
| **P0** | Foundations & de-risking | none (correctness) | S | Low |
| **P1** | Capability graph & catalog linkage | recs say *which capability* they advance | M | Low |
| **P2** | Capability evidence & user state (directional) | personal capability profile | L | Medium |
| **P3** | Recommendation ranker v1 | better-ordered, role/prereq-aware next steps | M | Medium |
| **P4** | Personal coaching experience | one coherent "level → next step → why → progress" loop | M | Low |
| **P5** | Missions & progression | bounded, finish-lined challenges | M | Medium |
| **P6** | Team capability rollups | managers see where to coach (aggregate, count-only) | M | Medium |
| **P7** | Experimentation & learning · **Wave 8, gated** | measurable rec lift | L | High |
| **P8** | OTel measured tier + role expansion · **Wave 8, gated** | measured (not directional) proficiency; non-eng roles | L | Med–High |

**P0–P6 = Wave 7, fully shippable today** with mastery capped at `directional`. **P7–P8 = Wave 8**,
each behind a named external gate (real "tried" volume + privacy-reversal ADR; founder OTel capture;
honest role-telemetry source).

**Eight workstreams** (§5): Feature Implementation · Telemetry & Metrics · AI Coaching ·
Performance Optimization · Testing & Seed Data · Migration & Backward Compatibility · Documentation ·
Technical Debt.

**Numbering at build time.** Next migration is **0030**; next ADR is **0035** (verify with
`ls drizzle/*.sql` / `ls docs/decisions/` immediately before each PR — migration and ADR are
independent sequences and a parallel merge can claim your number, per the W4 lesson).

---

## 1. Cross-cutting laws (stated once; every workstream inherits them)

These are the repeated constraints from CLAUDE.md and the gap analysis. Workstream specs below
reference them by name instead of restating.

- **L1 · Three-registration law.** Every new *org-scoped* table needs, in the same PR: (1) a
  `tests/tenant-isolation.test.ts` `SCOPED_READS` entry with a **non-vacuous B-org seed row**,
  (2) a `docs/decisions/NNNN-*.md` ADR, (3) a `src/db/account-deletion.ts` `PURGE_TABLES` entry
  **ordered before `people`** (composite tenant FK cascades). Global reference tables (no `org_id`)
  skip all three but any *additive column* on a frozen table is still an ADR.
- **L2 · Frozen-contract discipline.** `src/contracts/**`, `src/db/schema.ts`, `drizzle/**`,
  `src/db/org-scope.ts` public API, `src/lib/credentials.ts`, `docs/connector-facts.md` are frozen;
  CI blocks a change without an ADR in the same PR. Regenerate migrations offline:
  `npx drizzle-kit generate --name <slug>` — never hand-write SQL.
- **L3 · The perf law.** One per-org batched read per new surface, folded into the existing flat
  `Promise.all` (dashboard + digest), evaluated per-person **in memory** — never a per-person round
  trip (each Neon RTT ≈ 500–670 ms). The catalog read (`src/db/org-scope/catalog.ts`) is the template.
- **L4 · Honesty primitives (invariant b).** Reuse `lowestAttribution`, the ratio-omission rule, and
  null-on-absence (`src/scoring/evaluate.ts`, `src/contracts/attribution.ts`) verbatim in any new
  evidence math. Absence is never a fabricated 0; a person with no evidence for a capability gets no
  row, never `mastery: 0`. Prose is a claim surface — every rendered string is fact-checked.
- **L5 · Two-ladder law.** Org matures (maturity model), person progresses (proficiency band). The
  capability profile is a **decomposition of the one person band**, never a competing third ladder.
- **L6 · Self-view enforcement in code (G3).** Per-person coaching/mastery/mission state renders only
  in the self-view, enforced by a `visibilityMode`-parameterized read + the `assertTeamOnlyPseudonymized`
  completeness-tripwire registry (`src/lib/visibility.ts`) — register every new per-person surface or
  the predicate passes vacuously.
- **L7 · Directional-until-measured (G2).** Mastery is capped at `directional` (the existing
  `ConfidenceTier`, `src/lib/maturity.ts:516`) until the OTel receiver (P8) provides ≥2 corroborating
  markers per capability; only then upgrade to `measured`, with the tier label rendered, never implied.
- **L8 · No new engines, no ML, no graph DB.** Catalog = data, evaluator = code; the ranker is a
  deterministic formula; the graph is relational (~30–40 nodes). ML/bandits/BKT and a graph DB are
  standing tripwire violations — deferred until real feedback volume exists, and even then re-gated.
- **L9 · Merge discipline.** `/code-review` + apply fixes **before** `gh pr create` (merge-race). Verify
  CI explicitly (`gh pr checks <n>`, grep `fail|error`) before merging — never pipe checks into merge.
  Serialize the *builds* of parallel schema-touching phases, not just the merges (W6 lesson).

---

## 2. Migrate / Deprecate / Remove / Retain

| Disposition | Item | How / when |
|---|---|---|
| **Retain untouched** | Score engine (`src/scoring/evaluate.ts`) + honesty primitives (`lowestAttribution`, ratio-omission, null-on-absence) + all four connectors' `normalize` contracts incl. every deliberate drop | Capability state is computed *from* their output as a parallel reducer, never by extending frozen contracts |
| **Retain untouched** | Maturity model (`src/lib/maturity.ts`), `ConfidenceTier`, `signal-coverage.ts`, `forOrg` tenancy + composite-FK pattern, catalog-as-data/evaluator-as-code split, self-view enforcement (3 layers), interaction state | Reused as-is across P1–P6 |
| **Refactor (additive, ADR)** | `recommendation_catalog` gains `target_capabilities text[]` | P1; ADR in the same PR (frozen-path guard) |
| **Refactor (consume, don't delete)** | `deriveAttention` stops ignoring `applicable_roles`/`applicable_tools`/`benefit`/`difficulty`/`confidence`; fixed `impact:1` → deterministic utility formula | P3; output-equivalence guard proves today's weakest-first order is a strict subset before the rewrite ships |
| **Refactor** | Growth Journey card "level" source: org-maturity → person capability band (personal-org only until measured) | P2/P4 |
| **Refactor** | `src/poller/process.ts` gains a parallel capability-state reducer step (does **not** modify `src/scoring/recompute.ts`) | P2 |
| **Migrate** | `/playbook` static content → folded into capability content / `/methodology` explainer | P4 (retire the standalone route only after the fold is complete) |
| **Remove** | Dead `src/scoring/segment.ts` `segmentTeams` path + its test | P0; port or retire its one live consumer `scripts/calibrate-scores.ts` **in the same PR** (W5-A(4) precedent) |
| **Not built (non-goal, every phase)** | Fixed AI-persona labels; XP/streaks/leagues; graph database; ML service (GBM/bandits/BKT); LMS/course/certification layer | Contradict Spec V4 §8.4 / §11.5 NOT-list + standing tripwires; personas survive only as an aggregate cohort lens (`src/lib/segments.ts`) |
| **Deferred (gated)** | `recommendation_exposure` log, experimentation/holdout framework, Outcomes entity | P7 (Wave 8); own ADR reversing the current "don't log rec-shown" stance; never ship an always-empty table (invariant-b trap) |

---

## 3. Phased milestones (Wave mapping + exit criteria)

**Wave 7 (non-gated, ships with mastery capped `directional`):** P0 → P6.
**Wave 8 (gated):** P7 (experimentation), P8 (OTel measured tier + role expansion).

| Phase | Wave | Depends on | Exit criterion |
|---|---|---|---|
| P0 Foundations | W7-0 | — | Dual-source dedup fix live; `segmentTeams` gone; predicate registry proven extensible |
| P1 Capability graph + linkage | W7-1 | P0 | Every seeded rec resolves to ≥1 live capability; DAG acyclic; `deriveAttention` output byte-identical except the capability label |
| P2 Capability state (directional) | W7-2 | P1 | Founder sees own per-capability band + confidence; a manager provably cannot; all rows capped `directional`; backfill idempotent; 3 registrations green |
| P3 Ranker v1 | W7-3 | P1 (+P2 for prereq gating) | Ranker reads all previously-inert metadata; deterministic + fully tested; no added query stage |
| P4 Coaching experience | W7-4 | P2, P3 | One coherent self-view loop; digest & dashboard provably share source |
| P5 Missions | W7-5 | P3, P4 | A person completes one mission end-to-end, **measured not self-asserted**; no XP/streak UI; 3 registrations green |
| P6 Team rollups | W7-6 | P2 | Team coverage renders aggregate-only, `MIN_PEOPLE`-floored; predicate green; exec-memo line traces to real state |
| P7 Experimentation | W8 (gated) | P3–P6 + real volume + privacy-reversal ADR | A ranking change can be A/B'd with a deterministic holdout; exposure/outcome self-view-only end-to-end |
| P8 OTel + roles | W8 (gated) | founder OTel capture (W6-D) + role-telemetry research answer | ≥2-marker capabilities render `measured`; a second role has an honest telemetry source; no cross-channel double-count |

---

## 4. Critical path, parallelization, blockers, quick wins

**Critical path (spine):** `P0 → P1 → P2 → P3 → P4 → P5`. P6 branches off **P2** only (parallel to
P3–P5). P7/P8 are Wave-8, gated, off the critical path.

**Quick wins (S effort, zero dependency, do first):** the P0 dual-source dedup fix and the dead
`segmentTeams` removal. Both unblock trust in per-person aggregation (P2's capability sums are wrong
until dedup lands) and are fully parallel to all planning/doc work.

**Parallelizable:**
- Within P1: schema/migration and the display-only capability-label threading run in parallel once the
  seed content (the ~30–40 capability list + prerequisite DAG) is authored — but **authoring is a
  founder/product input** (§7), not an agent invention.
- P6 (team rollups) depends only on P2's state table, so it runs parallel to P3/P4/P5.
- The Technical-Debt items (dedup, `segmentTeams`) are parallel to each other and to everything.

**Hard blockers (external — cannot be compressed by agent work):**
- **OTel gate (P8):** measured-tier upgrade blocked on the founder's OTel receiver fixture capture
  (W6-D) + Claude Code OTel schema stability. Everything through P6 ships and is useful at `directional`.
- **Privacy-reversal ADR (P7):** exposure logging reverses the deliberate "don't log rec-shown-to-X"
  stance (`src/app/api/recommendations/interaction/route.ts:16-19`) — a founder-signed ADR gates P7
  entirely, regardless of usage volume.
- **Role-telemetry research (P8):** non-engineering role packs blocked on an honest telemetry source
  (M365 Copilot / Google Workspace admin APIs — Spec V4 §16(3)).

**Founder sign-off gates specific phases (not the whole roadmap):** the capability seed list (P1); the
"third-ladder" confirmation (P2 UI); missions-inside-anti-gamification (P5); persona-as-aggregate-only
(P6). Fire these via `/adr` / Spec V4 §16 before the phase's implementation starts.

**Sequencing risk:** P0/P1/P2 all touch `schema.ts`, `drizzle/`, `src/db/org-scope/`, and
`tests/tenant-isolation.test.ts`. Apply L9 — serialize the builds and rebase+renumber migrations/ADRs
before each subsequent PR opens.

---

## 5. Workstreams

Eight workstreams, each phased against P0–P8. Shared laws (§1) are referenced by tag, not restated.

### 5.A · Feature Implementation

The capability graph, mastery-state engine, coaching surfaces, and team rollups. Three lanes:
**(A1) Capability graph & data model**, **(A2) Capability & mastery engine**, **(A3) Surfaces & IA**.

#### A1 · Capability graph & data model (backend)

**P1 — Objectives.** Stand up the relational capability graph as seeded reference data and link the
existing catalog to it. No engine, no state, no ranking change.
**Deliverables.** In `src/db/schema.ts`, four global reference tables (no `org_id`, mirror `roles`
`:1128` / `recommendation_catalog` `:1286`): `domains` (`slug` PK, label, sort, isActive);
`capabilities` (`slug` PK, `domain_slug` FK, `version`, content columns for workflow/playbook/
learning-path prose, `NULLS NOT DISTINCT` unique on `(slug, version)`); `capability_signals`
(`(capability_slug, metric_key|component_key)`; FK `metric_key → metric_catalog.key`; component
bindings validated against `SCORE_GLOSSARY` in the seed test); `capability_dependencies`
(`(capability_slug, requires_slug)`; CHECK forbids self-edges; acyclicity enforced by a TS DAG walk in
the seed test). Additive `target_capabilities text[]` on `recommendation_catalog`
(`.notNull().default('{}')`). New `src/db/org-scope/capabilities.ts` namespace (one batched `list()` +
`graph()`), registered in `forOrg()` (`src/db/org-scope.ts:184`). Extend `CatalogRecommendation` +
`mapCatalogRow` (`src/lib/recommendation-catalog.ts`) with `targetCapabilities`. Migration
`drizzle/0030_capability-graph.sql` is the seed (≈30–40 capability rows + edges), like `0029`/`0026`.
**Dependencies.** P0. Blocks P2/P3.
**Technical approach.** Reference tables skip L1's three registrations; only the `recommendation_catalog`
column addition needs an ADR (L2). Capability read is org-independent-cacheable and folds into the
existing `Promise.all` (L3).
**Data/telemetry.** No new signals; `capability_signals` only *points at* existing metric/score keys.
**UX.** Coaching card renders "advances *Capability X*" (display-only; A3-P1).
**Performance.** L3 — one extra batched read, never per-person.
**Testing.** Seed-contract battery (WS Testing P1). `deriveAttention` equivalence guard.
**Risks.** Med — 30–40 hand-authored capability rows are a claim surface (L4); component-key-family
alignment asserted in the seed test, not just "resolves to *a* slug."
**Effort.** M. **Acceptance.** Every seeded rec links ≥1 live capability; DAG acyclic; `deriveAttention`
output unchanged except the label; ADR + column in the same PR; one batched read, no N+1.

#### A2 · Capability & mastery engine (metrics)

**P2 — Objectives.** Persist per-person capability mastery as a parallel, ADR-gated, incremental engine
— never bolted onto the frozen score engine (the Maturity Model is the precedent: a pure lib over
org-scoped readers). Capped `directional` (L7).
**Deliverables.** `user_capability_state` table (org-scoped): PK `(org_id, person_id, capability_slug)`,
composite tenant FK → `people(org_id,id)` ON DELETE CASCADE, columns `mastery`, `confidence`,
`confidence_tier` (reuse `ConfidenceTier`, hard-capped `directional` this phase), `evidence_count`,
`last_evidence_at`, `staleness`, `next_capability`, and a `components` jsonb breakdown mirroring
`ScoreComponentBreakdown` for explainability; indexes `(org_id, person_id)` + `(org_id, capability_slug)`.
New `src/db/org-scope/mastery.ts` namespace (self-view-scoped read). A **new** `case "capability-state"`
reducer step in `src/poller/process.ts` (after `score-recompute`), implemented in a new pure lib
`src/scoring/capability-state.ts` — **incremental** (reads its own prior row, applies decay, folds
evidence since `last_evidence_at`). Idempotent per-org-fan-out backfill (safe to ship empty). Three
registrations (L1), ordered before `people`.
**The v0 formula (interpretable; §8 of the gap analysis):**
```
mastery(p,c) = σ( w1·repeat_use + w2·breadth + w3·success_proxy + w4·agentic_depth − w5·long_gap )
confidence   = 0.5·measurementCoverage(signal-coverage) + 0.3·evidenceCount + 0.2·historicalSuccess
staleness    = days since last bound-signal evidence; mastery decays/withholds past a threshold
```
`measurementCoverage` = `computeSignalCoverage`/`coverageForPerson` (`src/lib/signal-coverage.ts`)
verbatim. `success_proxy` reuses the fluency `effectiveness` per-connector logic. **Reuse L4 verbatim**:
zero evidence → no row (never `mastery: 0`); one-sided ratio omitted.
**Dependencies.** P0 (dedup must land — per-person sums untrustworthy otherwise), P1 (graph).
**Technical approach.** Consume **exclusive** subjects only (`loadPersonSubjects`, `src/scoring/
recompute.ts:152-180`). Priors = person-level scores + maturity axes. L5: the breakdown is a
decomposition of the one band. **Incremental**, not a second full nightly snapshot (L3).
**Data/telemetry.** New table only; no `metric_records`/`score_definitions.components` change. Nightly
job-health metric (evidence-rows-processed, rows-updated, org count) so a silent no-op is visible.
**UX.** Capability-profile card on the Companion (A3-P2), self-view only. `confidence_tier` renders as
plain language ("early read"), never jargon.
**Performance.** Reducer reuses the nightly fan-out; reads fold into batched readers (L3); delta window
bounded by the watermark — a query-count-independent-of-history test is mandatory (WS Perf P2).
**Testing.** State math vs. known-truth fixtures; explainability (component deltas sum to the mastery
delta); self-view authorization; purge ordering; confidence-tier cap; honesty-rule reuse (WS Testing P2).
**Risks.** Medium — "incremental" silently degrading to "full recompute" is the top regression mode;
decay math is subtle.
**Effort.** L. **Acceptance.** Founder sees own band+confidence+next; manager provably cannot; every row
`directional`; zero-evidence → no row; reducer idempotent under redelivery; 3 registrations green.

**P8 (Wave 8, gated) — measured-tier upgrade.** Once the OTel receiver (W6-D) emits markers via
`capability_signals`, the same reducer checks ≥2 **corroborating** markers per (person, capability):
≥2 → eligible `measured`; 0–1 → stays `directional` (or `not_measured` if stale). No cross-channel
double-count (a marker and its metric-derived twin for the same event count once — extends P0's dedup
discipline). Additive marker metrics only. **Acceptance.** ≥2-marker capabilities render `measured`
self-view-only; a second role reaches `measured` only where an honest telemetry source exists.

#### A3 · Coaching surfaces & IA (frontend + UX)

All additions are **cards on the existing Companion / Team home** — no new routes, no nav changes
(`src/components/app-sidebar.tsx` untouched). base-nova `Card` with `ring-*` (never `border-*`); server
components reading the existing batched `Promise.all`; no client per-person fetch. New copy lives in a
`src/lib/capability-glossary.ts` module (the `companion-glossary.ts` pattern — one file a fact-check
sweep covers in one pass), banned-phrasing tested. **IA disposition:** retain dashboard/maturity/
connections/settings/etc.; fold `/playbook` into capability content; `/people`+`/teams` already merged
into Settings (W5-H); `/indexes` already demoted; **no new top-level "Capabilities"/"Missions"
dashboard**; no admin catalog CRUD (migration-authored only).

- **P1 — Capability label on the coaching card** (`src/components/companion/coaching-card.tsx`): an
  optional `capabilityLabel` line; renders nothing when null (never a fabricated "Unknown capability").
  Effort S / Low.
- **P2 — Capability-profile card** (`src/components/companion/capability-profile-card.tsx`, inserted
  after `CoachingCard` in `PersonalSelfView`): a compact list (mastery band chip + confidence + 1–2
  "eligible next"), capped to ~5–6 rows, positive-first ("discovery, never deficiency"). Raw 0–100 stays
  behind the **existing** `DiagnosticDetails` expander — no second expander. Forming/empty state renders
  the honest `formingLead` pattern, never zeros. **Blocked on the third-ladder sign-off (§7).** Effort M
  / Medium.
- **P4 — Next-best-action loop + progression:** Growth Journey card's level source → person capability
  band (personal-org only until measured); confirm the coaching list renders in backend utility-rank
  order with a computed "why" line; a compact "moved Building → Established" trend folded into the
  profile card (reuse `RecentMovementPanel` visual language). Prefer **"save"** over "accept" (accept
  implies a write the product doesn't do). Effort M / Low.
- **P5 — Mission card** (`src/components/companion/mission-card.tsx`, modeled on `MilestoneCard`):
  opt-in only, renders null until started; states not-started / "1 of 2 steps" / complete; celebration
  reuses `MILESTONE_COPY`'s grounded voice — **no** streak flame, XP, league, or percentage-meter-as-game.
  Start/step actions are a `"use client"` island posting to `/api/missions/*` (the
  `rec-interaction-actions.tsx` pattern). **Blocked on missions-anti-gamification sign-off (§7).** Effort
  M / Medium.
- **P6 — Team capability-coverage card** (`src/components/dashboard/capability-coverage-card.tsx`, inside
  the existing "(c) Training opportunities" section of `TeamOverview` — no 6th section): share-of-team
  mastering each capability, **count-only**, `MIN_PEOPLE`-floored (rows below the floor render nothing,
  never a suppressed-but-implied number). The row prop type carries no `personId`/`personName` — a
  per-person shape is structurally impossible. Effort M / Medium (High overall via the backend privacy dep).

**Testing (all A3):** component tests under `src/components/**/*.test.tsx` (vitest maps `@`→`src`):
label present/absent; no raw-number leak outside the expander; forming states; mission copy contains zero
gamification vocabulary (grep-style); coverage rows below `MIN_PEOPLE` fully suppressed. **UX acceptance:**
every new surface passes the CLAUDE.md UX checklist (minimal-by-default, progressive disclosure, plain
English, positive-first) and a non-author content fact-check (W3-N pattern).

### 5.B · Telemetry & Metrics

**P2 — Capability funnel counters (S/Low).** Add `capability_profile_view`, `next_step_open`,
`mission_start`, `mission_complete` to the `LaunchEventName` union (`src/lib/launch-events.ts`), each
with a **coarse slug dim only** (never a person/org id — the sink's hard rule). Fire at the same edge
seam as `companion_revisit` (views) or best-effort from server actions (start/complete). Extend
`scripts/launch-metrics.ts`. No new tables. **Acceptance.** Four event kinds fire with slug-only dims; no
PII in any blob.

**P6 — Aggregate coverage & lift metrics (M/Medium).** Capability-coverage band distribution +
period-over-period lift computed as a **Postgres aggregate** through `assertTeamOnlyPseudonymized` +
`MIN_PEOPLE` (not an Analytics Engine event); one exec-memo line via `composeExecReport`. Register the new
field in the predicate (L6). **Risk:** inherits the P0 dedup defect — lift numbers are wrong until P0
lands; block on it explicitly (invariant-b on an exec-facing number). **Acceptance.** Aggregate-only,
never below `MIN_PEOPLE`; predicate test green; lift correct only post-dedup.

**P7 — Exposure log + experimentation (Wave 8, gated · L/High).** The existing anonymous sink **cannot**
carry this (no-ids rule) and it **conflicts** with the deliberate "don't log rec-shown-to-X" stance —
so it needs a **new self-view-only store under its own ADR** (never manager/admin-readable,
purge-registered, impersonation caveat named per L4/§10). Deterministic holdout assignment (stable hash,
not per-request random); copy/ranking experiment registry; exposure write is fire-and-forget off the hot
path (L3). Offline Precision@k/NDCG@k harness only once exposure logs are real; the **Outcomes entity**
ships only when "tried" volume is real (no hollow table). **Acceptance.** ADR reviewed against the
impersonation caveat + no-ids conflict before any table exists; a ranking change is A/B-able with a
deterministic holdout; exposure/outcome data self-view-only end-to-end.

**Cross-cutting:** instrument the P2 capability-state reducer's job health (must not silently no-op).

### 5.C · AI Coaching (ranker · catalog consumption · missions)

**P1 — Rec→capability linkage (S/Low).** `target_capabilities` consumed for the coaching-card tag; ranking
untouched (`deriveAttention` output byte-identical). Author the mapping by hand; the seed test asserts
component-key-family alignment.

**P3 — Utility ranker v1 (M/Medium).** Replace the fixed `impact:1` (`src/lib/score-insights.ts:816`)
with a pure `computeUtility` in `src/lib/recommendation-catalog.ts`, consuming today's **inert** metadata:
```
utility = 0.35·capabilityGap + 0.20·benefitWeight + 0.15·confidenceWeight
        + 0.10·roleToolFit   + 0.10·novelty      − 0.05·difficultyPenalty − fatiguePenalty
```
All weights are named, exported constants (greppable, term-by-term unit-testable). **Stage-1 eligibility**
extends to: `role_assignments` × `applicable_roles`, connected tools × `applicable_tools`, and
**prerequisite gating** (every `capability_dependencies` prereq of the rec's `target_capabilities` is
mastered in `user_capability_state`; missing state = **not** mastered, fails closed — L4). Fatigue reuses
`rec_interaction_state` recency (no new exposure log). `MAX_RECOMMENDATIONS` cap + signal-group dedupe
**unchanged**. **No ML, no LLM in selection** (L8). Ship role/tool + formula without prereq gating if P2
lags (documented partial fallback).
**Output-equivalence guard (required):** with `benefit=confidence=difficulty="medium"` and no
fatigue/eligibility exclusions, the new order must reduce to today's weakest-first order on a fixed
fixture — a literal unit test, kept permanently as a regression net.
**Acceptance.** Ranks by the deterministic formula; prereq + role/tool gate before ranking; cap/dedupe
unchanged; equivalence guard green; every term independently tested; per-term breakdown is loggable
(explainability).

**P4 — Coaching loop (M/Low).** A computed "why" line (from the dominant utility term, so it can't drift
from the actual reason) + an honest confidence disclosure ("based on 3 connected sources", never a
fabricated %). The digest lane already shares the `deriveAttention` path — enforce it with a
shared-source test (WS Testing P4). Weekly-reflection card deferred (not MVP).

**P5 — Missions (M/Medium).** `missions`/`mission_steps` seeded reference tables (each step references a
`recommendation_catalog.slug` — a mission is a curated *sequence* of existing recs, not new advice) +
`mission_progress` (org-scoped, self-view, L1). Completion = a **measured signal crossing** via the
milestone plumbing (`crossedMilestone`/`isNewBest`, strict `>`), never self-asserted. Celebration extends
`MILESTONE_COPY`; **no XP/streaks/leagues** (L8, Spec V4 §8.4). **Acceptance.** A person completes one
mission from measured signals; `mission_progress` self-view + purge-registered; zero gamification copy.

**Deferred (L8):** bandits/GBM/BKT/feedback-learning — need exposure logs + real "tried" volume (P7).

### 5.D · Performance Optimization

**P2 — Capability reads join the batched read (M/Medium).** `capabilities`/`capability_dependencies`/
`capability_signals`/`user_capability_state` reads each fold into `readDashboardView`'s existing
`Promise.all` (`src/lib/dashboard-view.ts`) and the digest batch — one added array slot, **not** a new
sequential `await`. In-memory eligible-next traversal is a pure function over the batch. **Target:
dashboard goes 12 → ~14 queries at depth 1** (unchanged depth). `user_capability_state` batch is
`eq(orgId, org)` (all persons, one query), joined in memory by `subject_id`.
**Incremental reducer (High-risk sub-item):** the P2 reducer must be O(delta) not O(history) — bounded by
the `last_evidence_at` watermark; reject any "re-read all history to be safe" implementation.
**Observability:** extend `Server-Timing` stages to the capability read (any request-scoped singleton
anchors on `globalThis` per the OpenNext double-bundle gotcha, PR #127). **Edge-cache guardrail:** confirm
capability/Companion routes stay off the incremental/interception cache (authenticated per-person data must
never be edge-cached — a cache HIT here is a correctness bug, not a win). **Backfill:** per-org queue
fan-out, bounded, watermark-resumable — never a synchronous request-path or cross-org query.
**Testing.** Extend `tests/perf/authenticated-page-queries.test.ts`: dashboard query count = baseline + 2,
depth unchanged; run the query counter against a **50-person** fixture org to prove no per-person query;
reducer query-count independent of person count and of history depth. **Acceptance.** Perf test green at
+2/depth-unchanged; no per-person query in the instrumented log; reducer cost scales with delta, not
history; no cache HIT on authenticated capability routes.

### 5.E · Testing & Seed Data

Never trails the wave it tests; the seed-contract test **gates** its migration's merge.

- **P0 (S/Low).** Dual-source dedup regression (fails on pre-fix code, passes post-fix). Predicate-registry
  extensibility check (confirm it's a registry, not a hardcoded switch; flag back if it's a switch).
- **P1 (M/Medium).** `tests/capability-catalog.test.ts` against a **migrated PGlite DB** (not a TS mirror):
  (1) exact row counts, (2) stable slugs (sorted-array equality), (3) idempotent-seed replay, (4) every
  `capability_signals` binding resolves to a live `metric_catalog` key or `SCORE_GLOSSARY` component,
  (5) `target_capabilities ⊆ capabilities.slug` and `applicable_roles ⊆ roles.slug` — **sourced from a
  live `roles` read, not a hardcoded set** (fixing the latent drift in `recommendation-catalog.test.ts:38`
  — replace its literal set with a DB read so both suites share one source of truth), (6) DAG acyclicity +
  no self-edges + both ends resolve. Six separate `it()` blocks. Migration-equivalence guard for
  `deriveAttention`.
- **P2 (L/Med-High).** Capability-state math vs. known-truth fixtures (band boundaries; confidence from
  coverage; decay over simulated time; ≥2-signal rule; directional-vs-measured via `BANNED_PHRASING`;
  explainability). Self-view authorization (own-id allowed, other-id **rejected via the guard**, not an
  empty array; no cross-person route; predicate-registry entries). Three-registration with non-vacuous
  B-org seed; purge ordered before `people`. No-N+1 reducer test.
- **P3 (M/Medium).** Ranking golden tests (weakest-first strict subset; prereq gating; role/tool
  eligibility; fatigue) + determinism (2 runs byte-identical). These **are** the ranking-quality gate until
  P7's offline harness exists.
- **P4 (M/Low).** Digest/dashboard shared-source (assert on the call site); reflection/why copy
  banned-phrasing + no-blaming.
- **P5 (M/Medium).** Mission seed-contract battery; completion-detection (signal crossing advances;
  self-claim without signal does **not**); self-view + 3 registrations; a schema-shape assertion that
  `mission_progress` has no `streak_count`/`xp`/`league` column.
- **P6 (M/Medium).** Aggregation floor (`< MIN_PEOPLE` fully suppressed); no-per-person-leak structural
  test; exec-memo golden file with adversarial content fact-check.
- **P7 (L/High, gated).** Holdout determinism; exposure-log completeness (exactly one row per surfaced rec
  under at-least-once redelivery — CAS discipline); self-view exposures registered day one; offline
  Precision@k/NDCG@k only once real data exists. Flag back rather than scaffold prematurely.

**Seed/fixture discipline.** Add capability + mission fixtures to `npm run dev:seed:demo`, incl. one
fixture person with a hand-verified `user_capability_state`. **Never seed Neon with demo data.**
**CI discipline (L9).** Capture `gh pr checks <n>`, grep `fail|error`, merge only if clean (the #140/#143
incident). Known flakes — rerun, don't chase: `[vitest-pool]` worker crash, `api-impl.test.ts` pseudonym
collision, `preview-deploy` Hyperdrive 500 (`code: 10021`).

### 5.F · Migration & Backward Compatibility

**Objectives.** Land every schema change as an additive, ADR-gated amendment with zero behavioral drift to
existing recommendation output; make new per-person tables first-class citizens of the tenancy/purge/
predicate machinery from their first migration.
**Deliverables.** One ADR per frozen touch: `target_capabilities` (P1, ADR 0035-ish), `user_capability_state`
(P2), missions tables (P5), `recommendation_exposure` (P7) — numbered at build time, re-checked before each
PR (L2/L9). Seed migrations for all reference tables (migration = seed). Idempotent, re-runnable backfill
for `user_capability_state` (safe to ship empty). A `deriveAttention` **output-equivalence guard** at both
the P1 (label added) and P3 (ranker) boundaries. Three registrations per org-scoped table (L1).
**Backward compatibility.** `AttentionItem` gains only optional fields (`capabilityLabel?`, `recId` already
optional) — existing consumers unaffected. Reference-table reads are additive to `forOrg`. No existing
column changes type or meaning.
**Risks.** Parallel-frozen-contract collisions (P0/P1/P2 all append to the same files) — serialize builds,
rebase+renumber (L9). **Effort.** M (P1) + L (P2) + M (P5), spread across phases.
**Acceptance.** Every new org-scoped table has 3 registrations green in the ADR's PR; equivalence guard
green at P1 and P3; backfill provably idempotent; frozen-contract CI green.

### 5.G · Documentation

**Standing rule:** docs update in the **same PR** as the behavior change (review-blocker, not a wave-end
pass). Per phase: an ADR for each new table/frozen change; the Spec V4 edits in §6 below; a one-bullet
CLAUDE.md wave-status banner update (migration/ADR numbers, PR range, one-line "what shipped"); a
non-author adversarial fact-check of every rendered claim (coaching-card label, profile band copy, mission
copy, coverage copy, any privacy prose). `docs/connector-facts.md` is **untouched until P8** (P1–P4 add zero
signals — a premature edit is scope creep + a needless frozen-path trip). `/legal/what-we-collect` and
privacy prose change **only at P7** (new collection category) — the highest-stakes fact-check in the program
(the W3-N "KMS" class of error). Keep Spec V4 the single source of truth; the gap analysis + this plan get a
one-line status update per completed phase. **Effort.** S–M per phase. **Acceptance.** ADR + Spec edit +
banner in each schema PR; every "we don't log/collect X" sentence still true or edited in the same PR that
made it false.

### 5.H · Technical Debt

- **Dual-source double-count (P0, S).** `rowsForSubjects` (`src/scoring/recompute.ts:119-141`) sums linked
  subjects with no dedup — a person linked via both an admin-API connector and the local agent
  double-counts every `sum` component (tokens, spend). Dedup by resolved person before summing (in the same
  batched query — no N+1); regression test with a two-source/one-person/one-metric fixture. Billing
  (`tracked_user`, a distinct-count) is unaffected; **capability evidence is not** — this must land before
  P2. May shift historical dashboard totals for affected orgs (a bug fix, framed honestly).
- **Dead `segmentTeams` path (P0, S).** Delete `src/scoring/segment.ts` `segmentTeams` + its test; port
  `scripts/calibrate-scores.ts` (its one live consumer) to the surviving `src/lib/segments.ts`, or retire
  it with founder sign-off — **same PR** (W5-A(4) precedent). `git grep segmentTeams` returns nothing.
- **Inert catalog metadata (resolved at P3, not deleted).** `benefit`/`difficulty`/`confidence`/
  `applicable_roles`/`applicable_tools` are stored, tested, and ignored — a CONFLICTING state resolved by
  *consuming* them in the ranker (WS AI Coaching P3), never by deletion.
- **Latent test drift (P1, S).** `recommendation-catalog.test.ts:38` hardcodes `ROLE_SLUGS` as a literal
  set instead of reading `roles` — replace with a DB read so it and the capability seed test share one
  source of truth (found by the QA lens).
- **Self-view predicate registry (P2, S).** Add `user_capability_state` and `mission_progress` to the
  `assertTeamOnlyPseudonymized` registry the moment those tables exist, or the tripwire passes vacuously
  (the CLAUDE.md gate-check lesson).

---

## 6. Spec V4 update summary

All edits target `docs/Revealyst_Product_Spec_V4.md`, applied in the **same PR** as the phase that earns
them (this plan's PR applies the P1-scoped edits now; later edits ship with their phase). The precise
section-by-section table is authored below; the plan's PR lands the **program-registration** edits (the
ones that describe *what is being added*, not future behavior).

| Spec V4 §  | Edit | Applied |
|---|---|---|
| top banner / §1 | Add a "V4 Wave 7–8 · AI Capability Layer" line pointing at this plan | this PR |
| §6.4 New entities | Add capability-graph tables + `user_capability_state` (+ missions tables) in the existing one-line format | this PR |
| §7.1 | Note the marker/proficiency breakdown is *backed by* the capability catalog + `user_capability_state`; state the decomposition (L5) | this PR |
| §7.3 | **No new insight kind** for P1–P3 (labels ride existing `recommendation` kind); a `mission` kind only if P5 needs feed-ordering — flagged speculative | (deferred) |
| §8.2 | Add `target_capabilities` to the catalog-row list; add a capability-catalog subsection (relational, not graph-DB); add the utility-ranker paragraph (formula, "no LLM/ML") | this PR |
| §8.4 | Reword the proficiency-breakdown row to cite `user_capability_state`; **add the missing Missions row**; reaffirm the two-scales/no-third-ladder law | this PR |
| §9 heading | Disambiguation footnote: §9 "Capabilities" = population scope; the skill/capability catalog is §8.2/§8.4 | this PR |
| §9.2 | Capability-coverage rollups governed by `assertTeamOnlyPseudonymized` + count-only + `MIN_PEOPLE` | this PR |
| §11.3 V1 | Add rows: "Capability catalog — L" and "Per-person capability state (`user_capability_state`) — L, `directional` until OTel" | this PR |
| §11.4 Future | Add "Missions" and "Exposure logging + experimentation" rows, each with its **distinct** named gate (not merged with Outcomes) | this PR |
| §11.5 NOT-list | Reaffirm + append explicit call-outs: no graph DB, no ML service, no fixed persona labels, no XP/streaks/leagues, no LMS (map onto existing bullets) | this PR |
| §12.1 | One clause: capability profile, missions, coverage rollups fold into the existing three surfaces — not new pages | this PR |
| §13 Privacy | Exposure-logging exception paragraph — **only when P7 ships** | (deferred to P7) |
| §15.2 / §15.4 | Add the new tables to the three-registration law list + frozen-contracts list | this PR |
| §16 Open Questions | Add (8) third-ladder confirmation; (9) exposure-logging reversal ADR — as founder sign-off items | this PR |

---

## 7. Founder sign-off items & unresolved decisions

Decidable now from evidence (recorded in this plan): relational over graph DB; parallel mastery engine
(not extending frozen contracts); migration-based authoring; deterministic ranking before ML; capability
MVP needs no new signals.

Requiring founder/product input (each gates a phase, not the roadmap):
1. **Capability seed content** — the ~30–40 capability list, prerequisite DAG, and signal bindings (gates
   P1 finalization; do not have an agent invent it unreviewed).
2. **Third-ladder line** — confirm the capability profile is a *decomposition of the one person band*, not
   a competing scale (gates P2 UI). → Spec V4 §16 item 8.
3. **Missions inside anti-gamification** — confirm the mission UI stays inside Spec V4 §8.4 (no XP/streaks/
   leagues) (gates P5 build).
4. **Persona treatment** — aggregate cohort lens only, never a per-person label (gates P6 copy).
5. **Exposure-logging reversal** — a founder-signed ADR reversing "don't log rec-shown-to-X" before P7 (gates
   P7 entirely). → Spec V4 §16 item 9.

External/technical uncertainties: OTel receiver + schema stability (P8); Cursor Analytics API / Copilot PR
block widening (P8); role-telemetry source for non-eng roles (P8); vendor field drift (standing).

---

## 8. Risk register

| Risk | Phase | Why serious | Mitigation |
|---|---|---|---|
| Per-person capability sums wrong | P2 | Dual-source double-count is a **live** defect; mastery on doubled evidence is fabricated (invariant b) | Fix dedup in P0; block P2 on it |
| "Incremental" reducer degrades to full recompute | P2 | Re-introduces the nightly per-RTT floor; invisible at fixture scale | Watermark-bounded delta; query-count-independent-of-history test (mandatory) |
| Capability profile reads as a grade | P2/A3 | Violates "discovery, never deficiency" + the two-scales law | Positive-first ordering, band-not-number, third-ladder sign-off, capped rows |
| Ranker mis-tuned without feedback data | P3 | No experimentation framework yet to validate weights | Permanent equivalence guard; founder dogfood a week before Team rollout; version the weights in the fixture |
| Team rollup leaks per-person mastery | P6 | Highest-leverage privacy regression | `assertTeamOnlyPseudonymized` + `MIN_PEOPLE`; prop type carries no person id; `MIN_PEOPLE−1` suppression test |
| Missions drift into gamification | P5 | Natural UX pull; contradicts Spec V4 §8.4 | Banned-phrasing test; schema has no `xp`/`streak` column; §8.4 as a `/code-review` blocker |
| Exposure logging overclaims privacy | P7 | A "we don't log X" mismatch is invariant-b in the worst place | New ADR names what it overrides; impersonation caveat; adversarial non-author fact-check of every "we don't collect" sentence |
| Parallel-schema merge collisions | P0–P2 | 5 files appended by 3 phases | Serialize builds; rebase+renumber migrations/ADRs before each PR (L9) |
| CI red masked at merge | all | The #140/#143 incident | Capture `gh pr checks`, grep, merge only if clean (never pipe) |

---

## 9. Wave-by-wave integration validation (the four partial-integration traps, closed)

**P0** correctness only. **P1** graph + linkage (recs labeled; no orphan capability). **P2** state + its one
card (no state without a surface, no surface without state). **P3** ranker reads what P1 stored (no inert
metadata left). **P4** one coherent self-view loop; digest & dashboard share source. **P5** missions complete
end-to-end from measured signals. **P6** aggregate rollups behind the privacy floor. **P7** measurement only
when volume justifies it (no hollow tables). **P8** measured markers + role packs only when their gating
evidence exists. At no point is there a capability graph with no state, a state store with no surface, a
ranker reading fields nothing populates, or an outcome table with nothing to measure.
