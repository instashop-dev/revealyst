# Revealyst AI Capability Implementation Gap Analysis

> Audit date: 2026-07-14 · Auditor: staff-engineer / product-architect review of the
> `AI-capability-deep-research-report` against the Revealyst codebase at `main` (e7be5b0).
> Sources of truth, in precedence order: (1) working code/schema/migrations/tests;
> (2) product docs — Spec V4 (`docs/Revealyst_Product_Spec_V4.md`), V4 Execution Plan
> (`docs/Revealyst_Execution_Plan_V4.md`), AI-Intelligence Plan
> (`docs/ai-intelligence-implementation-plan.md`); (3) the research report as target direction.
> Where code and docs disagree, the conflict is named rather than resolved by assumption.

---

## 1. Executive conclusion

**How much of the required foundation already exists: roughly 60–65%, and it is the hard 60%.**
The research report proposes a "metadata-first capability, recommendation and coaching engine."
Revealyst has *already built* the expensive substrate that proposal assumes: an org-scoped
multi-tenant data layer where cross-org access is unrepresentable, a durable per-person identity
model (`people` + `subjects` + `identities`), four vendor connectors with pure `normalize`
functions and explicit honesty gaps, a canonical-metric fact table, a **catalog-as-data /
evaluator-as-code** recommendation engine that is almost exactly the architecture the report
recommends, per-person score computation, recommendation interaction state (snooze/dismiss/tried),
and a privacy posture (self-view-only enforced *in code*, count-only cohorts, a `MIN_PEOPLE` naming
floor, content-free ingestion, audited admin actions, account-deletion purge tripwires) that is a
product differentiator, not a bolt-on. The report's own "narrow compounding wedge — Claude Code +
Cursor, a small catalog, one personal home, one digest, one manager rollup, a closed loop" is a
description of what Revealyst shipped in V4 Wave 5/6.

**Largest reusable assets.** (1) The metric-ingestion + identity-resolution pipeline
(`src/poller/run.ts`, `src/lib/agent-ingest.ts`, `subjects→identities→people`) — the per-person
evidence stream any capability model needs. (2) The recommendation catalog
(`recommendation_catalog`, `src/lib/recommendation-catalog.ts`) — a seeded, versioned,
closed-comparator engine that *already carries* `applicable_roles`, `applicable_tools`,
`related_workflows`, `benefit/difficulty/confidence`, `insight_kind` fields. (3) The honesty
primitives (`lowestAttribution`, ratio-omission, null-on-absence in `src/scoring/evaluate.ts`) that
keep the whole system from fabricating per-user numbers. (4) The `forOrg` tenancy contract +
composite-tenant-FK + "three registrations" law, which lets new capability tables inherit isolation
for free.

**Largest architectural gaps (net-new build).** (a) **No capability graph** — zero
domains/capabilities/dependencies/workflows/playbooks/learning-paths/missions entities; today a
"capability" is one of three score slugs (`adoption`, `fluency`, `efficiency`) and its components.
(b) **No durable per-capability mastery state** — scoring is a *stateless full-period snapshot*
recomputed nightly; there is no accumulating per-capability state, no confidence-from-evidence, no
decay. (c) **No exposure logging, no experimentation, no holdouts** — lift is unmeasurable, and the
naive fix collides with a *deliberate* privacy choice (Revealyst refuses to log "rec shown to person
X"). (d) **No mission/progression construct.** (e) Recommendation *ranking* is a fixed presentational
`impact` constant; the catalog's rich targeting/scoring metadata is loaded but **inert**.

**Most dangerous conflicts (report vs. product intent).** The report's **fixed AI-persona labels**
("you are an Explorer/Optimizer") directly contradict Spec V4's explicit *Kill: showing an individual
a fixed personality label* (`Spec_V4.md:316`); its **gamification** (XP, streaks, leagues) contradicts
the recorded **no-streak / no-XP** decision (`Spec_V4.md:372`, `src/lib/milestones.ts:28-34`) and some
mechanics are structurally impossible under self-view-only privacy; its **full per-capability mastery
graph** risks the "third ladder" Spec V4 forbids (org matures / person progresses are the *only* two
scales); its **ML stack** (GBM ranker, contextual bandits, BKT/DKT) hits the standing *no separate ML
service* tripwire and is premature at solo scale. And measured mastery is **gated on the OTel receiver**
(W6-D, founder-gated) — the richest evidence markers don't exist yet.

**Recommended approach: evolve, don't rewrite — a thin capability layer over the shipped substrate.**
Reframe the three scores + maturity axes + their components as the v0 capability substrate; add a
*relational* (not graph-DB) capability catalog that names capabilities, groups existing
metric/score components under them, and declares prerequisites; add a *parallel* per-person
`capability_state` table (following the maturity-v1→future-table precedent and the
`rec_interaction_state` composite-FK pattern) that **reuses the honesty primitives verbatim** and
never mutates frozen score contracts; make the recommendation engine *consume its own inert catalog
metadata* (link recs→capabilities, add real utility scoring); and defer mastery-from-OTel, missions,
and experimentation to the points where their gating evidence exists (OTel live; "tried" volume real;
outcome signal earned). Every wave must land whole — no half-wired capability graph with no state, no
state with no surface.

---

## 2. Current-state architecture

A Next.js/TypeScript monolith on Cloudflare Workers → Hyperdrive → Neon Postgres, Drizzle
migrations, cron→queue polling. Single database, `org_id` on every application row; **Personal mode =
an org of one** (`ensureOrgOfOne`, `src/db/org-scope.ts:70-144`).

**Tenancy & identity.** `forOrg(db, orgId)` (`src/db/org-scope.ts:161-186`) is the *only* application
query surface, enforced by `scripts/check-org-scope.mjs` + `tests/tenant-isolation.test.ts`. Child
tables reference parents by composite `(org_id, parent_id)` FKs, so a cross-org row is unrepresentable
at the DB level, not merely filtered. `people` (`src/db/schema.ts:107-142`) is the durable per-person
entity (pseudonym, opt-in `display_name`, `email`, optional `auth_user_id`); tracked people are a
distinct population from `user` (dashboard logins). Resolution chain: `subjects` (vendor actors,
`:336`) → `identities` (many-to-many, `:376`) → `people`. `tracked_user`
(`src/contracts/tracked-user.ts`) is a *derived billing set*, not a stored entity.

**Ingestion & signals.** Four connectors registered (`src/connectors/index.ts:10-13`):
`anthropic_console`, `openai`, `cursor`, `github_copilot` (last founder-gated off the live surface via
`NLV_PENDING_VENDORS`, `src/lib/vendor-connect-meta.ts:91`). `claude_code_local` ingests via a
device-token agent path (`src/lib/agent-ingest.ts`), content-free by construction
(`src/lib/agent-collection-schema.ts`). Each connector exposes a pure `normalize`
(`src/contracts/connector.ts:87-98`) emitting `{records, signals, gaps}` into ~28 `CANONICAL_METRICS`
(`src/contracts/metrics.ts:46-81`). The poller (`src/poller/run.ts`) lands raw payloads, resolves
subjects, then does a transactional **delete-then-upsert restatement** into `metric_records`
(`src/db/schema.ts:480-529`, PK `(org_id, subject_id, metric_key, day, dim)`). Sub-daily histograms
land in `subject_day_signals` (`:535`).

**Scoring & maturity (two separate engines).** `src/scoring/evaluate.ts` computes a `ScoreDefinition`
(`src/contracts/scores.ts`) — a weighted sum of normalized components over a closed aggregation
vocabulary (`sum | avg_per_day | active_days | distinct_dims`) — into `score_results`
(`:601`). Three seeded scores exist: **adoption** (active_days + tool_coverage), **fluency** (breadth +
depth + effectiveness) and **efficiency** (output_per_spend + engagement_per_spend), seeded team-level
and *cloned to person-level for personal orgs* (ADR 0014, `src/db/org-scope.ts:101-136`). Recompute is
a **full-period nightly snapshot**, not incremental (`src/scoring/recompute.ts:205-328`, cron
`0 2 * * *`). A *second, separate* pure engine, the **AI Maturity Model** (`src/lib/maturity.ts`),
computes three org-level axes (Breadth/Depth/Consistency) → a modeled 5-rung level (L0 Dormant → L4
Amplified) at request time, no table. It already carries a `ConfidenceTier` vocabulary
(`measured|modeled|directional|not_measured`) and staleness withholding.

**Recommendation ("coaching") engine.** `recommendation_catalog` (`src/db/schema.ts:1286-1407`, mig
0029, ADR 0033) is seeded reference data (7 global rows, copied verbatim from the retired static map);
`deriveAttention` (`src/lib/score-insights.ts:575-842`) reads it via **one per-org batched read**
(`src/db/org-scope/catalog.ts`) and evaluates in-memory per person: for each (score, component) pair
it looks up a catalog row keyed `scoreSlug::componentKey`, gates on the row's `required_signals`
(closed comparators: `measured` · `normalized-below 40` · `min-weight 0.2`,
`src/lib/recommendation-catalog.ts:138-159`), dedupes by `signal_group`, and caps at
`MAX_RECOMMENDATIONS = 2`. Per-person interaction state (`rec_interaction_state`, `:1035`, mig 0024,
ADR 0028) records snooze/dismiss/tried, self-view-only.

**Surfaces (IA).** One app shell (`src/app/(app)/layout.tsx`) with a paywalled sidebar
(`src/components/app-sidebar.tsx`). `/dashboard` branches on `org.kind`: **Personal Companion**
(`PersonalSelfView` — Growth Journey card + coaching card + daily-nudge + milestone card + raw scores
demoted behind a "diagnostic details" expander) vs **Team Intelligence** (`TeamOverview` — 5
consolidated sections, count-only segments, board CSV export). Other routes: `/maturity`,
`/methodology`, `/connections`, `/account`, `/members`, `/reconcile`, `/spend`, `/billing`,
`/compliance`, `/settings`, plus retired-from-nav `/teams`, `/people`, `/indexes`, `/playbook`, and
platform-admin `/admin/*`. Exec report is an on-demand HTML export + monthly email (`/api/exec-report`).

**Notifications.** Email-only over SES (`src/lib/email.ts`); no Slack, no in-app notification center,
no push. Lanes: weekly digest, budget-threshold alert, renewal reminder, monthly exec memo, flywheel.
On/off toggles only — no frequency controls.

**Privacy & audit.** Visibility is an org-wide mode (`private|managed|full`, `src/lib/visibility.ts`),
`private` default. `assertTeamOnlyPseudonymized` + a completeness-tripwire surface registry
(`visibility.ts:88-178`) block per-person identity leaks in team views. Segments are **count-only in
every mode**; `SEGMENT_MIN_PEOPLE_TO_NAME = 4` (`src/lib/segments.ts:58`). `rec_interaction_state` is
self-view-only by three independent layers (`authUserId`-scoped read, ownership check on write, no read
route at all — `src/app/api/recommendations/interaction/route.ts:42-44`) and is *deliberately not
audited* to avoid a manager-visible leak. Admin actions are audited (`auditLog`, `:896`);
impersonation is audited, admin-on-admin-blocked, 1h-capped, `cookieCache` off.

**Telemetry.** `src/lib/launch-events.ts` writes anonymous coarse counters to a Cloudflare Analytics
Engine dataset (`landing_view | share_card_view | digest_return | companion_revisit | …`), with a
hard rule: no ids, no user agents. There is **no per-user product-analytics event stream**.

---

## 3. Target-state architecture (Revealyst-adapted, not the report verbatim)

The report's six-layer ontology (Domain → Capability → Workflow → Playbook → Learning Path → Mission)
is sound *as a taxonomy* but over-scoped for a solo founder and partly in tension with product intent.
The minimum target that fits Revealyst:

1. **A relational capability catalog** (not a graph DB). `domains` (≈ the report's Domain; Engineering
   only at launch) → `capabilities` (outcome-named durable abilities, e.g. "Debug faster with AI",
   "Cost-efficient AI usage") → `capability_dependencies` (prerequisite edges) →
   `capability_signals` (the join that maps existing `metric_catalog` keys / `score_definitions`
   components to a capability — the reuse hinge). Workflows/playbooks/learning-paths start as
   **content fields on capabilities and catalog rows** (they already exist as free-text
   `related_workflows[]`/`learning_resources[]`), promoted to their own tables only when authoring
   volume demands it. Relational storage is sufficient: the graph is small (≈30–40 nodes, shallow
   prerequisite edges), traversal is a bounded in-memory walk over one per-org read — the same perf law
   the catalog already obeys. **A graph database is not justified.**

2. **A parallel per-person capability-state store** (`user_capability_state`): per (org, person,
   capability) a `mastery` ∈ [0,1] (or a band), a `confidence` derived from evidence quality +
   measurement coverage (reusing `signal-coverage`), a `last_evidence_at` + `staleness`, an
   `evidence_count`, and a `next_capability` hint. Computed from the *existing* per-person score
   components + maturity axes as priors, plus (later) OTel markers. This is the report's "capability
   state" and Spec V4's **proficiency band + marker breakdown** (W6-E) unified into one model — capped
   at `directional` until OTel (W6-D) lands, then `measured` (Spec V4's two-tier honesty law).

3. **A recommendation engine that consumes what the catalog already stores.** Keep the
   catalog-as-data/evaluator-as-code split (it is exactly right). Add: rec→capability linkage
   (`target_capabilities`), prerequisite gating (skip a rec whose capability's prerequisites are unmet),
   a **deterministic multi-factor utility score** that finally reads the inert `benefit`, `difficulty`,
   `confidence`, `applicable_roles`, `applicable_tools` fields, and real fatigue/frequency controls.
   **No ML** until feedback volume is real (the report agrees; defer bandits/GBM/BKT).

4. **A mission/progression construct** — the report's most novel add — as a *thin* bundle over
   recommendations (`missions` + `mission_steps`, each step a catalog rec or a measured signal
   crossing), with start/progress/complete state per person. This is the "specific goal + if-then plan"
   behavior-change lever, and the honest evolution of today's milestone-until-superseded surface.

5. **A closed measurement loop.** A self-view-scoped `recommendation_exposure` + `capability_event`
   append log (shown/opened/accepted/mission-started/completed/state-changed), plus holdout
   assignment — but built under a new ADR that resolves the tension with the current "don't log rec
   shown to X" privacy stance (store self-view-only, purge-registered, never manager-readable).

6. **Metadata-first privacy preserved.** Every new surface stays inside the existing enforcement
   points (self-view predicate, count-only cohorts, `MIN_PEOPLE`, content-free ingestion). Manager/exec
   value is a *rollup* of aggregate capability coverage, never per-person mastery.

What the target explicitly **drops** from the report: fixed per-person persona labels; XP/streaks/
leagues; a graph database; any ML service; an LMS/course/certification layer; per-capability
mastery presented as a public/manager-visible score.

---

## 4. Gap matrix

Status legend: **EXISTS** (reusable), **PARTIAL** (extend/refactor), **MISSING** (net-new),
**CONFLICTING** (current code works against the target), **OBSOLETE** (retire), **UNKNOWN**.

| Area | Target requirement | Current state | Status | Required change | Primary files/modules | Priority |
|---|---|---|---|---|---|---|
| Product model | Individual-first personal coaching home | Personal Companion shipped (Growth Journey + coaching + nudge cards; raw scores demoted) | **EXISTS** | Reframe "level" source from org-maturity to person capability band (W6-E) | `src/app/(app)/dashboard/page.tsx:259-741`, `src/components/companion/*` | P1 |
| Product model | Every employee gets personal value, incl. in Team orgs | Team-org members get `TeamOverview`, not the Companion (branch `dashboard/page.tsx:248`) | **CONFLICTING** | Companion behind completeness-enforced predicate in Team orgs (W6-A, gated on dogfood) | `dashboard/page.tsx:248`, `src/lib/visibility.ts` | P1 |
| Data model | Domains | none | **MISSING** | New `domains` reference table (Engineering seed) | `src/db/schema.ts` | P1 |
| Data model | Capabilities (outcome-named) | proxied by 3 score slugs + components | **PARTIAL** | New `capabilities` table; map to existing components via a join | `src/db/schema.ts`, `src/contracts/scores.ts`, `metric_catalog` | P1 |
| Data model | Capability dependencies / prerequisites | none | **MISSING** | New `capability_dependencies` edge table | `src/db/schema.ts` | P2 |
| Data model | Workflows / playbooks / learning paths | free-text arrays + one static `/playbook` page | **PARTIAL** | Keep as content fields on capabilities/catalog; promote to tables only if authoring demands | `recommendation_catalog.related_workflows`, `learning_resources`, `src/app/(app)/playbook/page.tsx` | P3 |
| Data model | Missions + mission steps | none (only milestones) | **MISSING** | New `missions` + `mission_steps` + `mission_progress` tables | `src/db/schema.ts`, `src/lib/milestones.ts` | P4 |
| Data model | Capability evidence | implicit in `metric_records`, unlinked | **PARTIAL** | Evidence resolves at compute time from metric rows; persist only the *state*, not every event (perf) | `src/scoring/recompute.ts`, `metric_records` | P2 |
| Data model | User capability state (mastery/confidence/staleness) | person-level scores exist but stateless snapshot; no per-capability state | **PARTIAL** | New `user_capability_state` table; parallel to `score_results`, reuse honesty primitives | `src/db/schema.ts:601`, `src/lib/maturity.ts` | P2 |
| Data model | AI personas | `segmentFor` cohort label exists (aggregate lens) | **CONFLICTING** | Persona as *aggregate cohort lens only*; never a fixed individual label (Spec V4 kills it) | `src/lib/segments.ts`, `src/scoring/segment.ts` (dead) | P3 |
| Data model | Recommendation → capability link | catalog keyed `scoreSlug::componentKey`, no capability FK | **PARTIAL** | Add `target_capabilities` to catalog; keep component key as the signal binding | `src/db/schema.ts:1286`, `src/lib/recommendation-catalog.ts` | P1 |
| Data model | Recommendation prerequisites | `applicable_roles/tools` exist but inert; no prereq | **CONFLICTING** | Consume the inert fields; add capability-prerequisite gate | `src/lib/score-insights.ts:783-834` | P2 |
| Data model | Recommendation exposures | none (only post-action state) | **MISSING** | New self-view-scoped `recommendation_exposure` log (ADR resolves privacy tension) | `src/db/schema.ts`, `route.ts` | P5 |
| Data model | Feedback/completion/outcome events | `tried` state only (forerunner) | **PARTIAL** | Promote to append `capability_event` log when "tried" volume is real (Future ledger) | `rec_interaction_state`, `src/db/schema.ts:61` | P5 |
| Data model | Visibility/lifecycle policy | org-wide `VisibilityMode` + catalog `status` | **EXISTS** | Reuse as-is; no per-capability policy needed for MVP | `src/lib/visibility.ts`, `recommendation_catalog.status` | — |
| Signals | Claude/Cursor/Copilot/OpenAI ingestion | 4 connectors live (Copilot gated) | **EXISTS** | No change to normalize contracts (frozen; retain every deliberate drop) | `src/connectors/*` | — |
| Signals | Skills / MCP / subagent / rules evidence | available-unused (local + Cursor Analytics API) | **PARTIAL** | New markers require connector-widening (Cursor Analytics API) or OTel | `src/connectors/cursor/*`, `docs/connector-facts.md` | P4 |
| Signals | Verification / active-time / work-per-prompt (proficiency markers) | absent (needs OTel) | **MISSING** | OTel receiver (W6-D) + marker normalization (F3.2) | `src/worker.ts`, new receiver | P3 (gated) |
| Capability engine | Confidence from evidence quality | `ConfidenceTier` labels method, not evidence; `signal-coverage` counts sources | **PARTIAL** | Compose confidence from coverage + sample size + historical success | `src/lib/signal-coverage.ts`, `src/lib/maturity.ts:516` | P2 |
| Capability engine | Staleness / decay | modeled in maturity report, *not* on scores | **PARTIAL** | Add decay to capability_state (scores never decay today) | `src/lib/maturity.ts:544`, new engine | P2 |
| Capability engine | Incremental recalculation | full-period nightly recompute only | **CONFLICTING** | New engine recomputes state incrementally from the daily batch | `src/scoring/recompute.ts:205` | P2 |
| Rec engine | Eligibility filtering | closed-comparator gate (measured·weak·weighted) | **EXISTS** | Reuse; extend with prereq + role/tool filters | `src/lib/score-insights.ts:805` | P1 |
| Rec engine | Deterministic utility scoring | fixed `impact:1`, weakest-first, cap 2 | **PARTIAL** | Real multi-factor utility formula reading catalog metadata | `src/lib/score-insights.ts:816-834` | P1 |
| Rec engine | Fatigue / frequency controls | cap 2 + snooze/dismiss suppression | **PARTIAL** | Add time-decay, rotation, cross-session cap | `src/lib/rec-interactions.ts`, `score-insights.ts:474` | P2 |
| Rec engine | Sequencing / bundles / missions | none | **MISSING** | Missions (P4) provide sequencing; ordered next-step chains | `src/lib/milestones.ts` | P4 |
| Rec engine | Feedback learning | none | **MISSING** | Outcome loop when volume real (Future ledger) | `rec_interaction_state` | P5 |
| Coaching UX | Next-best-action feed | single "next step" + attention alert list | **PARTIAL** | Prioritized action feed keyed to capability gaps | `dashboard/page.tsx:133-185,620` | P2 |
| Coaching UX | Mission start/progress/complete | none | **MISSING** | Mission UI + state | new components | P4 |
| Coaching UX | Weekly reflection | none (digest email only) | **MISSING** | Optional weekly reflection card (later engagement mechanic) | `src/lib/digest-content.ts` | P5 |
| Coaching UX | Admin catalog management UI | none (seed-only, read-only `list()`) | **MISSING** | Author-via-migration for MVP; CRUD UI later | `src/db/org-scope/catalog.ts` | P4 |
| Privacy | Individual coaching private-by-default | enforced in code (3 layers) | **EXISTS** | Reuse; extend predicate to capability_state (W5-A registry) | `route.ts:42`, `visibility.ts:168` | P1 |
| Privacy | Team aggregates + min cohort | count-only + `MIN_PEOPLE=4` | **EXISTS** | Reuse for capability-coverage rollups | `src/lib/segments.ts:58` | — |
| Privacy | Content inspection off/separate | content-free by construction | **EXISTS** | No change | `src/lib/agent-collection-schema.ts` | — |
| Experimentation | Exposure logs / holdouts / A-B | none | **MISSING** | New framework (ADR for privacy) when a ranking change needs proof | new module | P5 |
| Measurement | Capability-lift / retention dashboards | anonymous counters only | **PARTIAL** | Extend telemetry to self-view-scoped capability events | `src/lib/launch-events.ts` | P5 |
| Correctness | Trustworthy per-person sums | dual-source double-count is a **live defect** | **CONFLICTING** | Fix `rowsForSubjects` dedup (W6-A) before per-capability aggregation is trusted | `src/scoring/recompute.ts:119-141` | P1 |

---

## 5. Data-model changes

**Design law inherited from the codebase.** Every new org-scoped table needs *three* registrations
or CI reds main: `tests/tenant-isolation.test.ts` `SCOPED_READS` (with a non-vacuous B-org seed),
a `docs/decisions/NNNN-*.md` ADR (frozen-path CI guard), and `src/db/account-deletion.ts`
(`PURGE_TABLES` or `PURGE_EXEMPT_TABLES`; person-scoped tables ordered *before* `people`). New tables
slot in as new `src/db/org-scope/*.ts` namespaces. Migration and ADR numbers are independent sequences
(migrations at 0029, ADRs at 0034). Reference tables with no `org_id` (like `roles`, `metric_catalog`)
skip the three registrations.

### Reuse without change
`people`, `subjects`, `identities`, `metric_records`, `metric_catalog`, `score_definitions`,
`score_results`, `subject_day_signals`, `roles`, `role_assignments`, `rec_interaction_state`,
`orgs`/`teams`/`team_members`, `audit_log`. These are the anchors and the evidence substrate.

### Modify (additive columns only; each is an ADR because these are frozen contracts)
- `recommendation_catalog` (`src/db/schema.ts:1286`): add `target_capabilities text[]` (FK-by-value to
  `capabilities.slug`, validated in the seed-contract test like `applicable_roles`). **No new
  abstraction needed** — the row already carries `applicable_roles`, `applicable_tools`, `benefit`,
  `difficulty`, `confidence`, `learning_resources`, `related_workflows`, `insight_kind`,
  `suggested_action_type`. The gap is that `deriveAttention` never *reads* them; the fix is code, not
  schema, plus this one linking column.
- `connections` already has `renewal_date`; no change. `score_definitions.components` stays frozen — do
  **not** add confidence/staleness there (it would break `contracts-v1` and determinism tests); those
  live in the new state table.

### New tables (relational; no graph DB)
| Table | Key | Purpose | Reuse precedent |
|---|---|---|---|
| `domains` | `slug` PK (global reference) | Top-level area (Engineering seed) | mirrors `roles`/`metric_catalog` (no org_id) |
| `capabilities` | `slug` PK; `domain_slug` FK; `version` | Outcome-named ability; carries content (workflow/playbook/learning-path prose) | mirrors `score_definitions` versioning |
| `capability_signals` | `(capability_slug, metric_key or component_key)` | The reuse hinge: binds a capability to existing metric/score components | new join; reads `metric_catalog`/`score_definitions` |
| `capability_dependencies` | `(capability_slug, requires_slug)` | Prerequisite edges (shallow DAG) | new edge table |
| `user_capability_state` | `(org_id, person_id, capability_slug)` PK; composite tenant FK → `people` ON DELETE CASCADE | mastery, confidence, staleness, evidence_count, last_evidence_at, next_capability | **exact** `rec_interaction_state`/`role_assignments` pattern; three registrations; ordered before `people` in purge |
| `missions` / `mission_steps` | global reference (seed) | Bundled challenge + ordered steps (each step = a catalog rec or a signal crossing) | mirrors catalog seeding |
| `mission_progress` | `(org_id, person_id, mission_slug)` PK; composite tenant FK | start/progress/complete per person, self-view-only | `rec_interaction_state` pattern |
| `recommendation_exposure` (deferred, P5) | append log, `(org_id, person_id, rec_id, shown_at)` | closed-loop measurement; **self-view-only** store (ADR resolves the current "don't log shown" stance) | new; purge-registered |

### Indexes & constraints
- `user_capability_state`: index `(org_id, person_id)` (self-view read) and `(org_id,
  capability_slug)` (aggregate coverage rollup). `NULLS NOT DISTINCT` unique on any versioned reference
  table, like `score_definitions_org_slug_version_uq`.
- `capability_dependencies`: CHECK to forbid self-edges; acyclicity enforced in the seed-contract test
  (a small DAG — cycle detection in TS, not SQL).
- `capability_signals`: FK `metric_key → metric_catalog.key` where a metric binding is used.

### Migration & backfill
- All new reference tables (`domains`, `capabilities`, `capability_signals`,
  `capability_dependencies`, `missions`, `mission_steps`) are **seeded in the migration**, exactly like
  `recommendation_catalog` (`drizzle/0029`) and `roles` (`drizzle/0026`) — the migration *is* the seed;
  no runtime seed script touches prod.
- `user_capability_state` needs a **backfill**: a one-time job computes initial state per person from
  the latest `score_results` (person-level) + maturity axes. Follow the `score-recompute` fan-out
  pattern (one queue message per org). Because state is recompute-derivable, the backfill is
  *idempotent and re-runnable* — safe to ship empty and populate on the next nightly pass.
- **Retention.** State tables are recompute-derivable and carry no independent history → cascade-delete
  with the org/person, no long retention. The (deferred) exposure log is the only append-only store; it
  needs a retention window (mirror `raw_payloads` ~90-day hot policy) to bound growth.

---

## 6. Provider signal matrix

"Claude" = `anthropic_console` (live key) **+** `claude_code_local` (agent-ingest). Copilot is
code-complete but founder-gated off the live connect surface. Cell = status **today**; grounded in
`src/connectors/*/normalize.ts` and `docs/connector-facts.md`.

| Signal | Claude | Cursor | Copilot | OpenAI | Currently in `metric_records`? | Required work | Supported capabilities/evidence |
|---|---|---|---|---|---|---|---|
| Active users (`active_day`) | Ingested | Ingested | Ingested | Ingested | **Yes** | none | Adoption breadth/consistency; activation |
| Sessions | Ingested (`num_sessions`, local sessionId) | Unavailable (no session concept) | Ingested (CLI only) | Available-unused (`num_sessions` fetched, unmapped) | Yes (Claude, Copilot-CLI) | map OpenAI code-interpreter sessions | Depth; cadence |
| Tokens | Ingested | Ingested (events) | Ingested (CLI only) | Ingested (no cache_write) | **Yes** | none | Spend efficiency; volume |
| Cost / spend | Ingested (authoritative + estimated) | Ingested (`chargedCents`) | Ingested (`ai_credits`; cents unused) | Ingested (org `costs`) | **Yes** | Copilot credits→cents | Cost-efficient AI usage capability |
| Model usage | model_tokens ✓; model_requests unavailable | Ingested (both) | model_requests ✓; model_tokens unavailable | Ingested (both) | Partial per vendor | none (accept vendor gaps) | Model-selection capability; routing |
| Tool usage (`feature_used`) | Ingested | Ingested | Ingested | Ingested | **Yes** | none | Feature breadth; capability discovery |
| Skill / workflow usage | Available-unused (local skills flag) | Available-unused (Analytics API `skills/commands/plans`) | Unavailable | Unavailable | No | connector-widening (Cursor Analytics API) or OTel | Workflow-mastery evidence |
| Agent / subagent | Ingested (agent_sessions/active; subagent via local) | Ingested (agent_requests/active) | Ingested (CLI agent) | Unavailable | **Yes** (3 of 4) | none | Agentic-delivery capability |
| Rules / persistent context | Unavailable (local sees `permissionMode`, unmapped) | Unavailable | Unavailable | Unavailable | No | OTel / local summarizer widening | "Use rules/repo context" workflow |
| MCP usage | Available-unused (local `mcp__*`) | Available-unused (Analytics API `mcp`) | Unavailable | Unavailable | No | connector/local widening | MCP-automation capability |
| Code-contribution proxies (`commits`/`lines_*`) | Ingested (commits + lines) | Ingested (lines; commits via Enterprise AI-Code API, unused) | Ingested (lines) | Unavailable | **Yes** (3 of 4) | none | Output-shipped evidence |
| PR / review | Ingested (`pull_requests`, claude_code) | Unavailable | Available-unused (aggregate PR block; `code_review` flag ingested) | Unavailable | Yes (Claude) | wire Copilot PR block | Code-review-mastery capability |
| Adoption / maturity proxy | engine-computed | Available-unused (`leaderboard`,`plans`) | Available-unused (`ai_adoption_phase`, deliberately skipped) | engine-computed | No (engine-derived) | none (keep engine-derived) | Persona/cohort lens |
| Verification / active-time / work-per-prompt | Unavailable (needs OTel) | Unavailable | Unavailable | Unavailable | No | **OTel receiver (W6-D) + F3.2** | Measured proficiency markers |

**Ingestion-layer changes required.** For the MVP capability layer, **none** — the existing 28 canonical
metrics already supply Adoption/Fluency/Efficiency/agentic/spend evidence. Higher-fidelity markers
(skills, MCP, subagents, verification, active-time) require either (a) widening the Cursor Analytics
API / Copilot PR block into `normalize` (client + normalize work, additive metrics — the frozen
`normalize` contracts *add* keys, they don't change), or (b) the OTel receiver for Claude Code
(the only source of true accept/reject and active-time). **Do not assume prompt-content access** — the
report and the code agree; all markers are metadata/event-structure only. Note two *deliberate drops
that must stay dropped*: Anthropic `claude_code model_breakdown.tokens.*` (double-counts the usage
report) and Copilot `totals_by_ide` ("IDEs are editors, not features") — both test-pinned.

---

## 7. Recommendation-engine changes

**Current logic (verified).** `deriveAttention` (`src/lib/score-insights.ts:783-834`): build
`Map<"scoreSlug::componentKey", rec>` from the per-org catalog; for each score component, look up a
rec, gate on `evaluateRequiredSignals` (`measured` · `normalized-below 40` · `min-weight 0.2`), require
a numeric `normalized`, push candidate; sort candidates by `normalized` ascending (weakest first);
dedupe by `signal_group`; slice to `MAX_RECOMMENDATIONS = 2`; emit with fixed `impact: 1` so
recommendations sort below every other attention item. Interaction state
(`src/lib/rec-interactions.ts`) suppresses dismissed and unexpired-snoozed recs upstream.

**What is already right (retain).** The catalog-as-data / evaluator-as-code split; the closed
comparator vocabulary (no DSL, no LLM — matches the report's stage-one eligibility filter and honors
tripwires); the one-per-org read + in-memory per-person eval (the perf floor); the central guidance
disclaimer; the signal-group dedupe; the self-view interaction state.

**What is missing vs. the report's three-stage ranker.**
- *Stage 1 (eligibility):* EXISTS but incomplete — it ignores the catalog's `applicable_roles`,
  `applicable_tools`, and has **no prerequisite check**. Extend: filter by the person's assigned role
  (`role_assignments`) and connected tools, and skip a rec whose target capability's prerequisites are
  unmet (`capability_dependencies` × `user_capability_state`).
- *Stage 2 (utility ranking):* the biggest rewrite. Replace the fixed `impact: 1` with a deterministic
  utility score that finally reads the inert metadata. Proposed **initial formula, fitted to available
  data** (all inputs already exist or are cheap to derive; no ML):

  ```
  utility = capabilityGap        (0.35)   // (100 − normalized)/100 for the weak component
          + benefitWeight        (0.20)   // catalog benefit high/med/low → 1.0/0.6/0.3
          + confidenceWeight     (0.15)   // catalog confidence high/med/low → 1.0/0.6/0.3
          + roleToolFit          (0.10)   // 1 if applicable_roles/tools match, else 0.5 (universal)
          + novelty              (0.10)   // 1 − (times this rec surfaced recently / cap)
          − difficultyPenalty    (0.05)   // difficulty high/med/low → 0.3/0.15/0
          − fatiguePenalty       (varies) // recent nudge count + recent dismissals for this signal group
  ```

  Deterministic, explainable, debuggable by one founder — exactly the report's "rules-and-features
  engine first." Keep the `MAX_RECOMMENDATIONS` cap and signal-group dedupe on top.
- *Stage 3 (exploration):* **defer.** Contextual bandits need exposure logs + propensities that don't
  exist and would collide with the privacy stance. The report agrees this is last.

**Confidence** (report §): today's catalog `confidence` is a *static* property of the advice, not a
per-person evidence confidence. Add a computed confidence for the *state/recommendation pairing* from
`signal-coverage` (source count) + component measurement completeness + (later) historical success —
surface it honestly ("based on 3 connected sources" not a fabricated percentage).

**Bundles/missions & feedback learning:** MISSING; delivered by the missions construct (§5, Wave 5)
and the Outcomes entity (Future ledger, gated on real "tried" volume — an always-empty outcome table
is an invariant-(b) trap and must not ship hollow).

**Exposure logging:** MISSING and *deliberately so* today (`route.ts:16-19` avoids a manager-visible
leak). Any exposure log is a new ADR that stores self-view-only, purge-registered, never
manager-readable.

**Removed/retired:** nothing in the rec engine is dead; but the **CONFLICTING** posture where the
catalog models seven metadata fields the evaluator ignores must be resolved by *consuming* them (Wave
3), not by deleting them.

---

## 8. Capability and mastery engine

**Graph structure.** Relational, small, shallow. `domains` (1: Engineering) → `capabilities` (≈30–40
outcome-named; seed set below) → `capability_signals` binding each capability to existing
`metric_catalog` keys / `score_definitions` components → `capability_dependencies` (a shallow DAG, e.g.
"Agentic delivery" requires "AI coding foundations"). Traversal for "eligible next capabilities" is a
bounded in-memory walk over one per-org read: mastered set = capabilities whose state ≥ threshold;
eligible = capabilities all of whose prerequisites are mastered and which are not yet mastered. No
graph DB — the node/edge count is tiny and every read is already batched.

**Seed capabilities (Engineering, v0), mapped to existing signals:**
| Capability | Bound to existing signals |
|---|---|
| AI coding foundations | `active_day`, `feature_used` breadth (adoption) |
| Debug faster with AI | `feature_used` (debug/agent), agentic |
| Code-review mastery | Copilot `code_review` flag, Claude `pull_requests` |
| Agentic delivery | `agent_sessions`, `agent_active`, `agent_requests` |
| Cost-efficient AI usage | `spend_cents`, `model_requests` mix, efficiency score |
| Effective prompting / verification | fluency `effectiveness` ratio; (OTel: accept/reject) |

**Evidence processing.** Reuse the ingestion + identity-resolution pipeline verbatim; **reuse the
honesty primitives verbatim** (`lowestAttribution`, ratio-omission, null-on-absence) or the mastery
model will fabricate the per-user numbers the whole codebase refuses. Evidence = the person's existing
`metric_records` rows for a capability's bound signals; the engine reads them, it does not persist a
per-event evidence stream (perf + retention).

**State calculation (v0, interpretable — the report's "weighted evidence model," not BKT yet).**
```
mastery(person, capability) = σ( w1·repeat_use + w2·breadth + w3·success_proxy
                                 + w4·agentic_depth − w5·long_gap )
confidence = 0.5·measurementCoverage(signal-coverage) + 0.3·evidenceCount + 0.2·historicalSuccess
staleness  = days since last bound-signal evidence; mastery withheld/decayed past a threshold
```
`success_proxy` is connector-dependent (accepted suggestions, PRs applied, repeated workflow reuse) —
reusing the same per-connector proxy logic the fluency `effectiveness` ratio already encodes. Every
state update is **explainable**: it carries which components moved and by how much, exactly as
`formatComponentDetail` + drop-driver attribution already do for scores. **Cap at `directional`** until
OTel markers land (W6-D), then upgrade the tier to `measured` (the two-tier honesty law; G2 requires ≥2
corroborating signals per marker). Defer BKT/DKT until event volume + interpretability tradeoffs
justify them (the report agrees; KT literature says interpretable-first).

**Update jobs.** The existing nightly `score-recompute` fan-out is a full-period snapshot
(`src/scoring/recompute.ts:205`). The mastery engine runs *in parallel* as its own reducer: after the
nightly per-org score recompute, a `capability-state` step reads the person-level scores + maturity
axes + bound metric rows and **incrementally** updates `user_capability_state` (apply decay, add new
evidence, recompute confidence). This is a new step in `src/poller/process.ts`, not a change to the
frozen score engine — the Maturity Model is the exact precedent for "a parallel pure lib over the same
org-scoped readers, deliberately not extending the score engine."

**Reuse / replace / parallel decision:** **Run in parallel.** Do not replace the score engine (it is a
stateless pure snapshot with a frozen contract and determinism tests) and do not bolt decay/confidence
onto it (breaks `contracts-v1`). Treat person-level scores + maturity axes as *priors/inputs*; persist
mastery to its own ADR-gated table from day one (the maturity-v1 comment already flags a history table
as the "future ADR" — the mastery model *is* that future).

---

## 9. Product and UX changes

**Individuals (Personal Companion — already the home).** The Growth Journey card
(`src/components/companion/growth-journey-card.tsx`) upgrades its "level" source from *org maturity* to
the *person capability band* (resolves the Spec V4 §1.2(6) placeholder; personal-org only until W6-E).
Add a **capability profile** surface: the person's capabilities with mastery band + confidence +
"eligible next" — a small map/list, not a dashboard. The coaching card
(`src/components/companion/coaching-card.tsx`) gains capability context ("this advances *Debug faster
with AI*") and the utility-ranked next step. Add **missions** as an opt-in card (start/progress/
complete). Keep the raw 0–100 demoted behind the diagnostic expander. Retain snooze/dismiss/tried;
consider adding "save," not "accept" (accept implies a write action the product doesn't do).

**Teams (Team Intelligence — already 5 sections).** Add **capability coverage** as an aggregate rollup
(share of team mastering each capability, count-only, `MIN_PEOPLE` floor) — this is the manager's
"coaching themes" surfaced honestly. Reuse `TrainingOpportunitiesCard`. **No per-person mastery ever
leaves self-view.** Personas remain an aggregate cohort lens (Spec V4), never a per-person label.

**Executives (monthly memo — already exists).** Add one line: capability-coverage trajectory
(aggregate lift), composed into `composeExecReport`. No new page.

**Admin.** Catalog + capability authoring is **migration-based for MVP** (like `recommendation_catalog`
today); a CRUD UI is a later nicety, not MVP.

**Pages: retain / simplify / merge / rename / remove.**
- *Retain:* `/dashboard` (Companion/Team), `/maturity`, `/connections`, `/settings`, `/reconcile`,
  `/spend`, `/billing`, `/account`, `/methodology`, `/admin/*`, exec-report export.
- *Simplify / reuse:* `/playbook` (static) → fold into capability content; `/methodology` gains a
  "capabilities" explainer.
- *Rename:* none required; "Growth Journey" already carries the capability framing.
- *Merge:* `/people` + `/teams` rosters into Settings (already planned, W5-H) — do not add capability
  admin pages; author via migration.
- *Remove/retire:* `/indexes` nav prominence (already demoted); the dead `src/scoring/segment.ts`
  `segmentTeams` path.

**Avoid a dashboard explosion.** The report's own warning applies: capability profile + missions are
*cards on the existing Companion*, not new top-level dashboards. One personal home, one team overview,
one exec memo — unchanged.

**MVP vs. later engagement mechanics.** MVP: capability catalog + capability profile card + rec engine
consuming its metadata + utility ranking. Later: missions, weekly reflection, capability coverage
rollup, notification-frequency controls. Explicitly *not* MVP and *not ever* in current form: XP,
streaks, leagues, fixed persona labels.

---

## 10. Privacy and security changes

**Already guaranteed (reuse).** Individual coaching private-by-default (self-view enforced in *code*,
three layers); managers cannot reach it (no read route exists, interactions un-audited by design); team
views count-only + `MIN_PEOPLE=4`; content inspection impossible by construction; admin actions
audited; account-deletion purge tripwires. This is the report's target privacy model, largely shipped.

**Required additions.**
- **Extend the self-view predicate registry (W5-A) to `user_capability_state` and `mission_progress`.**
  Per G3, self-view is enforced by a `visibilityMode`-parameterized read + an *audit predicate* that
  fails a test if a per-person capability field can leak into a team view. Register the new surfaces or
  they pass vacuously — the exact "completeness tripwire" pattern the visibility registry already uses.
- **Capability-coverage rollups must go through `assertTeamOnlyPseudonymized`** and the count-only /
  `MIN_PEOPLE` floor, identical to segments.
- **Exposure logging (deferred) needs its own ADR** precisely because it conflicts with today's
  deliberate choice *not* to log "rec shown to person X." Resolution: store exposures self-view-only,
  purge-registered, never manager- or admin-readable; the ADR must state that impersonation (the one
  audited bypass) can view them only as the user, audited.
- **Impersonation caveat to document:** platform staff can, via audited/ time-boxed impersonation, load
  a user's private capability surfaces. This is acceptable support behavior but must be named against
  any "no one but the user ever sees coaching" claim (invariant-b: prose is a claim surface).
- **Fix the dual-source double-count (W6-A) before per-capability aggregation is trusted.** Per-person
  `sum` components (tokens, spend) double-count a person linked via both an admin-API connector and the
  local agent (`src/scoring/recompute.ts:119-141`). Capability evidence that aggregates these inherits
  the defect. Billing (`tracked_user`) is unaffected; per-capability mastery would not be.

**Conflicts to resolve, not paper over:** (1) no experiment/exposure infra exists and building it
touches the privacy stance; (2) telemetry is anonymous-counter-only by hard rule — per-user capability
events need a *new, separately-scoped, self-view-only* store, not the existing sink; (3) there is no
"manager" role — team/self boundaries are ownership + org-wide `VisibilityMode`, so a manager-scoped
capability product would need a new authorization concept (defer; MVP is self-view + aggregate).

---

## 11. Testing and observability

- **Unit:** capability-state math against fixtures with known-truth mastery/confidence/staleness
  (mirror `tests/scoring-evaluate.test.ts` honesty cases); utility-ranking formula (weakest-first
  preserved, metadata weighting, fatigue); prerequisite traversal (eligible-next correctness);
  DAG-acyclicity of the seeded `capability_dependencies`; the ≥2-corroborating-signals rule for
  markers.
- **Integration:** end-to-end capability state from seeded `metric_records` through recompute to
  `user_capability_state` and the Companion card; digest + dashboard both drive the same
  `deriveAttention` capability path (shared source).
- **Migration:** seed-contract tests for `capabilities`/`domains`/`missions` (mirror
  `tests/recommendation-catalog.test.ts` — exact row counts, stable slugs, every `capability_signals`
  binding resolves to a live `metric_catalog` key / score component, `applicable_roles ⊆ ROLE_SLUGS`);
  a **migration-equivalence** test if any existing recs are re-keyed to capabilities (pin identical
  `deriveAttention` output, as ADR 0033 did).
- **Connector contract:** unchanged frozen `normalize` tests; if any signal is widened (Cursor
  Analytics API, Copilot PR block), add recorded-payload fixtures under `fixtures/connectors/*` and the
  deliberate-drop pins must stay green.
- **Authorization:** self-view-only tests for `user_capability_state` and `mission_progress` (read
  returns only the caller's rows; no read route for others; predicate registry completeness);
  `assertTeamOnlyPseudonymized` extended to capability rollups; account-deletion purge test covers the
  new tables (ordered before `people`).
- **Ranking:** offline Precision@k/NDCG@k harness *only once exposure logs exist*; until then, golden
  tests on the deterministic utility order.
- **Experimentation:** deferred; when built, holdout-assignment determinism + exposure-log
  completeness tests.
- **Observability/monitoring:** extend `Server-Timing` stages to the new capability-state step; a
  self-view-scoped capability-event counter (opt-in) for funnel measurement; a nightly job-health
  metric for the capability-state recompute (it must not silently no-op). Respect the flaky-test
  playbook (rerun `[vitest-pool]` worker crashes, pseudonym collisions).

---

## 12. Prioritized development roadmap

Sequencing reconciles the report's Wave 0–8 with Revealyst's shipped W5/W6 and the OTel gating. Each
wave is independently shippable and leaves **no half-integrated system** (a graph with no state, or
state with no surface, is forbidden).

### Wave 0 — Foundations & de-risking (S, Low)
- **Objective:** unblock the capability layer without new product surface.
- **User value:** none directly (correctness).
- **Backend:** fix the dual-source double-count dedup in `rowsForSubjects` (W6-A slice); confirm the
  self-view predicate registry (W5-A) is extensible; retire the dead `segmentTeams` path.
- **Frontend:** none. **Migrations:** none. **Tests:** dedup regression; predicate completeness.
- **Dependencies:** none. **Exit:** per-person sums are dedup-correct; registry ready.

### Wave 1 — Capability graph & catalog foundation (M, Low)
- **Objective:** the relational capability catalog + rec→capability linkage.
- **User value:** recommendations now say *which capability* they advance.
- **Backend:** `domains`, `capabilities`, `capability_signals`, `capability_dependencies` (seeded);
  add `target_capabilities` to `recommendation_catalog`; new `src/db/org-scope/capabilities.ts`
  namespace; ADR.
- **Frontend:** minimal — capability label on the coaching card.
- **Migrations:** new reference tables (seeded); one additive catalog column.
- **Tests:** seed-contract (counts, stable slugs, signal bindings resolve, DAG acyclic); frozen-catalog
  equivalence.
- **Dependencies:** W0. **Exit:** every rec links to ≥1 live capability; traversal returns eligible-next.

### Wave 2 — Capability evidence & user state (L, Medium)
- **Objective:** parallel `user_capability_state` engine.
- **User value:** a personal capability profile (mastery band + confidence + next).
- **Backend:** `user_capability_state` table (three registrations, ordered before `people`);
  capability-state reducer step in `src/poller/process.ts`; reuse honesty primitives; confidence from
  `signal-coverage`; decay/staleness; **capped `directional`.**
- **Frontend:** capability-profile card on the Companion.
- **Migrations:** state table + idempotent backfill (fan-out per org).
- **Tests:** state math vs. known-truth fixtures; explainability; self-view authorization; purge.
- **Dependencies:** W1. **Exit:** founder sees own per-capability band+confidence; a manager provably
  cannot.

### Wave 3 — Recommendation ranker v1 (M, Medium)
- **Objective:** consume the inert catalog metadata; deterministic utility ranking.
- **User value:** better-ordered, role/tool/prereq-aware next steps.
- **Backend:** replace fixed `impact` with the §7 utility formula in `deriveAttention`; add
  prerequisite + role/tool eligibility; real fatigue controls (time-decay, rotation).
- **Frontend:** unchanged surface, better ordering; confidence disclosure.
- **Migrations:** none. **Tests:** ranking golden tests; eligibility; fatigue; equivalence guard so
  existing weakest-first behavior is a strict subset.
- **Dependencies:** W1 (+W2 for prereqs). **Exit:** ranking reads all metadata; deterministic + tested.

### Wave 4 — Personal coaching experience (M, Low)
- **Objective:** polish the next-best-action feed + weekly personal surface.
- **User value:** a coherent "current level → one next step → why → progress" loop.
- **Backend:** capability-aware digest lane. **Frontend:** next-best-action feed; capability progression
  view; (optional) weekly reflection card. **Migrations:** none.
- **Tests:** digest/dashboard shared-source; reflection copy fact-check.
- **Dependencies:** W2, W3. **Exit:** one coherent self-view loop; digest and in-app agree.

### Wave 5 — Missions & progression (M, Medium)
- **Objective:** bounded, finish-lined challenges.
- **User value:** "run Bugbot on one PR and apply one suggestion" — start/progress/complete.
- **Backend:** `missions`/`mission_steps` (seeded) + `mission_progress` (self-view, three
  registrations); completion detected from measured signal crossings (reuse milestone plumbing).
- **Frontend:** mission card; progress; celebration (no streaks/XP).
- **Migrations:** mission tables. **Tests:** completion detection; self-view; purge.
- **Dependencies:** W3, W4. **Exit:** a person completes one mission end-to-end, measured not
  self-asserted.

### Wave 6 — Team intelligence & privacy-safe rollups (M, Medium)
- **Objective:** aggregate capability coverage for managers/execs.
- **User value:** managers see where to coach without surveillance.
- **Backend:** capability-coverage rollup (count-only, `MIN_PEOPLE`, `assertTeamOnlyPseudonymized`);
  one exec-memo line. **Frontend:** coverage card in Team Intelligence; exec memo line.
- **Migrations:** none (reads state). **Tests:** aggregation floor; no per-person leak; exec golden file.
- **Dependencies:** W2. **Exit:** team coverage renders aggregate-only; predicate green.

### Wave 7 — Experimentation & recommendation learning (L, High)
- **Objective:** measure whether recommendations cause improvement.
- **User value:** indirect (better recs over time).
- **Backend:** self-view exposure log (ADR resolving the privacy tension); holdout assignment;
  copy/ranking experiment framework; the **Outcomes entity** (gated: only when "tried" volume is real —
  no hollow table). **Frontend:** internal founder report only.
- **Migrations:** exposure/outcome tables with retention. **Tests:** holdout determinism; exposure
  completeness; privacy (self-view-only exposures).
- **Dependencies:** W3–W6 + real usage volume. **Exit:** a ranking change can be A/B'd with a holdout;
  lift is measurable.

### Wave 8 — Provider & role expansion (L, Medium/High)
- **Objective:** deeper markers + non-engineering roles.
- **User value:** measured (not directional) proficiency; PM/Marketing/etc. capabilities.
- **Backend:** OTel receiver (W6-D) + marker normalization (F3.2) → upgrade capability tiers to
  `measured`; role-pack capabilities *only when an honest telemetry source exists* (Future ledger gate —
  M365/Workspace admin APIs answered affirmatively). **Frontend:** marker breakdown; role packs.
- **Migrations:** marker metrics (additive). **Tests:** OTel fixture-proven metadata-only ingestion;
  ≥2-signal marker rules; no cross-channel double-count.
- **Dependencies:** founder OTel fixture capture (gated); dogfood outcome. **Exit:** measured markers
  flow self-view-only; a second role has honest data.

---

## 13. Reuse, refactor, build, remove

**Reuse (as-is).**
- Tenancy: `forOrg` + composite-tenant-FK + three-registration law (`src/db/org-scope.ts`,
  `tests/tenant-isolation.test.ts`, `src/db/account-deletion.ts`).
- Identity/evidence: `people` / `subjects` / `identities`, `metric_records`, `metric_catalog`,
  `subject_day_signals`, ingestion (`src/poller/run.ts`, `src/lib/agent-ingest.ts`).
- Honesty primitives: `lowestAttribution`, ratio-omission, null-on-absence (`src/scoring/evaluate.ts`,
  `src/contracts/attribution.ts`).
- Catalog engine: catalog-as-data/evaluator-as-code, closed comparators
  (`src/lib/recommendation-catalog.ts`, `src/db/org-scope/catalog.ts`).
- Interaction state + self-view enforcement (`rec_interaction_state`, `route.ts`, `src/lib/visibility.ts`,
  `src/lib/segments.ts` `MIN_PEOPLE`).
- Connectors' `normalize` contracts incl. every deliberate drop; the four connectors.
- Companion/Team/Exec surfaces, digest/email lanes, maturity model, `signal-coverage`, `ConfidenceTier`.

**Refactor (extend, non-breaking).**
- `deriveAttention` ranking: fixed `impact` → utility formula consuming catalog metadata (§7).
- `recommendation_catalog`: add `target_capabilities`; make the evaluator read `applicable_roles/tools`.
- Growth Journey card: level source org-maturity → person capability band (W6-E).
- `src/poller/process.ts`: add a parallel capability-state reducer step.
- Confidence: compose from evidence quality/coverage rather than a static label.

**Build (net-new).**
- `domains`, `capabilities`, `capability_signals`, `capability_dependencies`, `user_capability_state`,
  `missions`/`mission_steps`/`mission_progress`, and (deferred) `recommendation_exposure` +
  Outcomes/`capability_event`.
- Capability-state reducer engine; utility ranker; mission completion detection; capability-profile,
  mission, capability-coverage UI; (deferred) exposure logging + experimentation framework; OTel
  receiver (already scoped as W6-D).

**Remove / deprecate.**
- Dead `src/scoring/segment.ts` `segmentTeams` path (already flagged obsolete; port/retire its offline
  calibration consumer).
- The **CONFLICTING** state where catalog metadata (`benefit`/`difficulty`/`confidence`/
  `applicable_roles`/`applicable_tools`) is stored, tested, and *ignored* — resolve by consuming, not
  deleting.
- Retire (do not build in current form): fixed AI-persona labels, XP/streaks/leagues, graph DB, ML
  service, LMS/course layer.

---

## 14. Risks and unresolved decisions

**Decidable now from repository evidence.**
- Relational storage over a graph DB (node/edge count tiny; reads already batched). **Decided: relational.**
- Parallel mastery engine, not an extension of the frozen score engine (contract + determinism).
  **Decided: parallel.**
- Migration-based capability/mission authoring for MVP (catalog precedent). **Decided: migration seed.**
- Deterministic utility ranking before any ML (report + tripwires agree). **Decided: rules first.**
- Capability MVP needs *no* new signals — existing 28 metrics suffice. **Decided.**

**Requires founder/product input.**
- **Capability graph shape & seed content** — which 30–40 capabilities, their prerequisites, and the
  mapping to existing components. This is authoring, and it is where the product's opinion lives.
- **The "third ladder" line.** Spec V4 says org matures / person progresses are the *only two scales*.
  A per-capability mastery breakdown is finer than "person progresses (one band)." Confirm the
  capability profile is a *breakdown of the one band*, not a new competing ladder — else it violates a
  recorded decision.
- **Missions vs. the anti-gamification stance.** Missions are endorsed by Spec V4 §8.4 as long as they
  drop XP/streaks/leagues. Confirm the mission UI stays inside that boundary.
- **Exposure logging vs. "don't log rec shown to X."** Building the measurement loop reverses a
  deliberate privacy choice; needs an explicit ADR + founder sign-off.
- **Persona treatment.** The report wants per-person personas; the product kills fixed individual
  labels. Confirm personas stay an aggregate cohort lens only.

**External API uncertainties.**
- Measured proficiency markers depend on the **OTel receiver** (founder-gated fixture capture) and on
  Claude Code's OTel schema stability — until then, capped at `directional`.
- Higher-fidelity signals (Cursor Analytics API skills/MCP; Copilot PR block; OpenAI session mapping)
  are documented-but-unwired; vendor field/endpoint drift is a standing connector risk (adapter layer +
  contract tests mitigate).
- Non-engineering role expansion is **blocked on an honest telemetry source** (M365/Workspace admin
  APIs) — an open research question in the Future ledger; do not build role packs without it.

**Technical risks.**
- The **dual-source double-count** must be fixed before per-capability sums are trusted (Wave 0).
- Parallel-frozen-contract merge collisions (schema/migrations/org-scope append points) — serialize the
  *builds* per the W6 lesson; renumber migrations/ADRs on rebase.
- Full-vs-incremental recompute: the mastery reducer must be genuinely incremental or it re-introduces
  the perf floor the score engine already pays nightly.

**Product & privacy risks.**
- Recommendation/mission spam killing trust (fatigue caps, snooze learning, channel discipline).
- Over-personalization on weak data (explicit confidence, minimum-evidence thresholds, directional
  labels).
- A capability profile reading as a *grade* (positive-first copy law: "discovery, never deficiency").
- An always-empty Outcomes/exposure table (invariant-b trap) — ship only when volume is real.

---

## 15. Recommended immediate next wave

**Wave 1 — Capability graph & catalog foundation** (do Wave 0's dedup fix first if not already landed).
This is the smallest change that makes the whole capability thesis real without any new engine or
privacy surface, and it directly unblocks Waves 2–3.

**Exact modules affected**
- `src/db/schema.ts` — add `domains`, `capabilities`, `capability_signals`, `capability_dependencies`;
  add `target_capabilities text[]` to `recommendation_catalog`.
- `src/db/org-scope/` — new `capabilities.ts` namespace (one per-org batched `list()` + a graph read);
  register in `src/db/org-scope.ts`.
- `src/lib/recommendation-catalog.ts` — extend `CatalogRecommendation` + `mapCatalogRow` with
  `targetCapabilities`; add capability-graph types (pure, no I/O).
- `src/lib/score-insights.ts` — thread capability labels onto `kind: "recommendation"` items (display
  only this wave; ranking change is Wave 3).
- `src/components/companion/coaching-card.tsx` — render the capability label.
- Seed-contract test + tenant-isolation `SCOPED_READS` + `account-deletion` registration + ADR.

**Schema changes.** Four seeded reference tables (no `org_id`, mirror `roles`/`metric_catalog`) + one
additive nullable-defaulted array column on the existing catalog. Seed the Engineering domain, ≈30–40
capabilities, their `capability_signals` bindings to existing `metric_catalog`/component keys, and a
shallow prerequisite DAG — *in the migration* (no runtime seed). One migration, one ADR.

**APIs.** No new public route required (capabilities render server-side inside the dashboard read). If
a JSON surface is wanted, extend `/api/dashboard/summary` (already the batched read) rather than a new
endpoint.

**Jobs.** None. (State computation is Wave 2.)

**UI surfaces.** Capability label on the coaching card only. No capability-profile card yet (Wave 2).

**Tests.** Seed-contract (exact row counts; stable capability slugs; every `capability_signals` binding
resolves to a live `metric_catalog` key or score component; `applicable_roles ⊆ ROLE_SLUGS`;
`capability_dependencies` is acyclic; no self-edges); a `deriveAttention` equivalence guard proving the
existing recommendation output is unchanged (labels added, ordering identical); tenant-isolation
completeness; account-deletion purge (new tables are reference/global → `PURGE_EXEMPT_TABLES`, no
person data yet).

**Explicit non-goals (this wave).** No `user_capability_state` and no mastery math (Wave 2). No ranking
change — ordering stays weakest-first (Wave 3). No missions (Wave 5). No graph database. No ML. No new
signals or connector changes. No exposure logging or experimentation. No persona labels. No
capability-profile UI. No admin CRUD (author via migration).

**Acceptance criteria.** (1) Every one of the 7 seeded recommendations resolves to ≥1 live capability,
proven by the seed-contract test. (2) The capability graph seeds cleanly and the prerequisite DAG is
acyclic (test-enforced). (3) `deriveAttention` output is byte-for-byte equivalent to today except for
the added capability label (equivalence test green). (4) The coaching card shows "advances *Capability
X*." (5) All three registrations green; frozen-contract CI passes with the ADR in the same PR. (6) No
new query bypasses `forOrg`; the capability read is one per-org batch folded into the existing flat
`Promise.all` (no per-person N+1).

---

### Wave-by-wave integration validation (final check)

Each wave lands a complete slice: **W0** correctness only; **W1** graph + linkage (recs labeled, no
orphan capability); **W2** state + its one surface (no state without a card, no card without state);
**W3** ranking reads what W1 stored (no inert metadata left); **W4** one coherent self-view loop;
**W5** missions complete end-to-end from measured signals; **W6** aggregate rollups behind the privacy
floor; **W7** measurement only when volume justifies it (no hollow tables); **W8** measured markers +
role packs only when their gating evidence exists. At no point does the roadmap leave a capability graph
with no state, a state store with no surface, a ranker reading fields nothing populates, or an outcome
table with nothing to measure — the four partial-integration traps this audit was asked to prevent.
