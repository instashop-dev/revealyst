# Revealyst — AI Capability Layer (V4 Wave 7) Implementation Report

> Orchestrated build of `docs/Revealyst_AI_Capability_Execution_Plan.md` against
> Product Spec V4. Author: implementation orchestrator (Opus) + Sonnet research
> subagents. Date: 2026-07-14.

## 1. Executive summary

Wave 7 adds the thin AI-capability layer over the shipped substrate — a relational
capability graph, a per-person mastery engine, a deterministic recommendation
ranker, and privacy-safe team rollups — **evolving, not rewriting**, and staying
inside every hard constraint (no third ladder, no XP/streaks, no graph DB, no ML
service, no LMS).

**Delivered to production (merged to `main`):**

| Phase | What shipped | Migration / ADR | PR |
|---|---|---|---|
| **P0** — Foundations | Dual-source per-person double-count fix (`rowsForSubjects` MAX-collapse); `segmentTeams` confirmed already-removed; predicate registry confirmed extensible | — | #210 ✅ |
| **P1** — Capability graph | `domains`/`capabilities`(×9)/`capability_signals`/`capability_dependencies` (global reference, seeded); `recommendation_catalog.target_capabilities`; `forOrg().capabilities`; coaching-card capability label | mig 0030 / ADR 0035 | #211 ✅ |
| **P2** — Capability state | `user_capability_state` (org-scoped, self-view, directional-capped) + pure engine + batched parallel reducer + `forOrg().mastery` + capability-profile card | mig 0031 / ADR 0036 | #212 ✅ |
| **P3** — Utility ranker | `computeUtility` (named weights, no ML) replacing fixed `impact`; output-equivalence guard; stage-1 eligibility (role/tool/prereq, fails-closed) | — | #213 ✅ |
| **P4** — Coaching loop | Computed "why this" line (dominant utility term) + honest confidence disclosure; digest/dashboard shared-source test | — | #215 (merging) |
| **P6** — Team rollups | Aggregate, count-only, `MIN_PEOPLE`-floored capability-coverage card; per-person leak structurally impossible | — | (merging) |

**Deferred (with rationale in §4):** P5 (missions) — behind a founder sign-off
gate; the exec-memo coverage line (self-contained follow-up); live activation of
the P3 eligibility gates; the Growth-Journey level-source swap. **Wave 8 (P7
experimentation, P8 OTel measured tier)** stays externally gated and cannot be
forced by agent work.

Every merged phase: typecheck green, targeted tests green, `check-org-scope`
clean, and CI (OpenNext build + full test suite + frozen-contracts guard +
preview-deploy) green before merge (verified per L9 — captured `gh pr checks`,
grepped for `fail|error`, merged only if clean). Migrations were **serialized**
(one build at a time, rebased+renumbered) per L9 — no collisions.

## 2. What each phase does (and why it's honest)

### P0 — the correctness prerequisite
A person linked to two of their own connector sources (e.g. `anthropic_console`
admin API + `claude_code_local` agent) lands two `metric_records` rows for the
same metric/day/dim — `subject_id` is in the natural key and `dim` doesn't encode
the source — and the additive aggregations summed both, **doubling** that person's
tokens/spend. Fixed by collapsing same-`(day,dim)` rows within one person's
exclusive-subject set to the **MAX** (never above reality — the admin API is a
superset of the local slice) with the **lowest attribution** surviving. Person
branch only; team/org unions of different people are untouched. This was the
blocker for trustworthy per-person capability evidence.

### P1 — the graph as relational data
Nine outcome-named Engineering capabilities, each bound only to signals the
connectors already ingest (every `capability_signals` binding resolves to a live
`metric_catalog` key or `SCORE_GLOSSARY` component — a fact-checked claim
surface), with a shallow acyclic prerequisite DAG. Not a graph database:
traversal is a bounded in-memory walk over one batched read. All seven catalog
recs link to ≥1 capability; the coaching card now says which capability a nudge
advances. `deriveAttention` output is byte-identical except the optional label
(pinned by the migration-equivalence guard).

### P2 — mastery, capped directional, honest by construction
A parallel engine (the Maturity Model precedent — never extends the frozen score
engine) computes per-person mastery from the person's already-computed score
components + a bounded 28-day metric window, so a run is O(current), never
O(history). Zero evidence → **no row** (never `mastery: 0`); a real low is kept; a
fully-decayed reading is withheld. Capped `directional` until OTel supplies ≥2
corroborating markers. The reducer batches every read once for the org — the
query count is independent of person count and history depth (proven by
`tests/perf/capability-state-queries`). Rendered as a positive-first
capability-profile card: a **decomposition of the one proficiency band**, never a
competing third ladder; the raw number stays behind the existing diagnostic
expander.

### P3 — the ranker consumes what the catalog already stored
`utility = 0.35·capabilityGap + 0.20·benefit + 0.15·confidence + 0.10·roleToolFit
+ 0.10·novelty − 0.05·difficultyPenalty − fatiguePenalty`. Named, exported,
term-by-term-tested weights; **no ML, no LLM**. A permanent output-equivalence
guard proves uniform metadata reduces to today's weakest-first (a strict
generalization). Stage-1 eligibility (role/tool/prerequisite, fails-closed) is
implemented and fully tested.

### P4 — one coherent, explainable loop
Each surfaced rec carries a "why this" line drawn from its **dominant utility
term** (so the reason can't drift from the ranking) and an honest confidence
disclosure ("Based on N connected sources" — never a fabricated %). A shared-
source test proves the digest and dashboard select identical recs in identical
order via the same `deriveAttention` path.

### P6 — managers see where to coach, without surveillance
An aggregate, count-only, `MIN_PEOPLE`-floored capability-coverage card. A
capability with fewer than the floor of people-with-state is dropped entirely
(never a suppressed-but-implied number); the row prop type carries no person
id/name, so a per-person leak is structurally impossible. The per-person
`user_capability_state` never enters the team-visible view.

## 3. Engineering assumptions made (no founder input required)

Per the program directive, the plan's founder sign-off items (§7) that are
decidable from evidence were resolved autonomously and documented in the ADRs:

1. **Capability seed content** (§7.1) — authored as a conservative v0 of **9**
   capabilities bound only to already-ingested signals (not the aspirational
   30–40, which would require capabilities with no evidence binding — a
   fabrication risk). Expandable via an ADR-gated seed migration; nothing
   downstream hard-codes the count. (ADR 0035.)
2. **Third-ladder line** (§7.2) — the capability profile is a **decomposition of
   the one person proficiency band**, not a competing scale: bands + a plain-
   English confidence tier, raw number behind the existing expander, positive-
   first ordering. (ADR 0036.)
3. **Persona treatment** (§7.4) — untouched; personas remain an aggregate cohort
   lens only (existing `src/lib/segments.ts`), never a per-person label.

Other engineering choices: MAX (not sum) for the P0 dedup (conservative honesty);
`directional`-labeled uncalibrated thresholds throughout the mastery/ranker math;
the mastery reducer piggybacks the existing `score-recompute` message (no new
queue kind); the capability read folds into the existing depth-1 `Promise.all`.

## 4. Deferred items & why

### P5 — Missions (deferred; design ready)
**Why deferred, not rushed:** P5 is behind an explicit founder sign-off gate
(plan §7 item 3, "missions inside anti-gamification"; Spec V4 §6.4 marks it
`[Future→V1 per sign-off]`), it is the largest remaining phase (three new tables +
completion detection + an interactive opt-in surface + an API route), and the
plan's own principle forbids shipping a half-integrated system. The gamification-
sensitive surface (opt-in start, celebration) is exactly where anti-gamification
design must be gotten right; rushing it at the end of a long session on a live
production repo would risk the §8.4 invariant. **The measured, honest design is
ready to build as a single vertical slice:**

- `missions` / `mission_steps` (global reference, seeded) — a mission is a curated
  *sequence*; each step references a capability + a `target_mastery` crossing
  threshold (a step is measured against `user_capability_state`, not self-asserted).
- `mission_progress` (org-scoped, self-view, three registrations; **no
  `streak_count`/`xp`/`league` column** — asserted by a schema-shape test) — an
  opt-in `started_at` + a `completed_at` set by the capability-state reducer when
  every step's mastery crosses its target (a measured signal crossing via the
  milestone plumbing, strict `>`).
- Mission card (opt-in, renders null until started; not-started / "1 of 2 steps" /
  complete; celebration reuses `MILESTONE_COPY`'s grounded voice — no streak
  flame/XP/league/percentage-meter-as-game).
- Migration 0032, ADR 0037.

### Smaller follow-ups (all self-contained, low-risk)
- **Exec-memo coverage line** (P6) — one aggregate line via `composeExecReport`,
  reusing the same `mastery.coverageCounts` data; needs wiring into the separate
  exec-report data path.
- **Live activation of the P3 eligibility gates** — the machinery is shipped and
  tested but kept dormant: a fails-closed prerequisite gate over *directional-only*
  mastery could over-suppress live coaching (most personal-org users won't have a
  capability at `mastery ≥ 0.6` yet). Recommended: activate after a short dogfood
  observation, with `MASTERED_THRESHOLD` (or the DAG) as the tuning knob, wired on
  **both** the dashboard and the digest together to preserve the shared source.
- **Growth-Journey level-source swap to the capability band** — deferred until
  mastery is *measured* (OTel/P8); a directional band is a less honest headline
  than the modeled maturity level.

### Wave 8 — externally gated (cannot be forced)
- **P7 (experimentation / exposure log)** — requires a founder-signed ADR
  reversing the deliberate "don't log rec-shown-to-X" privacy stance, plus real
  "tried" volume (an always-empty outcome table is an invariant-b trap).
- **P8 (OTel measured tier + non-eng roles)** — requires the founder's OTel
  receiver fixture capture (W6-D) and an honest role-telemetry source (M365/
  Workspace admin APIs). Until then, all mastery stays `directional`.

## 5. Remaining risks & how they're mitigated

| Risk | Status | Mitigation in place |
|---|---|---|
| Per-person capability sums doubled | **Resolved** (P0) | MAX-collapse + regression tests |
| Mastery reads as a grade / third ladder | Mitigated | Band-not-number, positive-first, decomposition framing, capped rows |
| Reducer degrades to O(history) | Mitigated | Watermark-bounded window; perf test asserts query count independent of person count |
| Ranker mis-tuned without feedback data | Accepted, bounded | Permanent equivalence guard; deterministic + versioned weights; feedback loop is P7 |
| Prereq gate over-suppresses live coaching | Mitigated by deferral | Gate tested-but-dormant; activation is a founder-tunable follow-up |
| Team rollup leaks per-person mastery | Mitigated | Count-only, `MIN_PEOPLE` floor, prop type carries no person id — structurally impossible |
| Directional mastery mistaken for measured | Mitigated | Hard `directional` cap (L7); "early read" plain-language tier; measured only at P8 |

## 6. Post-launch recommendations

1. **Dogfood the capability profile + why-line for ~1 week** on the founder's
   personal org before Team rollout; version the ranker weights in a fixture so a
   tuning change is a reviewed diff.
2. **Then activate the eligibility gates** (dashboard + digest together) and
   observe coaching coverage; tune `MASTERED_THRESHOLD` if the prereq gate
   over-suppresses.
3. **Add the exec-memo coverage line** (small, self-contained) once a Team org has
   enough people-with-state to clear the floor.
4. **Build P5 (missions)** as the specified vertical slice once the anti-
   gamification UI is founder-confirmed.
5. **Wave 8** unblocks only on the founder OTel fixture capture and the privacy-
   reversal ADR — keep mastery labelled `directional` until then; do not imply
   `measured`.
6. **Watch the §14 dogfood clock** — the capability layer is now measurable
   surface for the return-rate/companion-revisit instrumentation already wired.

## 7. Validation summary

- **Migrations:** 0030 (capability graph, seeded), 0031 (user_capability_state);
  both apply cleanly in order against a fresh PGlite DB; idempotent-seed replay
  verified.
- **Contracts:** three-registration law satisfied for `user_capability_state`
  (SCOPED_READS + non-vacuous B-org seed, ADR 0036, PURGE_TABLES before `people`);
  global reference tables correctly skip both completeness tripwires;
  `check-org-scope` clean; frozen-contracts CI guard green (every frozen touch has
  its ADR in-PR).
- **Tests added:** dual-source dedup; capability-catalog seed contract (7 blocks);
  capability-state engine (12); reducer integration (5); no-per-person-query perf
  guard; utility ranker (12); shared-source; capability coverage + floor (3);
  component tests for the coaching label / why-line / profile card / coverage
  card. All green; existing suites (score-insights, recommendation-catalog,
  scoring-recompute, tenant-isolation, account-deletion, digest) green unchanged.
- **Honesty invariants (a–d):** every query org-scoped; no fabricated per-user
  numbers (zero-evidence → no row; MAX-not-sum; count-only rollups); frozen
  contracts touched only with an ADR; no tripwire tech (relational not graph DB,
  deterministic formula not ML, no XP/streaks).
