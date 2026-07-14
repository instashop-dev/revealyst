# Revealyst — AI Capability Layer (V4 Wave 7–8) Implementation Report

> Orchestrated build of `docs/Revealyst_AI_Capability_Execution_Plan.md` against
> Product Spec V4. Author: implementation orchestrator (Opus) + Sonnet research
> subagents. Date: 2026-07-14.
>
> **COMPLETE** — the full plan (P0–P8) shipped to production: Wave 7 (P0–P6) plus
> the three W7 follow-ups, then Wave 8 (P5 missions, P7 exposure log, P8 OTel
> measured tier) once the founder cleared their gates. The only deferred item is
> non-engineering role expansion (a separate telemetry gate). Migrations 0030–0034,
> ADRs 0035–0039.

## 1. Executive summary

Wave 7 adds the thin AI-capability layer over the shipped substrate — a relational
capability graph, a per-person mastery engine, a deterministic recommendation
ranker, and privacy-safe team rollups — **evolving, not rewriting**, and staying
inside every hard constraint (no third ladder, no XP/streaks, no graph DB, no ML
service, no LMS).

> **Status update (2026-07-14) — the program is now COMPLETE.** The founder
> subsequently cleared all three remaining gates (missions anti-gamification
> sign-off; OTel fixture capture, with real `fixtures/otel/*.captured.json`
> landing via #220; and the privacy-reversal ADR). So **P5, P7, and P8 — plus the
> three smaller W7 follow-ups — have all shipped.** The only item still deferred is
> non-engineering role expansion, which is a *separate* gate (an honest
> M365/Workspace role-telemetry source that does not exist). The §4 "deferred"
> discussion below is retained as the point-in-time rationale; the table here is
> the current truth.

**Delivered to production (all merged to `main`):**

| Phase | What shipped | Migration / ADR | PR |
|---|---|---|---|
| **P0** — Foundations | Dual-source per-person double-count fix (`rowsForSubjects` MAX-collapse); `segmentTeams` confirmed already-removed; predicate registry confirmed extensible | — | #210 ✅ |
| **P1** — Capability graph | `domains`/`capabilities`(×9)/`capability_signals`/`capability_dependencies` (global reference, seeded); `recommendation_catalog.target_capabilities`; `forOrg().capabilities`; coaching-card capability label | mig 0030 / ADR 0035 | #211 ✅ |
| **P2** — Capability state | `user_capability_state` (org-scoped, self-view, directional-capped) + pure engine + batched parallel reducer + `forOrg().mastery` + capability-profile card | mig 0031 / ADR 0036 | #212 ✅ |
| **P3** — Utility ranker | `computeUtility` (named weights, no ML) replacing fixed `impact`; output-equivalence guard; stage-1 eligibility (role/tool/prereq, fails-closed) | — | #213 ✅ |
| **P4** — Coaching loop | Computed "why this" line (dominant utility term) + honest confidence disclosure; digest/dashboard shared-source test | — | #215 ✅ |
| **P6** — Team rollups | Aggregate, count-only, `MIN_PEOPLE`-floored capability-coverage card; per-person leak structurally impossible | — | #216 ✅ |
| *W7 follow-ups* | Exec-memo coverage line; **live** eligibility gates (dashboard+digest, forming-user safeguard); Growth-Journey band headline (gated on `measured`) | — | #217 ✅ |
| **P5** — Missions | Opt-in, finish-lined missions; completion is a **measured** capability crossing (never a click); `missions`/`mission_steps` (seeded) + `mission_progress` (self-view); **no XP/streak/league/points** (schema + copy tests); `POST /api/missions/start` | mig 0032 / ADR 0037 | #221 ✅ |
| **P7** — Exposure log | `recommendation_exposure` (org-scoped, **self-view-only**, purge-registered) reversing the "don't log rec-shown" stance under a signed ADR; deterministic holdout/variant assignment; digest writes exposures off the hot path; Outcomes/lift stays gated on real volume | mig 0033 / ADR 0038 | #222 ✅ |
| **P8** — OTel measured tier | Marker metrics (`otel_active_time`/`otel_edit_accepted`/`otel_edit_rejected`) + `POST /v1/metrics`+`/v1/logs` OTLP receiver (device-token auth, pure decoder **tested vs the real captured fixtures**); capability renders **`measured`** on ≥2 corroborating markers (no cross-channel double-count) | mig 0034 / ADR 0039 | #223 ✅ |

**Still gated (a separate gate — cannot be forced):** non-engineering role
expansion needs an honest M365/Workspace role-telemetry source, which does not
exist; a role pack without it would fabricate coverage (invariant b).

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

### P5 — missions that finish on real evidence, not a click
Opt-in, finish-lined missions bundle a short sequence of steps toward a
capability. A step is done when the person's **measured mastery crosses its
target** — detected by the nightly reducer (`isMissionComplete`, stamped once),
never a self-asserted checkbox. There is deliberately no "complete" route; the
only write is the opt-in `POST /api/missions/start`. No XP/streak/league/points
mechanic exists at the schema, engine, or copy layer — enforced by a schema-shape
test and a banned-phrasing test, not just convention (Spec V4 §8.4).

### P7 — measuring lift, without surveilling
`recommendation_exposure` is the append log of "coaching rec X was shown to
person Y" — the foundation for experimentation. It **reverses** the deliberate
"don't log rec-shown" stance, so it is bounded by ADR 0038: org-scoped,
**self-view-only** (no manager/admin read route; `list()` is server-side only),
never on the team view, purge-registered, idempotent per day, with the one
audited-impersonation bypass named. Holdout/variant assignment is deterministic
(stable hash, never per-request random); the digest logs exposures off the hot
path. The Outcomes/lift entity stays gated on real volume — not shipped hollow.

### P8 — the honest upgrade from directional to measured
The Claude Code OTel export is the one source of markers no admin-API connector
can emit — real active time and real accept/reject. The OTLP `/v1/metrics` +
`/v1/logs` receiver reuses the device-token scheme; a **pure decoder tested
against the founder's real captured payloads** (rule 2) handles the JSON quirks.
A capability with evidence for ≥2 of its bound markers renders **`measured`** (the
markers are distinct metric keys, so no cross-channel double-count) — the only
honest way past the `directional` cap, gated on evidence per person.

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

## 4. Deferred items & why  *(historical — see the §1 status update; P5/P7/P8 have since shipped)*

> This section captured the point-in-time deferral rationale. The founder then
> cleared every gate below, so **P5, P7, and P8 all shipped** (see the §1 table
> for their migrations/ADRs/PRs). The "why deferred" reasoning is kept because it
> documents the *design* each phase was built to — and each shipped exactly as
> designed here. The one item that remains deferred is non-eng role expansion (a
> separate telemetry gate).

### P5 — Missions (SHIPPED as designed — mig 0032, ADR 0037, #221)
**Original "why deferred" rationale (the design it shipped to):** P5 was behind an explicit founder sign-off gate
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

### Smaller follow-ups — **all three now SHIPPED** (post-report, no migration/ADR)

> Update: the three follow-ups below were subsequently implemented and tested.
> Summary of what shipped: (1) the exec-memo coverage line is live in
> `readExecReport`/`composeExecReport` (same MIN_PEOPLE floor as the dashboard);
> (2) the eligibility gates are **activated live on the dashboard and digest
> together**, with a forming-user safeguard (the fails-closed prereq gate applies
> only once the person has established ≥1 capability, so directional-only mastery
> can't over-suppress), pinned by a gated shared-source test; (3) the
> Growth-Journey band headline (`overallCapabilityBand`) is wired but gated on the
> `measured` tier — null today (all mastery is directional), so behavior is
> unchanged until OTel/P8. The original deferral rationale is retained below for
> context.
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

### Wave 8 — gates since CLEARED by the founder → SHIPPED
- **P7 (experimentation / exposure log) — SHIPPED (mig 0033, ADR 0038, #222).**
  The founder-signed privacy-reversal ADR was provided; `recommendation_exposure`
  ships **self-view-only** (no manager/admin read route, never on the team view,
  purge-registered, impersonation caveat named), with deterministic holdout/variant
  assignment and the digest writing exposures off the hot path. The **Outcomes /
  lift** entity + offline Precision@k/NDCG@k harness remain gated on real "tried"
  volume — deliberately not shipped hollow (invariant b).
- **P8 (OTel measured tier) — SHIPPED (mig 0034, ADR 0039, #223).** The founder's
  real OTel fixture capture landed (`fixtures/otel/*.captured.json`, #220), so the
  OTLP `/v1/metrics`+`/v1/logs` receiver + pure decoder were built and **tested
  against the real payloads** (rule 2); a capability now renders `measured` on ≥2
  corroborating markers. **Non-engineering role expansion is the one item still
  deferred** — a *separate* gate needing an honest M365/Workspace role-telemetry
  source, which does not exist (a role pack without it fabricates coverage).

## 5. Remaining risks & how they're mitigated

| Risk | Status | Mitigation in place |
|---|---|---|
| Per-person capability sums doubled | **Resolved** (P0) | MAX-collapse + regression tests |
| Mastery reads as a grade / third ladder | Mitigated | Band-not-number, positive-first, decomposition framing, capped rows |
| Reducer degrades to O(history) | Mitigated | Watermark-bounded window; perf test asserts query count independent of person count |
| Ranker mis-tuned without feedback data | Accepted, bounded | Permanent equivalence guard; deterministic + versioned weights; feedback loop is P7 |
| Prereq gate over-suppresses live coaching | Mitigated (now live) | Forming-user safeguard: the fails-closed prereq gate applies ONLY once a person has ≥1 mastered capability, so a forming person keeps the full coaching set; `MASTERED_THRESHOLD` is the tuning knob. Watch coaching coverage in dogfood. |
| Team rollup leaks per-person mastery | Mitigated | Count-only, `MIN_PEOPLE` floor, prop type carries no person id — structurally impossible |
| Directional mastery mistaken for measured | Mitigated | The tier renders `directional` ("early read") unless ≥2 OTel markers make it `measured` (P8); markers are distinct keys → no cross-channel double-count |
| Exposure log leaks coaching history to a manager | Mitigated (P7) | Self-view-only (no manager/admin read route), never on the team view, purge-registered; only audited impersonation can view (as the user), named in ADR 0038 |

## 6. Post-launch recommendations

*The whole program (P0–P8) is now in production. These are the operating
recommendations for the shipped system.*

1. **Dogfood the full loop for ~1 week** on the founder's personal org before Team
   rollout — capability profile, why-line, missions, and (now-live) eligibility
   gates. Version the ranker weights in a fixture so a tuning change is a reviewed
   diff.
2. **Watch coaching coverage now that the eligibility gates are live.** If the
   fails-closed prereq gate over-suppresses despite the forming-user safeguard,
   `MASTERED_THRESHOLD` (in `capability-state.ts`) is the tuning knob.
3. **Point the OTel exporter at `/v1/metrics`** for the dogfood org and confirm
   markers land + a capability flips to `measured` (which also activates the
   Growth-Journey band headline). Deliver the two documented follow-ups when
   useful: dashboard exposure logging (a client beacon) and `/v1/logs` event-marker
   mining.
4. **Watch exposure volume before turning on an experiment.** The exposure log +
   deterministic holdout are ready; add an entry to the `EXPERIMENTS` registry
   (with an ADR if it changes ranking/copy) once there's enough exposure/"tried"
   data to build the Outcomes/lift entity honestly (do not ship it hollow).
5. **Non-eng role expansion stays gated** on an honest M365/Workspace role-telemetry
   source — the only remaining deferred item.
6. **Watch the §14 dogfood clock** — the capability layer + exposure log are now
   measurable surface for the return-rate/companion-revisit instrumentation.

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
