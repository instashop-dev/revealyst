# Revealyst — Team Manager Dashboard Execution Plan (Team AI Operating System)

> **Status: Draft for founder review — 2026-07-19.** Grounding `main` at the time of writing:
> latest migration on disk `drizzle/0047_connector-scoped-ingest.sql`, latest ADR
> `docs/decisions/0060-connector-scoped-ingest.md`. This plan was built by a read-only
> specialist fan-out (four agents) that verified every file/line anchor **against the code,
> not the prose**. It obeys CLAUDE.md operating rules 1–7, the three-registration law for a
> new org-scoped table (tenant-isolation `SCOPED_READS` with a non-vacuous B-org seed · an
> ADR · `account-deletion.ts`), and honesty invariants (a) every query org-scoped, (b) never
> fabricate a per-person number, (c) frozen contracts need an ADR, (d) no tripwire tech. **No
> code ships from this plan until the founder approves the plan (not the diff), per "plan mode
> before code."** If any task drifts into a frozen path it stops and files an ADR (rule 1).

> **Sources of truth, in priority order:**
> 1. `docs/product/team-manager-dashboard-analysis.md` — the founder-supplied analysis this
>    plan implements (product direction wins on any product-shape conflict).
> 2. `docs/product-signoffs.md` — the durable founder-decision ledger. **A ratified row wins
>    over the analysis doc** (the analysis is a proposal; ratified decisions are settled).
>    Directly binding here: D-TCI-5, D-TCI-1, D-TCI-2, D-TCI-3, D-TCI-4, D-TCI-6, D4.
> 3. The code as it stands (the file:line anchors below).
> 4. `docs/Revealyst_Product_Spec_V4.md` + CLAUDE.md — invariants and the NOT-list.
> On conflict, a higher number yields to a lower one, except (2) which is settled fact.

---

## 0. Plan-on-a-page

**The thesis.** Revealyst already has a stronger intelligence model than its team experience
shows. The change is not more metrics — it is completing the manager loop: **Goal → diagnosis
→ recommended action → execution → measured outcome → next action.** We do this by
**restructuring the existing `/dashboard` team page into a "Manager Command Center"** (not a
new five-tab nav — D-TCI-5 is ratified: grow the card page, add cards/drawers, no new nav
items), then adding the two genuinely-missing entities — a **team goal** and **initiatives**
(a recommendation with an owner, participants, baseline, target, review date, and outcome) —
and finally the weekly/monthly operating ritual on top of composers that already exist.

Much of the analysis doc's §4/§5 is **already shipped** as the Team Capability Intelligence
(TCI) slice — coverage counts, per-capability trend, a count-only insight feed, and a
manager per-person drill-in (ADRs 0044–0046 / 0050 / 0054). This plan credits that and builds
only the delta.

| Phase | Milestone | User-visible value | New table? | Effort | Risk |
|---|---|---|---|---|---|
| **P0** | Command Center IA + copy + number hygiene | Conclusion-first page; ≤3 priorities; 4 compact indicators; one data-confidence line; jargon → manager language; no `47.0199%` artifacts | No | M | Low |
| **P1** | Team goal / review period | Manager sets one goal (metric, baseline, target, review date); it heads the page and biases which priority shows first | **Yes** `team_goals` | M | Med |
| **P2** | Initiatives (executable recommendations) | Turn a recommendation into a tracked initiative: owner, participants, baseline, target, duration, review, outcome; seed the initiative library | **Yes** `initiatives` (+ participants) | L | High |
| **P3** | Measure improvement | Decision log for initiatives; before/during/after evidence; intervention-effectiveness read; capability depth + spread aggregates | Maybe | L | High |
| **P4** | Role- & workflow-aware intelligence | Wire the schema-only role→domain read live; capability-by-subgroup via existing `team_id`; setup captures function/workflows | Maybe | L | High (gated) |
| **P5** | Operating habit | Weekly AI Manager Brief + monthly review surfaced in-app; reminders; export; deterministic "Ask Revealyst" (canned questions only) | No | M | Med |

**Numbering at build time.** Next migration = **`0048`**, next ADR = **`0061`**. Verify both
on disk with `ls drizzle/*.sql` and `ls docs/decisions/` **immediately before each PR** — a
parallel merge can claim your number between now and then (migration and ADR are independent
sequences). Every phase that adds a table renumbers against whatever merged first.

**Standing constraint — serialize the table-bearing builds, not just merges.** P1, P2, and
possibly P3 each append to `src/db/schema/*`, a migration, `src/db/org-scope.ts`,
`tests/tenant-isolation.ts`, and `src/db/account-deletion.ts`. W6 proved that parallel builds
over these files force heavy migration renumbering + a snapshot-drift bug. Build P1 → P2 → P3
in series; each rebases and regenerates its migration (`drizzle-kit generate`) after the prior
one merges.

---

## 1. Conflict resolutions (these supersede the analysis doc where they disagree)

These are evidence-based deviations. Each cites the ratified decision or the code that forces
it. The analysis doc is a proposal; these are the reconciled build targets.

- **R1 — No five-tab nav. The Command Center is a restructure of `/dashboard`, not a new IA.**
  The analysis §4 proposes Overview / Capabilities / Initiatives / Team / Settings as nav
  areas. **D-TCI-5 is ratified: "keep growing the 5-card page; TCI screens land as cards/
  drawers on the existing team dashboard, not new nav items."** Current team nav
  (`src/lib/nav-items.ts` `TEAM_NAV_ITEMS`) is Team (`/dashboard`) · AI maturity (`/maturity`)
  · Settings (`/settings`), with an already-wired-but-empty `MANAGER_NAV_ITEMS` seam. So:
  Overview/Capabilities/Team become **sections and drawers within `/dashboard`**; Initiatives
  gets **one** new item via the empty `MANAGER_NAV_ITEMS` seam only if P2 proves it needs its
  own route (default: a card + drawer on `/dashboard`). `/maturity` folds into the Command
  Center as a lens per analysis §3 (route stays alive per the W5-H "route stays, item leaves
  nav" pattern). **Any deviation from R1 requires reopening D-TCI-5 with the founder
  (OQ-TMD-1).**

- **R2 — Most of analysis §5E "Capability map" already ships; build the delta, not the map.**
  `buildCapabilityCoverage` + `CapabilityCoverageCard` (coverage, MIN_PEOPLE-floored),
  `capability-history.ts` + `CapabilityGrowthCard` (per-capability trend), and
  `deriveTeamInsights` (count-only per-capability suggested actions) already exist. The map's
  **missing columns** are a real per-capability **depth** aggregate (today only a 2-band
  mastered/developing split) and a **spread** statistic (today concentration is a boolean
  insight). Those are the P3 build, not a from-scratch map.

- **R3 — "Initiatives" is a new entity; missions are the pattern, not the mechanism.**
  `missions`/`mission_progress` are single-person, self-view-only, opt-in, capability-threshold
  completion, and hard-constrained against gamification (no xp/streak/points, enforced by a
  schema-shape test + a banned-phrasing test — `tests/missions.test.ts`). An initiative has an
  **owner, named participants, a manager-visible roll-up, a baseline/target, and a review
  date** — it crosses the self-view wall. Reuse the missions *measured-completion* pattern
  (`isMissionComplete`, `recompute-capability-state.ts`) for outcome detection, but the table
  is new and its anti-gamification constraints must be re-asserted (no points/leaderboard).

- **R4 — Named participants cross the self-view wall; each such surface needs the ADR-0038
  mold even though D-TCI-1/2 unblock it.** D-TCI-1 (managers may see named per-person
  capability) and D-TCI-2 (named per-person spend, behind an admin toggle, default off) are
  ratified overrides, but both say the *build still requires* the ADR-0038-mold ADR: consent
  machinery in the visibility framework, per-surface identity registration, a manager-vs-member
  authz test matrix, and purge/tenant registrations. P2's participant list and any named
  "ready to mentor" surface inherit that requirement. `rec_interaction_state` and
  `recommendation_exposure` stay **self-view-only forever** (V4 NOT-list) — the initiative
  decision log is a *separate* manager-scoped table, not an extension of those.

- **R5 — "Ask Revealyst" is deterministic, not an LLM.** Tripwire G7 bans a formula DSL and a
  separate ML service; there is no LLM anywhere in the product (every composer is pure
  template). "Ask Revealyst" (analysis §14) ships in V1 as a **fixed set of canned questions**
  each answered by an existing pure read (e.g. "Where is capability concentrated?" →
  `deriveTeamInsights` concentration items). Free-text natural-language Q&A is **Future /
  gated** (OQ-TMD-4) — do not build an LLM query layer under this plan.

- **R6 — Rename in copy only; do not rename score slugs.** Analysis §12/§13 wants Activation →
  "People using AI regularly", Efficiency → "License/Spend utilisation", etc. `score_slug`
  values (`adoption`/`fluency`/`efficiency`) are part of the frozen `recommendation_catalog`
  contract (`score_slug` links recs to components) and the scoring engine. **Change the
  rendered labels** (`src/lib/team-overview-copy.ts`, score-card copy) — **never the slugs**.
  "Efficiency" is the highest-value rename (it implies productivity, which the product refuses
  to claim — an honesty win, invariant b). Record as OQ-TMD-3.

- **R7 — "Demote the benchmark" is a layout change, honesty already holds.** The modeled
  benchmark is already labeled modeled and consent-gated (`BenchmarkConsentToggle`, D-U5). P0
  moves `BenchmarkPanel` behind progressive disclosure (analysis §13/§16); no data change.

---

## 2. What already exists (credit before building)

A precise map so no phase re-proposes shipped work. All paths are repo-relative.

| Analysis-doc want | Status | Where |
|---|---|---|
| Measured / modeled / directional honesty | Shipped | `src/lib/capability-glossary.ts`, `confidenceTierLabel`; `ConfidencePill` |
| Breadth / depth / consistency maturity | Shipped | `src/lib/maturity.ts`, `MaturityAxisMeters` |
| Capability coverage (count-only, MIN_PEOPLE floor) | Shipped | `src/lib/capability-coverage.ts`, `CapabilityCoverageCard` |
| Per-capability trend | Shipped (org-wide, month-grain, mastered-count) | `team_capability_history` (mig 0038, ADR 0046), `CapabilityGrowthCard` |
| Count-only per-capability suggested actions | Shipped | `deriveTeamInsights` (`src/lib/team-insights.ts`), `ManagerInsightsCard` |
| Manager per-person capability drill-in | Shipped | ADR 0045, `loadManagerCapabilityDrillIn`, `/team/[personId]` |
| Manager role tier | Shipped | D-TCI-3 / ADR 0044, `role_assignments`, empty `MANAGER_NAV_ITEMS` seam |
| Weekly aggregate manager brief | Shipped (in the digest email) | `composeTeamBrief` (`src/lib/team-brief.ts`, ADR 0050), `src/poller/digest.ts` |
| Monthly exec narrative | Shipped (email + `/api/exec-report` export) | `composeExecReport` (`src/lib/exec-report.ts`) wraps `composeNarrative` |
| Recommendation ranking (utility, novelty, fatigue, eligibility) | Shipped | `computeUtility` + `deriveAttention` (`src/lib/recommendation-catalog.ts`, `src/lib/score-insights.ts`) |
| Recommendation exposure log + experiment substrate | Shipped (self-view; registry empty) | `recommendation_exposure`, `src/lib/experiments.ts` |
| Segments (count-only, members never surfaced) | Shipped | `src/lib/segments.ts` (`SEGMENT_MIN_PEOPLE_TO_NAME = 4`) |

**Genuinely missing (this plan's real work):** a **team goal/objective**, an **initiative**
(owner/participants/baseline/target/review/outcome), a **compact 4-indicator KPI row**, a
**per-capability depth + spread aggregate**, a **manager decision log** for initiatives, a
**workflow** data model (analysis §9 "by workflow" — no schema exists), and the **in-app**
weekly/monthly ritual (the composers exist; they are email/export only today).

---

## 3. Phases

### P0 — Manager Command Center: IA, copy, and number hygiene (no new table)

Restructures `src/app/(app)/dashboard/team-overview.tsx` (662 lines) to the analysis §15
order using **only data `readDashboardView` already returns**. Delivers most of the perceived
"100×" with the least risk, and creates the empty-state slots P1/P2 fill.

- **T0.1 — Conclusion-first reorder.** New top-to-bottom order: (1) goal slot [P1 empty-state
  stub], (2) manager-brief summary line [reuse `composeTeamBrief` output, rendered in-app], (3)
  **top-3 priorities** — cap the merged `deriveAttention` + `teamInsights` stream at 3 and
  render as the "why it matters / evidence / next action / what we'll watch" block (analysis
  §5B), (4) active-initiatives slot [P2 empty-state stub], (5) capability map (promote the
  existing `CapabilityCoverageCard` + `CapabilityGrowthCard` up from section (c)), (6) four
  compact indicators, (7) one data-confidence line, (8) everything else behind
  `CollapsibleSection` (maturity detail, tools, spend, benchmark, segments, distribution,
  methodology). Files: `team-overview.tsx`, `src/app/(app)/dashboard/shared.tsx`
  (`AttentionSection`), `src/lib/team-overview-copy.ts`.
- **T0.2 — Four compact indicators.** Replace the three full-size score cards + movement +
  spend line at the top with a tight KPI row: Sustained adoption · Workflow depth · Capability
  spread · Data confidence (analysis §5D). Full score cards move into the collapsible detail.
  New small `KpiTile` presentational component; no new reads.
- **T0.3 — One data-confidence line.** Collapse `DataTrustCard` + `SharedAccountFlags` +
  scattered per-card `ConfidencePill`s into a single persistent line (analysis §11): "Data
  confidence: Good — 13 of 14 identified · 5 of 7 tools reporting · 2 shared accounts
  unresolved." Inline warnings only when a limitation **materially changes a conclusion**
  (keep the honest gap surface, drop the repetition). Do **not** delete honesty data — demote
  its prominence.
- **T0.4 — Number hygiene (invariant-adjacent honesty polish).** Round rendered percentages
  and fix raw-float CSS widths: `usage-distribution-panel.tsx:54-55/82` (unrounded `pct` in a
  `width:${pct}%` style → `47.0199%`), `score-meter.tsx` / `maturity-axis-meters.tsx:63` (raw
  `value` width), `benchmark-panel.tsx:62,69` (raw `left:%` marker). Standardize on whole-number
  rounding; reconcile the lone 1-decimal attribution-trend display (`attribution-trend-card.tsx:167,184`).
- **T0.5 — Manager-language copy pass.** Apply the analysis §12 relabels **in copy only** (R6):
  Activation → "People using AI regularly", Fluency → "Repeatable workflow usage", Concentration
  → "Expert dependency / capability spread", Plateau → "Growth momentum", Agentic share →
  "Agent-assisted work", Tool sprawl → "Tool coverage and overlap", **Efficiency → "License
  utilisation"** (the honesty-motivated one). All in `team-overview-copy.ts` + score-card copy;
  slugs untouched. Add/adjust the banned-phrasing test if "efficiency"-as-productivity copy is
  removed.
- **T0.6 — Over-explanation sweep.** Remove the double explanation (every section renders a
  lead paragraph **and** each card its own description). Keep one; drop the header instruction
  "Tap the info icon next to any number…" (`team-overview-copy.ts:11-12`) in favor of the
  compact confidence line.
- **Verify:** dashboard query count/depth unchanged (`tests/perf/authenticated-page-queries`);
  `assertTeamOnlyPseudonymized` still passes in private mode; vitest-axe smoke on the recomposed
  route; screenshot proof at desktop + mobile (embedded-browser rAF gotcha — assert on streamed
  DOM, not innerText). **No migration, no ADR** (stops and files one if a frozen path is touched).

### P1 — Team goal and review period (new table `team_goals`; ADR + migration)

Gives the page its missing spine: the manager-chosen objective that determines which metric
matters now (analysis §2.3, §5A).

- **T1.1 — `team_goals` table.** Org-scoped (optionally team-scoped via `team_id`): `metric`
  (a closed enum over existing score slugs / capability slugs — never free-form, invariant b),
  `baseline`, `target`, `review_date`, `owner` (a person/role reference), `status`, timestamps.
  One active goal per org/team (CAS on write). Three registrations: `SCOPED_READS` with a
  non-vacuous B-org seed; ADR `0061` (or next free); `account-deletion.ts` PURGE_TABLES
  (ordered before `teams`/`people` if it FKs them). New `forOrg().goals` namespace factory
  (`src/db/org-scope/goals.ts`).
- **T1.2 — Goal setter UI.** A drawer from the Command Center header (D-TCI-5: drawer, not a
  new page). Plain-English: "What should the team get better at, and by when?" Baseline is
  auto-suggested from the current measured value; target and review date are manager-entered
  and **honestly labeled manager-set, not a Revealyst promise** (the renewal-date "unverifiable"
  labeling precedent).
- **T1.3 — Goal-biased priority ordering.** Feed the goal's `metric` into the top-3 priority
  ranking so the constraint blocking the chosen goal sorts first. This is a *display ordering*
  input to `deriveAttention`'s existing impact sort — **not** a change to score math (keep the
  output-equivalence guard: with no goal set, ordering is byte-identical to today).
- **T1.4 — Goal progress in the header + brief.** Render "Baseline 54% → Target 75% · review
  31 Aug · now 61%" using measured values only; withhold "now" if unmeasured (no fabricated
  progress).
- **Open question OQ-TMD-2 (founder):** should a manager-set goal *bias* the recommendation
  ranking, or only *display* alongside it? Default (this plan): display + tie-break only, never
  changes which recs are eligible. **No build past T1.3's guard until ratified.**
- **Verify:** migration-equivalence test (no goal ⇒ identical priority order); tenant-isolation
  green; purge test green; drawer a11y.

### P2 — Initiatives: executable recommendations (new table `initiatives` + participants; ADR + migration)

The heart of the loop (analysis §5C, §7, §8). Turns a recommendation into a tracked effort.
**Highest risk** — it crosses the self-view wall (named participants, manager-visible roll-up),
so it rides the ADR-0038 mold (R4).

- **T2.1 — Governing ADR first (ADR-0038 mold).** Before any table: an ADR that registers the
  new manager-visible identity surface, the consent posture (participants are named to their
  manager under D-TCI-1's ratified override), the manager-vs-member authz matrix (only a
  manager of that team; members see their own participation, never the roster's private
  coaching), and the purge/tenant registrations. Cite D-TCI-1 as the unblock and this ADR as
  the how.
- **T2.2 — `initiatives` + `initiative_participants` tables.** `initiatives`: org-scoped,
  `owner` (manager), `title`, `template_slug` (FK to the initiative library, T2.4),
  `capability_slug` / `score_slug` affected, `baseline`, `target`, `duration`, `review_date`,
  `status` (`draft`/`active`/`in_review`/`completed`/`stopped`), `outcome`
  (`improved`/`unchanged`/`worsened`/`inconclusive`, null until reviewed), timestamps.
  `initiative_participants`: `(initiative_id, person_id)` — the wall-crossing table; ordered in
  PURGE_TABLES before `people`. **Anti-gamification re-assertion (R3):** no points/xp/streak/
  league/badge column — add the same schema-shape + banned-phrasing tests missions has.
- **T2.3 — Launch flow from a priority/recommendation.** The top-3 priority's `Start
  initiative` action (analysis §5B) opens a launch drawer prefilled from the recommendation:
  diagnosis (catalog `title`/`body`), why-it-matters (`whyLine`), evidence (`confidenceNote` +
  the measured component reading), suggested intervention (catalog `body`), expected change
  (the target metric). Manager fills owner/participants/duration/target/review. This closes the
  §7 "seven fields" gap: fields 1–5 come from the catalog, 6 from the launch form, 7 from T3.
- **T2.4 — Initiative library (seeded reference data).** A global reference table (or a coded
  registry like `capability-curriculum.ts`) seeding the analysis §8 templates: spread-expert-
  workflow, build-one-repeatable-workflow, improve-consistency, activate-underused-tool, reduce-
  overlap, agentic-pilot, function-playbook. Each template maps to a `capability_slug`/
  `score_slug` and a default expected-change. Link `recommendation_catalog.slug` → a template
  (the `related_workflows[]` column exists and is currently inert — a candidate home).
- **T2.5 — Active-initiatives card (fills the P0 slot).** The analysis §5C table: Initiative ·
  Goal · Participation (N of M, count-only unless the manager opens the roster) · Early signal ·
  Review-in. Server component reading a new `forOrg().initiatives` namespace, folded into the
  `readDashboardView` batch (one added read, keep depth budget).
- **Verify:** authz test matrix (member cannot read another's participation detail; non-manager
  gets 404); tenant-isolation + purge green; the self-view surfaces (`rec_interaction_state`,
  `recommendation_exposure`) still have **no** manager read route (pin with a test).

### P3 — Measure improvement (decision log; before/after; depth + spread aggregates)

Makes outcomes real (analysis §5G, §7 field 7, §14 "intervention effectiveness", §13 "keep
depth/concentration but decompose them").

- **T3.1 — Initiative outcome review.** At `review_date`, surface the initiative in an
  in-review state and compute before/during/after **evidence** from measured reads over the
  initiative window (reuse the `team_capability_history` period rollup + score movement). **Do
  not claim causality** — present the comparison and let the manager mark the outcome
  (`improved`/`unchanged`/`worsened`/`inconclusive`). Where a mission-style measured capability
  crossing occurred for participants, surface it as the strongest evidence.
- **T3.2 — Manager decision log.** A manager-scoped record of initiative decisions
  (accepted/modified/rejected/launched/completed) with the manager's note — analysis §14
  "decision log". Separate from the self-view `rec_interaction_state` (R4). Likely a `status`/
  event trail on `initiatives` + `manager_notes` reuse (`manager_notes` already exists,
  engine-isolated by test) rather than a brand-new table — decide in T3.1's ADR whether a
  dedicated `initiative_events` table is warranted.
- **T3.3 — Capability depth + spread aggregates (fills the R2 map delta).** Add a per-capability
  **team mean/band distribution** (depth beyond today's binary mastered/developing) and a
  **spread statistic** (dispersion, not the boolean concentration insight) to
  `mastery.coverageCounts`' sibling reads — count-only, MIN_PEOPLE-floored, no per-person leak
  (the `CapabilityCoverageRow` prop type carries no id — keep it that way). May need the
  `team_capability_history` writer to also persist depth/spread for trend (deliberate compute-
  on-read exception already blessed by ADR 0046 — extend, don't re-litigate).
- **T3.4 — Intervention effectiveness read.** Wire the dormant substrate: join
  `recommendation_exposure` (who-saw-what) to measured movement to produce an honest,
  aggregate, no-causality-claim "initiatives that preceded improvement" read. Register an
  experiment in the empty `EXPERIMENTS` registry only if the founder wants a real holdout
  (OQ-TMD-5); default is descriptive before/after only.
- **Verify:** every new read count-only + floored; no causal language in copy (banned-phrasing
  test); tenant-isolation for any new table.

### P4 — Role- and workflow-aware intelligence (mostly gated)

Analysis §9. The honesty ceiling here is a **data-source** problem, not a UI problem — flagged
gated so nothing hollow ships.

- **T4.1 — Wire the schema-only role→domain read live.** `roles.domainSlug` exists (ADR 0054)
  but `capabilities.list()` ignores it — the capability read is not role-scoped. Make the team
  capability surfaces domain-aware so an engineering team sees the engineering graph and a
  (future) non-eng team sees its pack. **Gated on D-TCI-8 activation**, which is itself gated on
  the paused D-DA-5/D-DA-9 non-eng telemetry source — so this ships **engineering-only** now and
  the wiring is dormant-ready for non-eng.
- **T4.2 — Capability-by-subgroup.** The `team_capability_history` writer only ever emits
  org-wide rows (`team_id = null`) though the column exists. Make it segment by `team_id` to
  power the analysis §2.5 "by subgroup" breakdown — count-only, MIN_PEOPLE-floored per subgroup
  (a subgroup below the floor is dropped entirely, never implied).
- **T4.3 — "By workflow" — spec only, no build.** There is **no workflow data model**
  (`workflow-diversity.ts` is a feature-diversity *count*, not named workflows). Analysis §9
  "by workflow" needs either the desktop feature-signal contract (ADR 0055, **paused**) to
  supply workflow labels, or a manager-defined workflow taxonomy. **Do not build a workflow
  entity under this plan** — record the requirement and its dependency; it is Future until a
  telemetry source exists (OQ-TMD-6).
- **T4.4 — Setup captures function/workflows/priorities (analysis §9).** Extend the workspace-
  setup stepper to let a manager state team function, approved tools, and current capability
  priorities — stored as org settings, feeding goal suggestions (P1) and the role→domain read
  (T4.1). Low risk; no per-person data.

### P5 — The operating habit (no new table)

Analysis §14/§15. The composers already exist; this surfaces them in-app and adds the ritual.

- **T5.1 — In-app AI Manager Brief (weekly).** Render `composeTeamBrief`'s existing aggregate
  output as a card at the top of the Command Center (today it only rides the digest email).
  Add the §5G verbs: what changed · why probably · which initiative influenced it · what didn't
  improve · which decision is required · what we recommend next. `Accept`/`Modify`/`Dismiss`/
  `Create initiative` actions wire to P2/P3.
- **T5.2 — In-app monthly review.** Surface `composeExecReport`'s narrative as a monthly
  in-app view (D12 kept email+export as the default for the *exec memo*; this is a *manager*
  review card, decide reuse-vs-new with the founder — OQ-TMD-7). Add goals/initiatives/decisions
  to the monthly summary.
- **T5.3 — Reminders + export.** Review-date reminders reuse the existing email lane machinery
  (`renewal_reminder_state` CAS pattern) — a `goal`/`initiative` review reminder with the same
  honest, transactional posture (D7: no opt-out for transactional). CSV/one-pager export reuses
  the board-CSV + exec-report export paths.
- **T5.4 — "Ask Revealyst" (deterministic, canned only — R5).** A fixed question list, each
  answered by an existing pure read; answers expose evidence, uncertainty, and "not enough
  evidence" explicitly (analysis §14). **No LLM, no free-text** (tripwire G7). Free-text Q&A is
  Future/gated (OQ-TMD-4).

---

## 4. Honesty, privacy, and tripwire guardrails (apply to every phase)

- **Invariant (b) — never fabricate a per-person number.** Goal progress, initiative early
  signals, depth/spread, and brief numbers all render measured values or withhold. No
  fabricated "now" / "0" where the truth is "no data yet."
- **Self-view wall.** `rec_interaction_state`, `recommendation_exposure`, personal coaching,
  and mission state stay self-view-only forever (V4 NOT-list) — a manager surface never reads
  them. Named participants (P2) live in a *new* manager-scoped table under its own ADR-0038-mold
  ADR (R4), not by widening a self-view table.
- **MIN_PEOPLE floor (=4) + count-only.** Every team aggregate (depth, spread, subgroup,
  coverage) is count-only, floored, and its row prop type carries no person id — a leak is
  structurally impossible, not merely discouraged.
- **Measured vs directional labeling** stays mandatory ("early read" / "measured"; "OTel"/
  "markers" remain banned UI words).
- **Tripwires (rule 7):** no formula DSL (goal metrics are a closed enum), no separate ML
  service / no LLM ("Ask Revealyst" is canned), no prompt-content ingestion in Team mode. Any
  drift files an ADR and stops.
- **Frozen paths:** `score_slug` values, `recommendation_catalog` shape, `src/db/schema/*`,
  `org-scope.ts` public API — each new table/namespace is additive and still trips the CI guard,
  so the ADR ships in the same PR.

---

## 5. Build sequence, gates, and workflow

1. **P0 first, standalone, mergeable.** No table, biggest perceived win, unblocks the empty
   slots. One PR chain (IA reorder → KPI row → confidence line → number hygiene → copy →
   over-explanation sweep), `/code-review` + fixes **before** `gh pr create` (merge-race).
2. **P1 → P2 → P3 in series** (table-bearing; serialize builds per §0). Each: `/kickoff` in
   plan mode → build against fixtures → own tests → three registrations → ADR in the same PR →
   `/code-review` + apply fixes → PR → verify CI check state **explicitly** (never pipe
   `gh pr checks` into `gh pr merge`) → merge on green → founder gate.
3. **P4/P5 last;** P4 is largely gated (non-eng data source), so ship only the engineering-live
   and no-per-person pieces; the rest is Future ledger, honestly excluded.
4. **Gates are evidence-based and founder-judged (rule 4):** each table-bearing phase produces
   a thin evidence pack (`/gate-check`), adversarially pre-reviewed by a reviewer that did not
   write it (`contract-guardian` + `adversarial-reviewer`). The founder judges the evidence.
5. **After every ADR/migration merge, the next phase rebases + renumbers** before its PR
   (rename the ADR, regen the migration via `drizzle-kit generate`, update refs).

---

## 6. Open questions for the founder (new rows added to `docs/product-signoffs.md`)

These are recorded as `OQ-TMD-*` rows (Pending) so the plan does not silently assume a product
call. **No table-bearing build proceeds past the phase that depends on its OQ until ratified.**

- **OQ-TMD-1** — Does the Command Center homepage restructure (analysis §4/§5) stay within
  D-TCI-5 ("grow the 5-card page, no new nav"), or does the founder want to reopen D-TCI-5 and
  add nav areas? *Default (this plan): stay within D-TCI-5 — restructure `/dashboard`, at most
  one new `MANAGER_NAV_ITEMS` entry for Initiatives if P2 needs a route.*
- **OQ-TMD-2** — May a manager-set team goal **bias** the recommendation ranking, or only
  display alongside it? *Default: display + tie-break only; never changes rec eligibility.*
- **OQ-TMD-3** — Approve the copy relabels, especially **Efficiency → "License utilisation"**
  (honesty motivated). *Default: proceed (labels only, slugs frozen).*
- **OQ-TMD-4** — "Ask Revealyst": canned-question set for V1 (approve the list), with free-text
  natural-language Q&A explicitly Future. *Default: canned only; no LLM.*
- **OQ-TMD-5** — Intervention effectiveness: descriptive before/after only, or a real holdout
  experiment (register in `EXPERIMENTS`)? *Default: descriptive, no causal claim.*
- **OQ-TMD-6** — "By workflow" breakdown (analysis §9): confirmed Future until a workflow
  telemetry source exists (tied to the paused D-DA-5/9)? *Default: Future; no workflow entity
  built now.*
- **OQ-TMD-7** — Monthly manager review: reuse the exec-report composer as an in-app card, or a
  new manager-specific composer? *Default: reuse `composeExecReport` output in a manager card.*

---

## 7. Non-goals (explicitly out of scope for this plan)

- A five-tab nav / new IA areas (R1 / D-TCI-5).
- Any LLM or formula DSL (R5 / tripwire G7).
- A workflow data model (T4.3 — Future, no telemetry source).
- Non-engineering role activation (gated on D-TCI-8 + the paused D-DA-5/9).
- Widening any self-view table to a manager surface (R4).
- Renaming score slugs or changing score math (R6).
- Live desktop/export ingest changes (D-DA-8, separate frozen-contract work).
