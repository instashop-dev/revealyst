# AI Intelligence System — Implementation Plan (non-enterprise scope)

**Status:** proposed · **Date:** 2026-07-11 · **Owner:** founder (product architect: fleet orchestration)

**Source of truth:** [AI Intelligence System research](research/2026-07-11-ai-intelligence-system.md)
(approved), [Manual Sync vs Desktop Connector](research/2026-07-11-manual-sync-vs-desktop-connector.md)
(approved — the resident desktop agent is **replaced** by Manual Sync, whose build is planned
separately in [manual-sync-plan.md](manual-sync-plan.md)), and the
[desktop collector research](research/2026-07-09-desktop-collector.md) (superseded on the
residency question; its privacy gates still bind).

**Method.** Produced by a coordinated fan-out of seven domain analyses (product scope,
architecture constraints, telemetry pipeline, UX surfaces, backend/data feasibility, desktop-sync
state, delivery conventions), each grounded in the repo at `origin/main` = `e5cf522`
(2026-07-11). Repo-grounded claims below (file paths, "fetched-but-dropped" facts, seeded-preset
contents) were verified by those analyses; effort labels follow the fleet calibration in §3, not
the research doc's human-team weeks.

This plan defines **what to build, in what order, and under which guardrails**. It contains no
code. Each feature still gets its own plan-mode pass at kickoff (research §13: all sizings are
research-level assumptions until planned).

---

## 1. Scope

### In scope
The non-enterprise recommendations of the research doc — its Waves A, B, C: coaching/insights on
existing data, the maturity model + weekly digest, and the proficiency track (OTel receiver,
proficiency signal, real benchmarks). Personal (org-of-one) and Team orgs alike — same machinery.

### Out of scope (with reasons)

| Item | Reason |
|---|---|
| **T8** Anthropic Claude Enterprise Analytics connector | Enterprise-tier buyer; research's own trigger is "first claude.ai-Enterprise customer" (parked) |
| **T9** Windsurf / Gemini Code Assist connectors | Demand-triggered; Gemini needs a customer-side GCP log sink (enterprise integration). Listed in the Phase 4 backlog (§7) with its trigger |
| **T10** MCP server-side OTel | Parked by the research; would ride T5 infra if ever built |
| **T6 + M13 + I6** GitHub outcome layer (PR throughput / review latency / delivery funnel) | Deferred, not rejected: needs a GitHub App permission expansion (repo/PR read), org re-consent, a dedicated positioning ADR **and** DPA review — a heavyweight program contrary to the minimize-complexity mandate. Re-decide in Phase 4 |
| **Resident desktop agent / §5.6 thin-collector inversion** | Replaced by Manual Sync (approved decision); residency is demand-gated on measured sync cadence — see [manual-sync-plan.md](manual-sync-plan.md) Phase 3 |
| **§11.7 pricing changes** (coaching tier) | Explicitly excluded by the research itself |
| **Group C metrics** (time-saved, per-person code quality, automation-vs-augmentation per person, shadow-AI estimates) | Refusal list — honesty boundary, never build |

### Relationship to the Manual Sync track
The Manual Sync MVP ([manual-sync-plan.md](manual-sync-plan.md), plan merged in PR #154, **no
implementation code on main yet**) is a separate, already-planned workstream. This plan does not
re-plan it, but **treats it as a Phase-1-adjacent dependency**: until its staleness UX and
window-pinning fixes ship, no local-channel-fed insight is honest across a sync gap (invariant
b). Features below that read `claude_code_local` data are explicitly staleness-gated (§2, G5).
Research T7's **multi-CLI collectors** (Codex CLI JSONL, Gemini CLI local OTel) are orthogonal
to residency: they are parser extensions to the on-demand CLI and belong to the Manual Sync
track as fast-follows, not to this plan.

---

## 2. Standing guardrails (every feature inherits these)

- **G1 — Review invariants.** (a) every query org-scoped via `forOrg` / `appContext`;
  (b) never fabricate per-user numbers; (c) frozen contracts untouched without an ADR in the
  same PR; (d) no tripwire tech (no formula DSL, no ML service, no browser extension/proxy, no
  prompt-content ingestion in Team mode, no Kafka/ClickHouse).
- **G2 — Confidence labeling.** Every inferred number carries the research's three-tier label
  (*measured / derived / directional*). Nothing *directional* is ever billed, ranked, or
  manager-surfaced; directional claims need ≥2 corroborating signals.
- **G3 — Self-view enforcement in code, not copy.** Person-level proficiency/coaching surfaces
  render only in the self-view (`PersonalSelfView` branch; in Team orgs, only to the person
  themselves), enforced by a `visibilityMode`-parameterized read plus an audit predicate
  mirroring `assertTeamOnlyPseudonymized` (`src/lib/visibility.ts`). When a field is added to a
  type an audit predicate inspects, the predicate is updated in the same PR (vacuous-pass trap).
- **G4 — Honest empty/degraded states.** Reuse the existing idiom: `EmptyState` (why it's
  empty + what fills it, never a teaser number), score-card `null`/`omitted` branches, delta
  `first`/`notComparable` kinds. Ratio quantities with a missing side are omitted, never floored
  to 0; plain counts floor to 0 only where "no rows = measured zero" is true.
- **G5 — Staleness gating for local-channel data.** Freshness for `claude_code_local`-fed orgs
  comes from `connections.last_success_at` — never `score_results.computed_at` (rewritten
  nightly), never metric-row absence. Anomaly flags, plateau warnings, digests, and cadence-based
  proficiency markers must suppress or annotate when data is stale past the badge threshold.
- **G6 — Static content over engines.** Coaching recommendations, narratives, and learning paths
  are static content keyed off measured gaps — no formula DSL, no LLM service, no per-user
  generation. An LLM-written variant is a V2 question, out of scope.
- **G7 — Copy discipline (W3-N/W3-P).** New user-facing prose (coaching text, maturity labels,
  digest copy) is a claim surface: copy lives in glossary-style constant modules shared across
  surfaces (`metrics-glossary.ts` pattern), product numbers render shared constants
  (`FREE_TRACKED_USER_LIMIT` pattern), connector claims derive from the registry, and every new
  surface gets an adversarial content fact-check by a reviewer who did not write the prose.
- **G8 — Numbering claimed at build time.** ADR and migration numbers are independent serial
  sequences claimed immediately before PR (check `ls docs/decisions/` and `ls drizzle/*.sql`,
  re-check after final sync to main). This plan deliberately assigns none.
- **G9 — New org-scoped tables carry the full registration.** ADR + `drizzle-kit generate` +
  `tests/tenant-isolation.test.ts` `SCOPED_READS` entry with a non-vacuous B-org seed + the
  account-deletion purge registration.
- **G10 — Perf discipline.** New dashboard reads thread onto the existing single flat
  `Promise.all` in `readDashboardView` — never a new sequential query stage.

---

## 3. Effort scale and delivery model

Efforts below use the fleet calibration (measured from merged W4 workstreams), not calendar
weeks — pace is set by gate/review surface, not typing:

| Label | Shape | Trips |
|---|---|---|
| **S** | Pure `src/lib`/UI PR, ~5–10 files incl. tests | typecheck, unit tests, org-scope guard; no ADR |
| **M** | New surface/page or connector field-harvest, ~15–25 files, possibly one ADR | + component tests; ADR if it adds a table/org-scope method |
| **L** | New table / connector fetch layer / queue infra, ~25–35 files | + ADR, migration, tenant-isolation entry, fixtures; new queues need `wrangler queues create` in **both** `deploy.yml` and `ci.yml`'s preview-deploy |

Every feature ships as **one workstream = one agent = one independently-mergeable PR (chain)**,
started via `/kickoff` in plan mode, built against fixtures, `/code-review` + fixes applied
**before** `gh pr create` (merge-race rule), tip verified as ancestor of `origin/main` after
merge (stacked-PR rule). Each phase closes with a `/gate-check`-style evidence pack judged by the
founder (mechanical results + adversarial pre-review + a known-truth dogfooding comparison).

**Priority key:** P = this plan's priority (P1 highest). Research rank (§12 of the research doc)
shown for traceability.

---

## 4. Phase 1 — "From reporting to answering" (lib-only, ~no ADRs)

Everything here is computable from existing data. Maximum parallelism: all seven features are
independent and can run as concurrent workstreams. **Entry:** none (start now).
**Cut order under pressure:** F1.7 → F1.6 → parts of F1.2 (never F1.1's honesty labels).

### F1.1 Coaching recommendations v1 (C1) — P1 · research rank 1
- **Objective:** Turn the dashboard from reporting to answering: extend `deriveAttention`
  (`src/lib/score-insights.ts`) with a `recommendation` item kind — a static map from
  score-component-gap patterns to adoption guidance (the resurrected Spec-V3 Coaching cut).
- **Dependencies:** none. Zero new queries; component breakdowns already persisted.
- **Approach:** pure-lib derivation over existing score components; guidance content in a
  glossary-style constant module (G7); gating logic centralized inside `deriveAttention` (the
  existing "gate centrally, pass raw facts" pattern). Renders through the existing
  `AttentionAlert`/Alert primitive on both dashboard views.
- **Data/telemetry:** existing `score_results.components` + definitions; nothing new.
- **UX impact:** trivial–module; new card kind in the existing attention strip.
- **Risks:** overclaim trap — recommendation copy is the #1 surface for fabricated per-user
  claims; mitigate with G2 labels + G7 adversarial fact-check. Keep recommendations
  task-focused, never person-focused (Kluger & DeNisi).
- **Effort:** S.

### F1.2 Quick analytics bundle (M1–M5, M7) — P1 · research rank 2
- **Objective:** Wire the analytics already in hand: raw-metric WoW/MoM deltas (M1), spend
  run-rate projection (M2), within-org distributions/percentiles (M3), concentration index (M4),
  cost-per-unit displays (M5), model-mix trend (M7).
- **Dependencies:** none; all inputs verified present in `metric_records`/readers.
- **Approach:** pure lib. M1 reuses the `deriveDelta`/`notComparable` guards; M2 extends
  `spend-governance.ts` (labeled *derived, straight-line*); M3/M4 compute over per-person
  `metric_records` (identity-resolved in lib) — **not** person-level score rows, which Team orgs
  don't have; M5 inherits ratio honesty (either side missing → not shown); M7 extends
  `summarizeModelVolume` to multi-window. Percentiles live in lib, outside the scoring engine —
  no vocabulary ADR needed (that's M10, deferred).
- **Data/telemetry:** existing 26 canonical keys; `metric_records` are unpurged, so history is
  available. Reads thread onto `readDashboardView`'s `Promise.all` (G10).
- **UX impact:** delta chips on existing stats (trivial); one new Spend card (M2); 2–3 new team
  dashboard modules (M3/M4/M7), aggregate-only, count-first in private mode.
- **Risks:** M4 concentration thresholds are uncalibrated — ship directional-labeled; M3 in team
  mode must stay aggregate (no named ranks — leaderboards demoralize, per the research).
- **Effort:** S–M (can split into 2 PRs: deltas/spend vs distribution modules).

### F1.3 Score-drop attribution (I1) — P1 · research rank 3
- **Objective:** When a score falls ≥N points, name the driving component ("Efficiency fell 8
  pts — driven by spend-per-active-day"). The cheapest intelligent-feeling feature.
- **Dependencies:** none (breakdowns persisted; `formatComponentDetail` already decomposes).
- **Approach:** extend the existing score-drop branch of `deriveAttention` + a line in the
  score-card breakdown.
- **Data/telemetry:** existing `score_results.components` history.
- **UX impact:** trivial — enriches existing attention item + score card.
- **Risks:** minimal; component deltas must reuse the `notComparable` guards across
  definition-version changes.
- **Effort:** S.

### F1.4 Agentic adoption rate (M6) — P1 · research rank 4
- **Objective:** Surface the agentic transition: `agent_active` days ÷ active days, per org/team,
  trend over time.
- **Dependencies:** none for display. The agentic keys (`agent_sessions`, `agent_requests`,
  `agent_active`, `ai_credits`) are seeded (migration 0022) **and populated** by the
  Copilot/Cursor/Anthropic normalizers — but consumed by zero score preset today.
- **Approach:** displayed rate + trend = pure lib. A scored preset variant (or M15) is a seed
  migration → ADR — defer to Phase 4 unless demanded.
- **Data/telemetry:** existing agentic metric rows; verify per-connector emission as part of the
  feature's fixture tests (if a vendor emits none, the module renders the honest empty state).
- **UX impact:** module — one new dashboard card (team + personal variants).
- **Risks:** low; conflating "no agentic rows" with "no agentic use" — G4 empty-state discipline.
- **Effort:** S.

### F1.5 Vendor field harvest (T1 cohorts + T2 Cursor fields) — P1 · research rank 5
- **Objective:** Fill proficiency-signal gaps from data the connectors already download:
  Copilot `ai_adoption_phase` per-user cohorts (fetched today, dropped in `normalize.ts`) and
  Cursor's fetched-but-unnormalized fields (`acceptedLinesAdded/Deleted`, `totalApplies`,
  subscription-vs-usage request splits).
- **Dependencies:** none; both are normalize-layer changes against already-recorded payloads.
- **Approach:** map the Copilot cohort to a `feature_used` dim (e.g. `feature=phase:agent_first`)
  — no catalog ADR; wire Cursor fields to existing keys (`edit_actions_*`, `lines_*`). The
  Copilot **PR-velocity block** (new aggregate report fetch) and Cursor `/teams/spend` are
  **excluded** here — they carry a catalog-ADR/new-fetch cost and overlap deferred M13; revisit
  in Phase 4.
- **Data/telemetry:** recorded vendor payload fixtures updated to cover the new fields.
- **UX impact:** none directly (data-layer); feeds F1.4, M11, and the maturity model.
- **Risks:** vendor field drift (the standing treadmill) — connector-facts re-verification
  cadence applies; Cursor plan-gating of some fields is a known unknown (surface as honesty gap,
  not a guess).
- **Effort:** S (one connector file each + fixtures).

### F1.6 Onboarding-to-value bridge (C4) — P2 · research rank 7
- **Objective:** Fix the documented cliff between "connected" and "first scores": an interim
  "here's what we ingested; first scores by tomorrow" state + a first-week guided sequence.
- **Dependencies:** none.
- **Approach:** extend `onboarding-wizard.tsx` (which already shows "Backfilling…") + a dashboard
  interim/empty branch; content in constants (G7). No new data.
- **Data/telemetry:** existing connector-run status + first metric rows.
- **UX impact:** module — wizard end-state + dashboard empty-state upgrade.
- **Risks:** low. Must not promise score timing the recompute paths can't keep: connector polls
  enqueue a same-day recompute (the real latency is backfill completion), but the local
  manual-sync channel has no recompute enqueue until its Fix 2 ships — until then those scores
  wait for the nightly 02:00 UTC cron.
- **Effort:** S.

### F1.7 Honesty-gap trend (I8) — P2 · research rank 10
- **Objective:** Make the honesty machinery visible progress: attribution coverage over time
  ("92% of usage person-attributed, up from 71%") — a surface nobody else can show.
- **Dependencies:** none.
- **Approach:** pure lib over `metric_records.attribution` (unpurged → long trend); connector-gap
  detail limited to `connector_runs`' 90-day retention — scope the trend accordingly.
- **Data/telemetry:** existing attribution column + honesty gaps.
- **UX impact:** trivial–module (team dashboard / methodology page).
- **Risks:** none notable. First to cut under pressure (garnish that rides a release).
- **Effort:** S.

**Phase 1 exit gate:** all merged features green in CI; dogfooding comparison on the founder org
(recommendations/deltas/attribution match known truth); adversarial content fact-check passed on
all new user-facing copy; no new ADRs consumed (proves the lib-only claim held).

---

## 5. Phase 2 — "The CTO artifact"

Reads better once Phase 1's surfaces exist (the digest and maturity report compose them).
**Entry:** Phase 1 exit gate green. **Cut order:** F2.4 (I4 correlation garnish first) → never the
staleness gates.

### F2.1 AI Maturity Model v1 + org report (M12 / §10) — P1 · research rank 6
- **Objective:** The market's first telemetry-derived AI maturity model (L0 Dormant → L4
  Amplified, Breadth/Depth/Consistency axes) + the one-page board artifact (8 CTO numbers:
  activation % + dark-seat $, adoption vs benchmark, maturity + QoQ, plateau flag, concentration,
  cost per active user, tool sprawl, agentic share). Answers "are we the 95% or the 5%."
- **Dependencies:** F1.2 (M3/M4/M8 components), F1.4 (agentic share), F1.5 (cohort depth
  signal). M9 dark-seat math lands here.
- **Approach:** pure lib composite over existing readers (`connections.list`, `feature_used`
  dims, `billing.trackedUsers`, `metric_records` cadence/retention) — **no ADR for v1**; no new
  storage (QoQ trajectory recomputable from unpurged `metric_records`; persist a history table
  only if request-time proves too slow — that would be an ADR + G9). New page/route in `(app)/`;
  score-card visual language; Personal orgs get a reduced self-version.
- **Data/telemetry:** existing; consistency axis reads raw days (week-grain score rows don't
  exist and aren't needed).
- **UX impact:** page — the biggest new surface in the plan; also the positioning refresh
  vehicle (F2.5).
- **Risks:** level thresholds are uncalibrated → ship *modeled/directional*-labeled (reuse the
  benchmark labeling discipline); Goodhart drift (no hard targets, paired counterweights);
  shadow-AI and ROI shown as explicitly-not-scored gaps, never estimated (Group C).
- **Effort:** M.

### F2.2 Weekly digest (C2) — P1 · research rank 8
- **Objective:** The retention/coaching loop's delivery vehicle (Grammarly pattern): a weekly
  email — trend vs past-self, personal best, 1–3 task-focused recommendations. Personal = full;
  Team admin = aggregate-only lane.
- **Dependencies:** F1.1 (recommendation content), F1.2 (deltas). Manual-sync staleness UX
  shipped (G5) before digests go to local-channel-only orgs.
- **Approach:** the one Phase-2 feature with real infra: (1) digest HTML assembly = pure lib
  over dashboard-view data + `sendEmail` (`src/lib/email.ts`, SES — exists, ADR 0015); (2)
  scheduling = new weekly cron line + queue message kind + `process.ts` case (established
  non-frozen path; if a new queue consumer is added, `wrangler queues create` goes in **both**
  `deploy.yml` and `ci.yml` preview-deploy); (3) **preferences/unsubscribe storage = the real
  lift**: new org-scoped table → ADR + migration + tenant-isolation entry + purge registration
  (G9); unsubscribe route is an unauthenticated `getApiContext()` token endpoint (share-links
  pattern), never `handleApi`.
- **Data/telemetry:** existing metrics/scores; `last_success_at` for staleness suppression.
- **UX impact:** new channel (email) + a notification-preferences section in Settings.
- **Risks:** stale-data digests misrepresent (suppress/flag past threshold, always show
  data-as-of); digest copy is a claim surface (G7); deliverability/unsubscribe compliance
  (List-Unsubscribe header, one-click).
- **Effort:** M–L (ADR + table + cron/queue + email rendering; a natural 2-PR chain: prefs
  table + sender, then content).

### F2.3 Anomaly + plateau early warning (I2, I3) — P2 · research rank 9
- **Objective:** "Spend is 2.4× your trailing baseline" (I2) and "team X's usage cohort is
  crossing a falling threshold — the MIT learning-gap detector" (I3).
- **Dependencies:** F1.2's M8 retention/consistency curves for I3. Manual-sync staleness fields
  for G5 gating.
- **Approach:** pure lib — rolling mean/σ (z-score) over `metric_records` windows, request-time
  (no cache table, no precompute, explicitly no ML service). New `deriveAttention` item kinds.
  Activation cohorts key off `connector_runs.startedAt` / `metric_records.day`, never
  `computed_at`. For local-channel orgs: gate on `last_success_at` freshness — a post-gap sync
  batch is not a spike; an unsynced stretch is not a collapse.
- **Data/telemetry:** existing; unpurged history suffices for baselines.
- **UX impact:** module — new attention items + optional spend/activity annotations.
- **Risks:** false positives erode trust — label "unusual vs your baseline," never "wrong";
  plateau thresholds uncalibrated (directional label until fleet data accrues).
- **Effort:** M.

### F2.4 Monthly narrative + correlation surfaces (I7, I4) — P3 · Wave-B adjacency
- **Objective:** A template-composed plain-prose period summary (I7) and "these moved together"
  panels (I4) — never causal claims.
- **Dependencies:** F1.2, F2.3 (reuses their derivations).
- **Approach:** pure lib template composition (G6 — no LLM); dashboard card and/or digest body
  section.
- **Data/telemetry:** existing.
- **UX impact:** module.
- **Risks:** correlation copy must stay non-causal (G7 fact-check). First cut in this phase.
- **Effort:** S–M.

### F2.5 Positioning refresh (§11.1) — P2 · rides F2.1
- **Objective:** Reposition scores as "adoption & usage sophistication — a leading indicator";
  state plainly that adoption ≠ realized productivity; never ship "time saved."
- **Dependencies:** F2.1 (the maturity artifact is the new story's centerpiece).
- **Approach:** copy-only across landing/methodology/score glossary; connector claims stay
  registry-derived; full adversarial content fact-check (this exact pass caught overclaims
  twice before).
- **Data/telemetry:** none.
- **UX impact:** copy.
- **Risks:** overclaim regression — the fact-check is the mitigation.
- **Effort:** S.

**Phase 2 exit gate:** maturity report + digest live on founder org; digest unsubscribe verified
end-to-end; anomaly/plateau shown to suppress correctly on a stale local-channel org (G5 test);
content fact-check evidence attached; ADR count matches plan (digest prefs table; maturity v1
consumed none).

---

## 6. Phase 3 — "The proficiency moat"

The differentiation layer competitors' admin-API pulls structurally can't match. Heaviest phase —
sequence after the cheap wins have shipped and are earning retention.
**Entry:** Phase 2 exit gate green; founder go on the OTel spike.

### F3.1 Claude Code OTel receiver (T5) — P1 · research rank 11
- **Objective:** The flagship sanctioned Team channel: org-configured OTLP push delivering what
  no admin API has — true accept/reject (`code_edit_tool.decision`), `active_time`, retries,
  tool taxonomy, per-user tokens/cost.
- **Dependencies:** none technically; gated on its own ~1-week **spike** (committed in the
  research) answering: OTLP protobuf vs JSON on workerd; exporter auth header scheme (device-token
  analogue — org scope from token, never payload); connection `authKind` question.
- **Approach:** greenfield route (`/v1/metrics`, `/v1/logs`) → **202-accept → queue-batch →
  one-chunk-one-UTC-day** aggregation to the frozen `(subject, metricKey, day, dim)` +
  `subject_day_signals` grain, reusing the `agent-ingest` upsert seam (delete-then-upsert,
  restatement windows) and its content-scrub posture (content flags never set + defensive scrub
  at the boundary — tripwire G1d). Queue messages carry `raw_payloads` pointers, never raw event
  batches (128 KB cap). New queue consumer → `wrangler queues create` in **both** workflows.
- **Data/telemetry:** produces first producers for `retries` (key exists) and the M14 inputs.
- **UX impact:** connections-page setup surface (config snippet, verify-receipt state) — module.
- **Risks:** highest-effort item in plan (spike de-risks); event-burst load (queue-batch design
  is the mitigation); prompt-content adjacency (scrub + fixture tests proving metadata-only);
  vendor OTel schema drift.
- **Effort:** L (spike S, then an L PR chain: route+auth, queue consumer+aggregation, UI).

### F3.2 Active-time & verification metrics (M14) — P2 · follows F3.1
- **Objective:** Turn OTel events into canonical metrics: hands-on active time, edit decisions
  by source, retry counts, tool-taxonomy usage.
- **Dependencies:** F3.1 shipped and emitting.
- **Approach:** catalog ADR (new `CANONICAL_METRICS` keys + seed migration in lockstep — the
  drift test enforces it); normalization inside the F3.1 aggregation stage.
- **Data/telemetry:** OTel channel.
- **UX impact:** feeds F3.3; optional self-view cards.
- **Risks:** low once F3.1 is stable.
- **Effort:** M (ADR + seed + aggregation mapping + honesty tests).

### F3.3 Proficiency signal + learning paths (M11 + §8 + C6) — P1 · research rank 12
- **Objective:** The person-level proficiency band (L0 Dormant → L4 Orchestrator), self-view
  only, with "what moved" decomposition and static learning-path content keyed to band —
  the individual moat (§11.3).
- **Dependencies:** F1.5 (cohort marker), F3.1/F3.2 (high-value markers: verification,
  work-per-prompt, active time). A v1 on today's markers alone (active-day cadence, model
  routing, `peakConcurrency`) is possible but capped at *directional* — build after OTel so the
  band means something.
- **Approach:** pure-lib composite (request-time; no storage unless band history is persisted —
  then ADR + G9); ≥2 corroborating signals per marker (G2); **self-view-only enforced in code**:
  `visibilityMode`-parameterized read + a new audit predicate, per G3. Local-channel markers
  labeled with staleness caveats (G5 — cadence markers must not read unsynced days as inactive).
  C6 = static curricula content module (G6), rendered by band.
- **Data/telemetry:** existing markers + T5/M14 outputs.
- **UX impact:** new model — proficiency card + breakdown in `PersonalSelfView` only; C6 content
  pages (methodology-style).
- **Risks:** the surveillance-perception risk concentrates here (G3 is the mitigation, and the
  audit predicate is gate evidence); overclaim trap in band copy (G7); weights uncalibrated —
  band is org-relative + confidence-labeled, never certified/billed.
- **Effort:** M–L.

### F3.4 Real peer benchmarks (I5) — P2 · research rank 14
- **Objective:** Swap the modeled benchmark fixture for consented, k-anonymous cross-org
  percentiles — the data-moat flywheel (§11.6).
- **Dependencies:** consent volume (k-anon floor ≥ 20 orgs/cell) + W4-R calibration; ship when
  thresholds are met, not before (public anchors, clearly labeled, remain the interim).
- **Approach:** the seams exist: `resolveBenchmarkSource()` swap point, seeded `benchmarks`
  reference table (ADR 0007 lineage), `benchmark_consent` table + toggle. New work = a bounded
  cross-org percentile job in non-frozen `src/db/system.ts` (never `forOrg`) + verified-status
  publishing. No frozen-contract change.
- **Data/telemetry:** consented orgs' aggregates only.
- **UX impact:** existing benchmark panel flips from "modeled (unverified)" to "verified peer"
  labeling — trivial UI, high trust impact.
- **Risks:** k-anon under-supply (stay on anchors); percentile job must be bounded/system-level
  (tenancy review).
- **Effort:** M.

**Phase 3 exit gate:** OTel channel dogfooded on the founder org with fixture-proven
metadata-only ingestion; proficiency band renders self-view-only (audit predicate in evidence
pack; adversarial reviewer attempts a manager-view leak); M14 honesty tests green; benchmark
swap behind verified-status flag.

---

## 7. Phase 4 — demand-gated backlog (build on trigger, not on schedule)

| Item | Trigger | Notes |
|---|---|---|
| **M15** AI-Health composite preset | CTO/report demand for one blended number | Seed-migration ADR; composes shipped pieces |
| **C3** learning goals + progress meters | Proficiency engagement data shows pull | New table (ADR + G9); endowed-progress UX |
| **M10** percentile/growth vocabulary ADR | First preset that *needs* in-scoring percentiles/velocity | Until then lib-side computation suffices (proven in Phase 1) |
| **T3** OpenAI usage families / **T4** Anthropic OAuth-actor recovery | User demand (T3) / vendor fix lands (T4, issue #27780) | S–M connector work; rank-19 value |
| **T1b** Copilot PR-velocity block / **T2b** Cursor `/teams/spend` | Pulled forward only with T6 re-decision or explicit demand | Carries catalog-ADR cost |
| **T6 + M13 + I6** GitHub outcome layer | Founder positioning decision | Dedicated ADR + DPA review + App permission expansion + org re-consent; aggregate-only, never per-person |
| **C5** manager/system coaching lane (delivery parts) | With T6 | Aggregate-only concentration/plateau parts ship earlier via F2.3 |
| **Resident desktop agent** | Median sync cadence (from `last_success_at`) worse than ½·retention | Per [manual-sync-plan.md](manual-sync-plan.md) Phase 3; wraps the manual-sync pipeline unchanged |
| **T9 / T10** connectors | Named customer demand | Re-open per new-connector process |

---

## 8. Dependency graph

```
Manual Sync MVP (separate plan, in flight) ──► G5 staleness gates ──► F2.2 / F2.3 / F3.3 (local-channel honesty)

Phase 1 (parallel): F1.1  F1.2  F1.3  F1.4  F1.5  F1.6  F1.7
                      │     │           │     │
                      ▼     ▼           ▼     ▼
Phase 2:        F2.2 ◄─ F1.1/F1.2   F2.1 ◄─ F1.2/F1.4/F1.5     F2.3 ◄─ F1.2(M8)
                F2.5 ◄─ F2.1        F2.4 ◄─ F1.2/F2.3
                      │
                      ▼
Phase 3:        F3.1 (spike → build) ──► F3.2 ──► F3.3 ◄─ F1.5
                F3.4 ◄─ consent volume + W4-R calibration (clock, not code)
Phase 4:        triggers only
```

External clocks to fire early (rule 5): none required for Phases 1–2. Phase 3 needs only the
founder's OTel-spike go. The single Phase-4 external approval (GitHub App permission expansion)
fires only on the T6 re-decision.

---

## 9. Top risks (plan level)

| Risk | Phase | Mitigation |
|---|---|---|
| Overclaim in coaching/proficiency/maturity prose (highest brand risk) | all | G2 tiers + G7 standing adversarial fact-check + Group-C refusals |
| Surveillance perception from person-level surfaces | 3 | G3 code-enforced self-view + audit predicate as gate evidence |
| Stale local-channel data silently corrupting insights (measured-zero conflation) | 1–3 | G5 gating on `last_success_at`; Manual Sync staleness UX ships first; `sync_window_incomplete` gap ADR (manual-sync plan Phase 2) |
| Uncalibrated thresholds (maturity levels, plateau, concentration, proficiency weights) | 2–3 | *modeled/directional* labels; calibrate on fleet data before removing labels |
| Goodhart drift once maturity/scores become OKRs | 2+ | paired counterweights, directional framing, no in-product targets |
| Vendor field/API drift | 1, 3 | quarterly connector-facts re-verification; value concentrated above raw numbers |
| OTel receiver effort/complexity | 3 | committed spike before build; queue-batch design; strict scope (metrics/logs aggregation only) |
| Digest infra creep (new table + cron + queue) | 2 | G9 full registration; 2-PR chain; unsubscribe via token route pattern |

---

## 10. What this plan deliberately does not do

- No pricing/packaging changes (§11.7 excluded by the research).
- No enterprise connectors or GitHub repo-data processing without their own ADR + DPA decision.
- No ML service, formula DSL, LLM-generated coaching, or prompt-content ingestion — ever (rule 7).
- No fabricated numbers: no time-saved, no per-person quality, no shadow-AI estimates, no
  measured-zero where data is merely absent.
- No resident desktop agent — Manual Sync is the shipping local channel; residency re-enters
  only on measured cadence evidence.
