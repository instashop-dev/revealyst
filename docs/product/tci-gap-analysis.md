# Revealyst — Team Capability Intelligence Gap Analysis

**Date:** 2026-07-16 · **Proposal analyzed:** "Revealyst Team Capability Intelligence — Functionality and Feature Specification", v1.0 (attached document; every line is tagged `[INFERRED]` and it is **not founder-signed** — see §2)
**Repo baseline:** `main` at `72005e4` (post-W9-closure + U0–U3; migrations 0000–0035, ADRs 0000–0043)
**Method:** an 11-domain parallel specialist fan-out (read-only agents: product, privacy, architecture, data model, telemetry, metrics/cost, backend, frontend, UX, QA, docs/governance) derived 175 atomic requirements from the proposal and traced each one to repository evidence; the orchestrator reconciled disagreements and an adversarial reviewer fact-checked the result. Every status cites code, not documentation prose.

**Companion artifacts:**
- [tci-requirements.csv](tci-requirements.csv) — the requirements registry (175 atomic requirements, stable `TCI-*` IDs)
- [tci-traceability.csv](tci-traceability.csv) — per-requirement status + repository evidence
- [tci-gap-details.md](tci-gap-details.md) — the execution-ready appendix: full working detail (user value, required changes, data logic, backend/UI impact, privacy, dependencies, tests) for every non-Complete requirement

---

## 1. Executive summary

Of 175 atomic requirements: **24 Complete (14%) · 85 Partial (49%) · 25 Missing (14%) · 35 Conflicting (20%) · 6 Blocked (3%) · 0 Obsolete.**

Five findings shape everything below:

1. **The philosophy is already built.** Every TCI principle — capability over activity, growth over ranking (no leaderboards), explainability with confidence on every number, coaching not surveillance, cost kept separate from capability — is already Revealyst product law, founder-signed and in most cases *code-enforced* (banned-phrasing tests, the honesty engine that refuses to fabricate numbers, the Data Confidence disclosure framework). TCI's §14 "avoid ROI claims / rankings / opaque scores" guardrails are the repo's existing NOT-list. Where TCI describes *values*, Revealyst already lives them.

2. **One decision dominates the whole proposal: should a manager see named, per-person data?** TCI's centerpiece screens — the Capability Matrix (people × capabilities grid), the manager-facing member profile, the named Expert Directory, mentor matches, the per-member cost table — all assume a manager reads an individual's capability scores, evidence, and spend by name. The repo enshrines the exact opposite: per-person capability mastery is **self-view-only** (there is deliberately no manager read route — `src/db/org-scope/mastery.ts`, ADR 0036/0038), team views are **count-only with a MIN_PEOPLE floor**, and private-mode identity is **pseudonymized** (`assertTeamOnlyPseudonymized` runs at runtime). Roughly 20 of the 35 Conflicting requirements trace to this single collision. It is a **privacy-model decision for the founder**, not a set of UI tasks — the worked precedent for reversing such a stance is ADR 0038 (a founder-signed, self-view-only, purge-registered reversal). Until that decision is signed, every per-person manager surface stays unbuilt.

3. **Honest data limits the capability model.** Of TCI's seven universal dimensions, **Adoption is computable today**, Workflow Integration / Iteration / Learning Velocity are partially computable, and **Communication, Thinking, and Verification are not honestly measurable at all** — their proposed signals (prompt clarity, reasoning quality, fact-checking behavior) require reading prompt content, which is a hard product tripwire ("no prompt-content ingestion in Team mode") and contradicts TCI's own §2.4. Likewise, **all seven non-engineering role packs are data-blocked**: every connected source is a developer tool, and the honest non-engineering telemetry source (M365/Workspace) does not exist — an already-recorded gate (OQ-003/OQ-004). Scoring a marketing or HR user on dimensions with zero ingestible signal would fabricate numbers, which invariant (b) forbids.

4. **The buildable core is bigger than it looks.** A real `teams` + `team_members` entity already exists, team-level score rows exist, and the 5-card team dashboard already ships aggregate capability coverage, benchmarks, spend governance, and data trust. The honestly buildable TCI slice — richer aggregate Team Overview, growth/movement counts, an aggregate manager insight feed, internal benchmarks, weekly/monthly/quarterly manager reports, the Data Sources health panel, aggregate cost overview with allocation confidence, team settings — is mostly **Partial, not Missing**, and reuses shipped machinery (`composeExecReport`, `spend-governance.ts`, `capability-coverage`, `deriveAttention`, the SES + compare-and-set email lanes).

5. **Foundation gaps are real but narrow.** The genuinely new structural work is: a **manager role** (today org membership is only admin/member — no manager tier, no per-team manager assignment), **per-capability history** (no snapshot/trend storage exists, so "improving/declining" trends and coaching baselines cannot be computed yet), **team settings persistence**, and **§15 product-usage events** (the analytics pipeline emits only three events today; almost none of TCI's activation/engagement metrics are measurable). Each new org-scoped table is an L-effort item by law: ADR + tenant-isolation registration + purge registration.

**Bottom line:** adopt TCI's aggregate manager layer as an extension of the shipped 5-card team surface (large, safe, mostly Partial); put the per-person manager visibility question, the 5-level ladder, and the score-as-hero question in front of the founder as explicit sign-off rows; treat prompt-content dimensions and non-engineering role packs as excluded/blocked with honest substitutes; and do not add an 11-item navigation tree — fold TCI's screens into the existing surfaces as cards and drawers.

---

## 2. Provenance and the conflict-resolution rule

The TCI document is **an unsigned proposal, not product ground truth**. Every line carries an `[INFERRED, HIGH/MED]` tag, it names no author or repo path, and no `docs/product-signoffs.md` row ratifies it. [docs/Revealyst_Product_Spec_V4.md](../Revealyst_Product_Spec_V4.md) remains the product's ground truth.

**Resolution rule used throughout this analysis** (recorded here per the task instruction "resolve conflicts using the attached document and latest approved product docs; record assumptions"):

> Where the TCI proposal and the approved docs merely differ in vocabulary or emphasis, this analysis resolves toward TCI (it is the newer intent). Where a TCI ask **crosses a founder-signed decision, a frozen contract, a hard tripwire, or a named external gate**, the approved decision wins and the requirement is classified Conflicting or Blocked — building it first would require a new founder sign-off (a `product-signoffs.md` row and, for privacy reversals, an ADR in the ADR-0038 mold).

Six decisions need the founder before any Conflicting item is built; they are listed as pending rows in [docs/product-signoffs.md](../product-signoffs.md) (added by this analysis):

| # | Decision the founder must make | What it unblocks / kills |
|---|---|---|
| D-TCI-1 | May a manager see **named per-person capability data** (matrix, member profile, expert directory, mentor matches)? Default today: no — self-view-only. | ~20 Conflicting requirements across §6.2–§6.7 |
| D-TCI-2 | May a manager see **named per-person spend**? (TCI itself says admins must control this; the honest default is off.) | Per-member cost table, cost tab, spend-by-member |
| D-TCI-3 | Add a **manager role tier** (and optionally an executive/observer tier) to org membership? | The entire permission model TCI assumes (this one is a gap, not a privacy reversal — likely yes) |
| D-TCI-4 | Adopt TCI's **0–100 score + 5-level "inactive→expert" ladder**, or keep the shipped positive-first 4-band + demoted diagnostics? Recommendation: keep the 4-band; map TCI's levels onto it. | §4.3 ladder, §6.1 hero card, §7.1 IC hero |
| D-TCI-5 | Expand navigation into a **Team Intelligence area**, or keep the 5-card single-dashboard fold? Recommendation: keep the fold; add cards/drawers. | §5 navigation, several §6 screens |
| D-TCI-6 | Persist **per-capability team history** (a snapshot table) to power trends and coaching baselines? (A deliberate exception to compute-on-read; genuinely needed for §6.5 Growth and coaching impact.) | Trends, movement counts, coaching baselines |

**Standing gates that this analysis does not touch:** companion-in-team-orgs (W6-A) stays gated on the ~6-week dogfood clock running since 2026-07-14; non-engineering role expansion stays gated on an honest telemetry source (OQ-003/OQ-004). Nothing below proposes forcing either.

---

## 3. How to read this analysis

Plain-language status vocabulary (each requirement gets exactly one):

- **Complete** — exists in the repo today and satisfies the intent.
- **Partial** — some of it exists; the gap detail says exactly what's left.
- **Missing** — nothing exists yet; buildable without crossing any decision.
- **Conflicting** — the ask contradicts an approved decision or principle; needs a founder sign-off before it can even be scheduled (see §5).
- **Blocked** — an explicitly named external gate (dogfood clock, missing telemetry source) prevents it; do not force.
- **Obsolete** — the repo already solved the need a better, approved way. (Zero landed here — TCI is well-aimed; where it overlaps shipped work it usually *matches* it.)

Efforts use the repo's scale: **S** = a lib/UI PR · **M** = a new surface · **L** = a new table (ADR + tenant-isolation + purge registrations) · **XL** = a multi-surface program. Priorities: **P0** = foundation/decision, **P1** = first team-layer slice, **P2** = should-have, **P3** = later/deferred.

---

## 4. The one decision that dominates: manager visibility of individual data

This deserves its own section because it decides more than half the proposal's value and risk.

**What TCI assumes:** a manager opens a grid of team members × capabilities, clicks into any member's profile (capabilities, skills, growth, coaching, cost, notes), searches a directory of named experts, and assigns coaching to named people.

**What the repo enforces today (deliberately, with founder sign-off):**
- Per-person capability mastery (`user_capability_state`) has **no read path except the person's own view** — the org-scope namespace comment says a manager cannot reach another person's mastery, and the table is structurally excluded from the team-visible view (ADR 0036, ADR 0038 constraint 2).
- Team surfaces are **aggregate and count-only**, with any group smaller than the MIN_PEOPLE floor dropped entirely (never a suppressed-but-implied number), and row prop types that carry no person id — leaks are structurally impossible, not just discouraged.
- In private visibility mode, identity is **pseudonymized for everyone**; managed/full modes reveal names **workspace-wide**, not selectively to managers. "Managers see names, ICs see pseudonyms" is not even representable today.
- Coaching recommendations, interaction state, and the exposure log are all self-view-only by signed decision.

**Why this is not just caution:** the self-view-only boundary is the product's stated mechanism for voluntary individual adoption — the bottom-up bet the whole V4 pivot rides on. Reversing it changes what Revealyst *is* to the individual user.

**What to do with it:** this analysis does **not** recommend building or refusing it — that is D-TCI-1/D-TCI-2, the founder's call. It does recommend *how*: if signed, follow the ADR-0038 pattern (explicit founder-signed ADR, consent machinery in the visibility-mode framework, per-surface identity registration in `assertTeamOnlyPseudonymized`, purge + tenant registrations, and an authorization test matrix that proves an IC can never reach a peer's data). And it flags the honest middle path TCI itself half-endorses: **cohort-level coaching** (aggregate "3 people are forming on Verification" cards, MIN_PEOPLE-floored) delivers most of the manager value with no privacy reversal.

---

## 5. Conflict register

Twelve canonical conflicts; every Conflicting requirement in §7 maps to one of these. "Crosses" cites the approved side.

| # | TCI ask | Crosses | Disposition |
|---|---|---|---|
| C1 | Manager-facing per-person capability views (§6.2 matrix, §6.3 roster columns, §6.4 profile, §6.7 expert directory, §6.6 mentor matches, §6.9 `affectedUserIds`, §11 per-member notifications to managers) | Self-view-only mastery (ADR 0036/0038; `src/db/org-scope/mastery.ts`); count-only + MIN_PEOPLE team views; V4 NOT-list "no manager visibility into any individual recommendation/coaching/interaction state (code-enforced)" | Founder decision **D-TCI-1**; honest substitute: cohort/aggregate coaching cards |
| C2 | Per-person / per-role / per-model **dollar** breakdowns for managers (§6.8) | Aggregate-only spend surface; per-model dollars are not reported by any vendor (`spend-governance.ts` deliberately shows token volume, "NOT a dollar split"); invariant (b) — most spend is org-level and honestly unallocatable | **D-TCI-2** for per-person; per-model dollars **excluded** (would fabricate); allocated-vs-unallocated disclosure is the honest core to build |
| C3 | Prompt-content-derived signals: Communication/Thinking/Verification dimensions (§4.1), skill extraction (§9), a "prompt-level evidence" toggle (§6.12) | Hard tripwire: no prompt-content ingestion in Team mode; the collector is content-free by design; no content field exists anywhere | **Excluded** (not deferred). Verification gets an honest substitute: OTel edit-rejection/test-run markers where they exist |
| C4 | Seven non-engineering role packs + universal scores for every knowledge worker (§2.5, §4.2) | V4 NOT-list ("no non-engineering role libraries in MVP or V1"); OQ-003/OQ-004 gate — no honest telemetry source exists | **Blocked** on the recorded gate; architecture should stay role-agnostic (it already is — the capability graph is generic) |
| C5 | Manager as primary user; "Team Capability Intelligence" as the pitch (§1, §17) | V4 individual-first thesis — team/exec intelligence is a by-product, "never the pitch" | Adopt TCI's *value hierarchy* copy (it matches one-engine/three-lenses); keep the individual as the headline buyer |
| C6 | Top-level "Team Intelligence" nav with 11 sub-items; radar charts; matrix density toggles, column selectors, saved views, 10-filter panels (§5, §6) | Minimal-by-default product law; the W5 fold (~18 panels → 5 cards); founder D4 (fewer/larger cards); U0 IA; TCI itself concedes radar reads worse than bars | **Simplify**: extend the 5-card view with cards + drawers (**D-TCI-5**); aligned bars, no radar; cut saved views/density toggles from any first slice |
| C7 | 0–100 capability score as hero + 5-level "inactive→expert" ladder (§4.3, §6.1, §7.1) | Founder-ratified demotion of the raw 0–100 behind a "diagnostic details" expander; positive-first 4-band vocabulary ("never a competing ladder"); OQ-008 (breakdown of the existing band, not a new scoring system); "inactive/beginner" naming trips the anti-deficiency copy law | **D-TCI-4**; recommendation: map TCI's 5 levels onto the shipped 4-band + a count-only "not yet active" segment |
| C8 | Four-tier role model with role-scoped name visibility (§3) | Two-tier org role (admin/member); visibility modes are org-wide, not per-role | Mostly a **gap** (D-TCI-3 adds the manager tier); role-scoped *name* visibility remains a privacy-model change under C1 |
| C9 | `TeamCapabilitySnapshot` as a stored periodic table (§9) | Compute-on-read preference (`readDashboardView`); `score_results.computed_at` is rewritten nightly, so no stable history exists | **Partial adopt** (D-TCI-6): a deliberate, ADR'd history table is genuinely needed for trends and coaching baselines — the *need* is real even though the pattern deviates |
| C10 | Custom capability dimensions / importance weights per team (§6.12) | The no-formula-DSL tripwire — admin-defined scoring dimensions are exactly the banned DSL | **Excluded**; custom *labels* on existing capabilities are the safe subset |
| C11 | A manager-facing team product assumed buildable now (§1, §13) | W6-A companion-in-team-orgs founder gate (~6-week dogfood clock since 2026-07-14) | Per-person-in-team-org pieces **Blocked**; the aggregate layer does not need the gate |
| C12 | Team context (peer comparison) on the IC self-view (§7.3) | J1: one person vs a modeled peer curve is an unsupported comparison (deliberately not rendered); W6-A for team orgs | Blocked/deferred; team capability *priorities* (not comparisons) are the safe subset |

---

## 6. What already exists (the reusable foundation)

The single most useful output of the fan-out: the team layer would be assembled largely from shipped parts. The load-bearing reusables, by layer (each verified in code by a specialist; paths in [tci-traceability.csv](tci-traceability.csv)):

- **Entities:** `teams` + `team_members` (org-scoped, composite tenant FKs) — a real Team entity; `score_results` already supports `subject_level='team'`; `roles`/`role_assignments` (engineering seed) for role targeting; `audit_log` for manager-action trails; `metric_records` holds per-subject per-day spend facts.
- **Capability layer:** the relational capability graph (`domains`/`capabilities`/`capability_signals`/`capability_dependencies`) is already role-agnostic; `user_capability_state` + the pure `capability-state.ts` engine supply most of TCI's CapabilityScore fields (mastery, confidence tier + numeric, evidence count, per-signal components); `mastery.coverageCounts()` is the count-only aggregation template.
- **Engines:** `deriveAttention` + the seeded `recommendation_catalog` + `computeUtility` (deterministic, explainable coaching with "why this" lines); the maturity model with confidence tiers, plateau, and not-comparable handling; `usage-distribution.ts` (aggregate concentration with MIN_PEOPLE floor); `spend-governance.ts` (reported-vs-estimated spend, per-tool spend, per-model token volume, projections, model-mix trend); `recent-movement.ts` + `attribution-trend.ts` for growth movement.
- **Delivery:** the poller recompute slot (batch-once reads, person-count-independent); four SES email lanes with compare-and-set once-per-period idempotency; `composeExecReport`/`readExecReport` (monthly memo + HTML export); the RFC-4180 CSV serializer (`maturity-csv.ts`); the board CSV export.
- **Trust UX:** the Data Confidence card/drawer framework (an exact match for TCI §8's progressive disclosure spec); `EmptyState` (honest empty states); `ScoreCard`/`ScoreMeter`/axis meters; `SegmentBreakdown` (count-only distribution bar); `BenchmarkPanel`; config-driven, role-gated navigation (`nav-items.ts`).
- **Guard rails as test templates:** tenant-isolation completeness tripwire, purge-order tripwire (≥21-edge floor), MIN_PEOPLE floor tests, anti-gamification schema + banned-phrasing sweeps, shared-source parity tests, migration-equivalence guards, self-view-only tests, per-query perf guards, vitest-axe smokes.

---

## 7. Domain-by-domain findings

Requirement tables per domain; the full per-gap working detail lives in [tci-gap-details.md](tci-gap-details.md).

### 7.1 Product scope & principles (`TCI-PROD-*`)

TCI proposes a manager-facing "Team Capability Intelligence" layer where a manager reads each team member's capability profile, coaching, and cost — and where the product spans 10+ job functions via role packs. Revealyst V4 already enshrines most of TCI's *principles* (capability-over-activity, growth-over-ranking with no leaderboards, explainability/confidence tiers, coaching-not-surveillance, cost-separate-from-capability), and its "Later" scope bucket matches V4's Future ledger almost exactly. But two TCI pillars directly contradict founder-approved product law: (1) role packs beyond Engineering are on V4's NOT-list ("No non-engineering role libraries in MVP or V1") and gated Future because no honest telemetry source exists for non-dev tools; (2) the manager-facing *per-person* capability/coaching/matrix view contradicts the load-bearing self-view-only privacy model — V4's NOT-list literally forbids "manager visibility into any individual recommendation, coaching content, or interaction state (code-enforced)." TCI also reframes the manager as the primary user, whereas V4 is individual-first with team/exec intelligence as a by-product "never the pitch." The safe, buildable core of TCI is the aggregate team surface, which already exists as the 5-card Team Intelligence dashboard with count-only, MIN_PEOPLE-floored capability coverage.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-PROD-001 | Manager-facing team capability platform (product definition) | Partial | L | P1 |  |
| TCI-PROD-002 | Usage is an input; capability is the outcome | Complete | S | P1 |  |
| TCI-PROD-003 | Principle: capability over activity | Complete | S | P1 |  |
| TCI-PROD-004 | Principle: growth over ranking, no leaderboards | Complete | S | P1 |  |
| TCI-PROD-005 | Principle: explainability over opaque scoring | Complete | S | P1 |  |
| TCI-PROD-006 | Principle: coaching over surveillance; no prompt content by default | Complete | S | P0 |  |
| TCI-PROD-007 | Principle: universal core + role packs across 10+ job functions | Conflicting | XL | P3 |  |
| TCI-PROD-008 | Principle: capability and cost remain separate concepts | Complete | S | P1 |  |
| TCI-PROD-009 | MVP: team/workspace structure + manager permissions | Partial | L | P2 |  |
| TCI-PROD-010 | MVP: manager-facing per-person surfaces (Capability Matrix, Team Members, individual profile, Coaching Center, Skills & Experts) | Conflicting | XL | P3 |  |
| TCI-PROD-011 | MVP: aggregate team surfaces (Team Overview, Growth, insight feed, confidence disclosures) | Partial | M | P1 |  |
| TCI-PROD-012 | MVP: team + individual cost analytics | Partial | M | P2 |  |
| TCI-PROD-013 | MVP: manager reports (weekly team brief + monthly capability review) | Partial | M | P2 |  |
| TCI-PROD-014 | MVP 'Should Have': mentor matching, concentration risk, campaigns, benchmarks, role packs | Partial | L | P3 |  |
| TCI-PROD-015 | MVP 'Later' bucket alignment (external benchmarks, forecasting, custom frameworks, business-outcome linkage, org-wide) | Complete | S | P3 | Yes |
| TCI-PROD-016 | Initial release starts with the Engineering role pack | Complete | S | P1 | Yes |
| TCI-PROD-017 | Role-agnostic architecture so future packs slot in without redesign | Partial | M | P2 |  |
| TCI-PROD-018 | Initial release avoids ROI/productivity claims, rankings, opaque efficiency scores, invalid benchmarks, causal coaching-impact | Complete | S | P1 | Yes |
| TCI-PROD-019 | Reposition as 'AI Capability Intelligence & Growth Platform' with a manager layer | Partial | S | P2 |  |
| TCI-PROD-020 | Individual growth = foundation; team = manager layer; cost supports but does not replace capability | Complete | S | P1 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#product) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.2 Privacy & permissions (`TCI-PRIV-*`)

The TCI spec assumes a manager-facing world: a four-role permission model (Individual Contributor, Team Manager, Workspace Administrator, Executive/Observer), managers who by default see named team-member capability profiles, per-person costs, and private manager notes. The repo today is built on the exact opposite foundations. It has a two-tier org role (admin/member) with no "manager" or "executive" role (src/db/schema/core.ts:197). Individual capability mastery is deliberately self-view-only — there is NO manager read route for another person's capability profile (src/db/org-scope/mastery.ts:6-15, ADR 0036), and that table is structurally excluded from the team-visible view (ADR 0038 constraint 2). Identity is pseudonymized-team-only by default (src/lib/visibility.ts; assertTeamOnlyPseudonymized), and the three visibility modes reveal names workspace-wide to everyone, not selectively to managers (src/lib/visibility-playbook.ts). So the central TCI asks — manager sees named individual capability/cost/notes — are not small UI tasks; they are a fundamental reversal of the self-view-only + private-by-default privacy model and need founder-signed ADRs, new consent machinery, and a new manager-notes entity. A few TCI privacy guarantees (no unauthorized access, data-confidence disclosure everywhere, prompts never exposed) are already satisfied — often more strongly than TCI asks, since prompt content is never collected at all (docs/legal/what-we-collect page).

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-PRIV-001 | Four-role permission model | Partial | L | P0 |  |
| TCI-PRIV-002 | Manager sees named per-person capability profile by default | Conflicting | XL | P1 |  |
| TCI-PRIV-003 | Manager sees individual (named) cost analytics | Conflicting | L | P1 |  |
| TCI-PRIV-004 | Manager notes entity | Missing | L | P2 |  |
| TCI-PRIV-005 | Admin toggle: individual cost visible to managers | Missing | M | P2 |  |
| TCI-PRIV-006 | Granular Team Settings visibility toggles | Partial | M | P2 |  |
| TCI-PRIV-007 | Prompt-level evidence availability toggle | Conflicting | S | P1 |  |
| TCI-PRIV-008 | Raw prompt content hidden by default | Complete | S | P1 |  |
| TCI-PRIV-009 | Role-scoped name visibility (managers see names, ICs see pseudonyms) | Conflicting | L | P1 |  |
| TCI-PRIV-010 | Distinguish observed behavior vs score vs inference vs note vs missing data | Partial | M | P2 |  |
| TCI-PRIV-011 | Users understand what data contributes to their profile | Complete | S | P2 |  |
| TCI-PRIV-012 | Data-confidence disclosure wherever telemetry is incomplete | Complete | S | P1 |  |
| TCI-PRIV-013 | No implication of performance/productivity/employment quality | Partial | S | P1 |  |
| TCI-PRIV-014 | Users cannot access unauthorized individual data | Complete | S | P0 |  |
| TCI-PRIV-015 | Executive/Observer read-only aggregate role | Partial | L | P3 |  |
| TCI-PRIV-016 | Configurable retention & privacy settings | Partial | L | P3 |  |
| TCI-PRIV-017 | Admin configures permissions & assigns managers | Missing | L | P2 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#privacy) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.3 Architecture & team structure (`TCI-ARCH-*`)

The repo already has a real "team within a workspace" concept: an org (personal/team/system) IS the workspace, and inside it a `teams` table plus `team_members` groups tracked PEOPLE (not login users) for team-level score aggregation, admin-managed via a `/teams` page and a `teamsNamespace` repository. But it stops well short of what TCI §3/§5/§6.12/§9 assume. There is NO manager role (org membership is only `admin | member`, plus a separate platform-admin boolean), NO nested sub-teams/subgroups, NO per-team RolePack or capability configuration, and — most importantly — per-person capability mastery is DELIBERATELY self-view-only, so the manager-facing per-member capability view TCI is built around is a major privacy-model reversal, not a UI task. The proposed 11-item "Team Intelligence" nav also conflicts with the founder-held minimal-UX principle and the W5-H "dashboard-itis" fold that collapsed the team view to five cards on one `/dashboard` route. TeamCapabilitySnapshot as a materialized periodic table cuts against the repo's compute-on-read (`readDashboardView`) preference, and "custom capability dimensions" edges toward the banned formula-DSL tripwire. Net: teams/roles/capability-graph give a real foundation to reuse, but manager permissions, per-person manager visibility, RolePacks, and the nav expansion are the load-bearing gaps and conflicts.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-ARCH-001 | Team entity inside a workspace | Partial | S | P0 | Yes |
| TCI-ARCH-002 | Manager role and per-team manager assignment | Missing | XL | P0 |  |
| TCI-ARCH-003 | Manager-facing per-member capability view | Conflicting | XL | P1 |  |
| TCI-ARCH-004 | Individual-contributor self-view within a team org | Blocked | M | P1 |  |
| TCI-ARCH-005 | Executive / Observer read-only aggregate role | Missing | L | P3 |  |
| TCI-ARCH-006 | Sub-teams / subgroups (nested team hierarchy) | Missing | L | P2 |  |
| TCI-ARCH-007 | Workspace-admin team management and permission configuration | Partial | L | P1 |  |
| TCI-ARCH-008 | Team Intelligence top-level nav area (11 sub-items) | Conflicting | M | P2 |  |
| TCI-ARCH-009 | Manager-only navigation gating | Partial | S | P1 | Yes |
| TCI-ARCH-010 | Team entity data shape (managerIds, memberIds, rolePackIds, settings) | Partial | L | P1 |  |
| TCI-ARCH-011 | RolePack entity (versioned capability bundles, per-team enablement) | Partial | XL | P2 |  |
| TCI-ARCH-012 | Per-team Capability Configuration (enable caps, importance, custom labels/dimensions) | Missing | L | P3 |  |
| TCI-ARCH-013 | TeamCapabilitySnapshot entity | Conflicting | L | P2 |  |
| TCI-ARCH-014 | CapabilityDefinition universal vs role_specific categorization | Partial | M | P2 |  |
| TCI-ARCH-015 | New team-layer entities require frozen-contract ADR + three registrations | Partial | M | P0 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#architecture) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.4 Data model (`TCI-DATA-*`)

The repo already carries a surprising amount of the TCI data model, but under different names and with one deliberate, founder-signed constraint the spec ignores: per-person capability data is SELF-VIEW ONLY today (user_capability_state), so the whole manager-facing capability layer is a privacy-model change, not a UI add. On the schema: `teams`/`team_members` exist (so a "Team" is real), `capabilities` closely matches CapabilityDefinition, `user_capability_state` supplies most CapabilityScore fields (mastery, confidence, evidenceCount, per-signal breakdown), team-level `score_results` exist for the 3 frozen scores, spend lives as `metric_records` facts, and `audit_log` is an append-only manager-action trail. The main genuine gaps are: no persisted team capability snapshot / history (so per-capability trend, change, and coaching baselines cannot be computed today — and `score_results.computed_at` is rewritten each recompute, so it is not a version-change audit trail), no RolePack grouping (domains exists but engineering-only, and non-eng expansion is a separately gated item), no TeamSettings table, and no cost-allocation confidence/method modeling. Two hard conflicts: TCI's 5-level "inactive→expert" ladder contradicts the approved positive-first 4-band, anti-deficiency, "never a competing ladder" framing; and showing any individual's capability score to a manager reverses the self-view-only design and is entangled with the W6-A dogfood gate. Every new org-scoped table here is an L: it needs an ADR, a tenant-isolation SCOPED_READS entry, and a purge registration.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-DATA-001 | Per-capability score object (CapabilityScore) | Partial | M | P1 |  |
| TCI-DATA-002 | Five-level capability ladder (inactive→expert) | Conflicting | S | P1 |  |
| TCI-DATA-003 | Per-capability trend and change (period-over-period) | Missing | L | P1 |  |
| TCI-DATA-004 | Confidence always shown; low/medium/high band | Partial | S | P2 | Yes |
| TCI-DATA-005 | Manager-visible per-person capability score | Blocked | XL | P0 |  |
| TCI-DATA-006 | Team entity (Team) | Partial | M | P0 |  |
| TCI-DATA-007 | TeamSettings persistence | Missing | L | P1 |  |
| TCI-DATA-008 | RolePack entity | Partial | L | P2 |  |
| TCI-DATA-009 | CapabilityDefinition entity | Partial | S | P2 | Yes |
| TCI-DATA-010 | TeamCapabilitySnapshot entity | Missing | L | P1 |  |
| TCI-DATA-011 | CostAllocation entity | Partial | M | P2 |  |
| TCI-DATA-012 | Background calculation jobs for team entities | Partial | M | P2 |  |
| TCI-DATA-013 | Auditability record | Partial | M | P2 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#data) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.5 Telemetry & capability signals (`TCI-TEL-*`)

The TCI spec proposes seven "universal capability dimensions" (Adoption, Communication, Thinking, Iteration, Verification, Workflow Integration, Learning Velocity) plus eight role packs, and asks every knowledge worker to receive scores on all of them. The repo's telemetry can only honestly support a subset. Today Revealyst ingests from five DEVELOPER tools (GitHub Copilot, Cursor, Anthropic, OpenAI, Claude Code local/OTel — docs/connector-facts.md), producing 29 canonical metric keys in coding-usage families (adoption, tokens, spend, acceptance, agentic, output-shipped, OTel markers). The Adoption, Workflow-Integration and (internally-derived) Learning-Velocity dimensions are largely computable from what exists; Iteration is partial. But Communication, Thinking, and Verification as the spec defines them (clarity of prompts, reasoning quality, fact-checking/testing behaviour) can only be measured by reading prompt CONTENT, which is a founder-signed tripwire in Team mode — so those dimensions are Conflicting or Missing, not small tasks. All seven non-engineering role packs, and the promise of a universal model for non-developer roles, are hard-blocked: no M365/Workspace/CRM/design telemetry source exists (CLAUDE.md defers this explicitly). The §6.12 Data Sources panel (providers, sync status, last sync, member matching, allocation gaps, freshness) mostly EXISTS already as the connections page + reconcile surface + Data Confidence framework and mainly needs re-surfacing.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-TEL-001 | AI Adoption dimension signals | Complete | S | P1 | Yes |
| TCI-TEL-002 | AI Communication dimension signals | Conflicting | M | P2 |  |
| TCI-TEL-003 | AI Thinking dimension signals | Conflicting | XL | P3 |  |
| TCI-TEL-004 | AI Iteration dimension signals | Partial | M | P2 |  |
| TCI-TEL-005 | AI Verification dimension signals | Missing | L | P2 |  |
| TCI-TEL-006 | AI Workflow Integration dimension signals | Partial | M | P2 |  |
| TCI-TEL-007 | AI Learning Velocity dimension signals | Partial | M | P1 |  |
| TCI-TEL-008 | Engineering role-pack capability feasibility | Partial | L | P1 |  |
| TCI-TEL-009 | Non-engineering role packs (Product/Marketing/Sales/CS/HR/Finance/Operations) telemetry | Blocked | XL | P3 |  |
| TCI-TEL-010 | Team Settings → Data Sources health panel | Partial | M | P1 | Yes |
| TCI-TEL-011 | Member matching status + allocation-gap disclosure | Partial | S | P2 | Yes |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#telemetry) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.6 Metrics, cost & measurement (`TCI-MET-*`)

The TCI spec's §6.8 (Costs & Efficiency) and §15 (Success Metrics) are mostly buildable in spirit because Revealyst already has a strong, honesty-first cost stack — but two loud problems dominate. First, TCI's "individual cost table," "spend by team member," and "spend by role" ask managers to see per-person dollars; the repo deliberately keeps spend as an org-level aggregate (`src/lib/spend-governance.ts` sums to the whole org, and per-model dollars are explicitly NOT ingested — it shows token volume instead), and mastery/capability data is self-view-only, so a per-member manager cost view is a major privacy-model change, not a table. Second, most §15 "manager" metrics (opening Team Overview, viewing Capability Matrix, insight-card opens, report views, expert searches) have no events — the entire Analytics Engine pipeline (`src/lib/launch-events.ts`) emits only three events: landing_view, digest_return, companion_revisit. The good news: the "cost is never in capability scoring" law is already true and verifiable (the maturity band is built only from breadth/depth activity in `src/lib/maturity.ts`; spend is its own metric family and only feeds a separate, clearly-labeled "efficiency" cost-ratio score), and the "no opaque efficiency score / explainable classifications first" principle is already honored via the `efficiency` score, the `cost-efficient-usage` and `model-selection` capabilities, and careful not-ROI copy. New per-member efficiency classifications and manager engagement metrics are the real net-new work.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-MET-001 | Cost is never folded into capability scores | Complete | S | P0 | Yes |
| TCI-MET-002 | No opaque efficiency score; explainable classifications first | Partial | M | P2 |  |
| TCI-MET-003 | Team Cost Overview (aggregate spend, breakdowns, allocation confidence) | Partial | M | P1 |  |
| TCI-MET-004 | Spend by model shown as dollars | Conflicting | S | P2 |  |
| TCI-MET-005 | Per-member / per-role cost table visible to managers | Conflicting | XL | P2 |  |
| TCI-MET-006 | Honest cost-insight narratives (growth-vs-spend) | Partial | M | P2 |  |
| TCI-MET-007 | Cost insights must not recommend cutting access solely for being expensive | Partial | S | P2 |  |
| TCI-MET-008 | §15 Activation metrics for the team product | Partial | M | P1 |  |
| TCI-MET-009 | §15 Engagement metrics (manager active, insight opens, coaching action, report views, expert searches) | Partial | M | P1 |  |
| TCI-MET-010 | §15 Capability-outcome metrics | Partial | M | P2 |  |
| TCI-MET-011 | §15 Trust metrics (confidence coverage, explanation usage, dismissal, disputes, disclosure rate) | Partial | L | P2 |  |
| TCI-MET-012 | §15 Cost-outcome metrics | Partial | M | P2 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#metrics) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.7 Backend jobs, reports & notifications (`TCI-BE-*`)

The repo already has a mature background-calculation backbone that maps well onto TCI §9's job list: a nightly cron fans one queue message per org (src/worker.ts), the consumer runs a score recompute plus a parallel per-person capability-state reducer (src/poller/process.ts + src/scoring/recompute-capability-state.ts), and reports/notifications are delivered by SES email (src/lib/email.ts) with compare-and-set state tables for once-per-period idempotency. So "individual capability recalculation," "growth," "cost allocation," "concentration," and "coaching recommendation" all have honest analogues to reuse. The big gaps are the manager-facing side: there is NO team-snapshot persistence, NO skill-extraction or mentor-matching job, NO persisted ManagerInsight feed with a status lifecycle, NO in-app notification inbox (everything is admin email only, no per-member notifications), NO PDF export machinery anywhere, and NO quarterly report. Two hard blockers dominate: per-person capability/mastery is deliberately self-view-only today, so every manager-facing per-member calc job is a major privacy-model change, not a UI task; and skill extraction from prompt content collides head-on with the "no prompt-content ingestion in Team mode" tripwire. Companion-in-team-orgs (W6-A) is founder-gated on a dogfood clock, which blocks the per-person team data that most of these jobs need. The cheapest wins are reusing composeExecReport for the monthly/quarterly review and the existing CSV serializer for report tables.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-BE-001 | Individual capability recalculation job | Complete | S | P0 |  |
| TCI-BE-002 | Team aggregation + team capability snapshot persistence | Partial | L | P1 |  |
| TCI-BE-003 | Maturity/capability distribution by member counts | Partial | M | P1 |  |
| TCI-BE-004 | Growth / movement calculation | Partial | M | P2 |  |
| TCI-BE-005 | Skill extraction job | Conflicting | XL | P3 |  |
| TCI-BE-006 | Mentor matching job | Missing | XL | P2 |  |
| TCI-BE-007 | Concentration-risk detection (per-capability, configurable thresholds) | Partial | M | P2 |  |
| TCI-BE-008 | Coaching recommendation generation (manager-facing) | Partial | L | P1 |  |
| TCI-BE-009 | Cost allocation job (CostAllocation, per-user, method + confidence) | Partial | L | P2 |  |
| TCI-BE-010 | Manager insight generation + persisted feed with status lifecycle | Partial | L | P1 |  |
| TCI-BE-011 | Auditability store for scores/actions | Partial | L | P2 |  |
| TCI-BE-012 | Weekly Team Brief report | Partial | M | P2 |  |
| TCI-BE-013 | Monthly Capability Review report | Partial | M | P1 | Yes |
| TCI-BE-014 | Quarterly Capability Review report | Missing | M | P2 | Yes |
| TCI-BE-015 | PDF export | Missing | M | P3 |  |
| TCI-BE-016 | CSV export of underlying report/matrix tables | Partial | S | P2 | Yes |
| TCI-BE-017 | Scheduled / configurable report email delivery | Partial | L | P2 |  |
| TCI-BE-018 | Manager notification delivery + triggers | Partial | L | P2 |  |
| TCI-BE-019 | Member (individual) notification delivery | Missing | M | P2 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#backend) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.8 Screens & shared components (`TCI-FE-*`)

The TCI spec asks for an 11-item "Team Intelligence" navigation area with a per-person Capability Matrix, per-member manager-facing profiles, a manager Coaching Center, and an Expert Directory that names individuals. This runs head-on into two founder-approved decisions the repo already shipped: (1) the W5 "dashboard-itis" fold that deliberately collapsed ~18 team panels into exactly 5 cards on one /dashboard team view, with count-only segments and a MIN_PEOPLE floor, and (2) the rule that per-person capability/mastery is SELF-VIEW-ONLY — managers only ever see aggregate, count-only, floor-gated rollups (capability-profile-card.tsx, capability-coverage-card.tsx, segment-breakdown.tsx all say so in comments). So most of the diagnostic per-person screens are Conflicting, not merely Missing: building them reverses the consolidation and the privacy boundary, and several also depend on the W6-A companion-in-team-orgs dogfood gate (founder-gated since 2026-07-14). The pieces that ARE cleanly buildable are aggregate extensions of the existing 5 cards (a maturity-level distribution bar, more insight cards, cross-team benchmarks, report exports) plus the §8 shared components — where the repo already has strong matches (DataConfidence card/drawer, EmptyState, ScoreCard/ScoreMeter, config-driven nav). I inspected only frontend; the existence of a universal 7-dimension capability model and the Team/RolePack/CostAllocation backend entities is another specialist's domain and I treat them as assumptions.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-FE-001 | Top-level 'Team Intelligence' nav with 11 sub-items | Conflicting | S | P2 |  |
| TCI-FE-002 | Team Overview screen (aggregate summary) | Partial | M | P1 |  |
| TCI-FE-003 | Team Overview header controls (selectors + filters) | Missing | M | P2 |  |
| TCI-FE-004 | Universal capability profile (bars/radar) + single team capability score | Conflicting | M | P2 |  |
| TCI-FE-005 | Capability Matrix (people × capabilities grid) | Conflicting | XL | P3 |  |
| TCI-FE-006 | Team Members roster with per-member capability columns | Conflicting | L | P3 |  |
| TCI-FE-007 | Individual Team Member Profile (manager-facing) | Conflicting | XL | P3 |  |
| TCI-FE-008 | Team Growth screen (trend, movement, segments, coaching impact) | Partial | M | P2 |  |
| TCI-FE-009 | Coaching Center (manager assign/campaigns/mentor matches) | Conflicting | XL | P3 |  |
| TCI-FE-010 | Skills & Experts (inventory + named expert directory) | Conflicting | L | P2 |  |
| TCI-FE-011 | Manager Insights feed (prioritized narrative + dismiss/convert) | Partial | L | P2 |  |
| TCI-FE-012 | Benchmarks screen (team/role/cohort comparisons) | Partial | M | P2 | Yes |
| TCI-FE-013 | Reports UI (weekly/monthly/quarterly + export) | Partial | M | P2 | Yes |
| TCI-FE-014 | Shared: Capability Score Card + Capability Bar | Partial | S | P2 | Yes |
| TCI-FE-015 | Shared: Confidence Badge + Trend Indicator | Partial | S | P2 | Yes |
| TCI-FE-016 | Shared: Insight Card variants | Partial | S | P2 | Yes |
| TCI-FE-017 | Shared: Capability Detail Drawer | Partial | M | P2 |  |
| TCI-FE-018 | Shared: Data Confidence Disclosure (progressive) | Complete | S | P1 | Yes |
| TCI-FE-019 | Shared: Member Avatar Row | Conflicting | S | P3 |  |
| TCI-FE-020 | Shared: Empty State (honest, actionable) | Complete | S | P1 | Yes |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#frontend) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.9 UX, copy & user flows (`TCI-UX-*`)

The Individual AI Growth Companion the TCI spec builds on is already a mature, opinionated UX. My sections split cleanly: §2.2 (growth over ranking) and the honesty/never-fabricate UX laws are effectively SHIPPED — the companion is deliberately positive-first, level-forward, anti-gamification (founder-signed), with a strong honest-empty-state discipline and a purpose-built Data Confidence progressive-disclosure framework that already answers most of §2.3/§6/§8. The friction is in §7 and §12: the TCI spec's §7.1 "keep a capability SCORE as the hero" contradicts the shipped, founder-ratified decision (U1/D4) that demoted the raw 0-100 number behind an expander and made the maturity LEVEL + one next step the hero. §7.3 team-context-on-the-IC-view is Blocked on the W6-A companion-in-team-orgs dogfood gate, and the manager-facing pieces of Flows A/B/C (per-member capability detail, expert directory, per-person cost) require exposing per-person mastery to managers — a deliberate, self-view-only privacy model today, so those are Conflicting/Missing major changes, not screens to build. Flow D works for the self-driven path but its "manager-assigned development" half doesn't exist. Cross-cutting: the spec's radar charts, capability-matrix density toggles, and 10+ filter panels directly reverse the W5-H "18 panels → 5 cards" simplification and violate the minimal-by-default product law — recommend aligned bars and far fewer controls (the spec itself concedes radar is worse).

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-UX-001 | Growth-over-ranking framing as UX law | Complete | S | P1 |  |
| TCI-UX-002 | No leaderboards / employee rankings | Complete | S | P1 |  |
| TCI-UX-003 | Per-score explainability (signals, change, evidence, limitations, next action) | Partial | M | P2 |  |
| TCI-UX-004 | Never show a score without confidence + evidence availability | Partial | S | P2 | Yes |
| TCI-UX-005 | Insufficient-data / forming states never fabricate | Complete | S | P1 |  |
| TCI-UX-006 | Structured empty state (why / what's required / who resolves / effect) | Partial | S | P2 | Yes |
| TCI-UX-007 | Low-confidence values visually distinct | Partial | S | P2 |  |
| TCI-UX-008 | Data-confidence progressive disclosure | Complete | S | P1 |  |
| TCI-UX-009 | Individual capability SCORE as the hero metric | Conflicting | S | P1 |  |
| TCI-UX-010 | IC overview section set (universal + role-pack breakdown, assigned coaching) | Partial | M | P2 |  |
| TCI-UX-011 | Personal cost analytics on the IC view | Partial | M | P2 |  |
| TCI-UX-012 | Team context on the IC self-view (aggregates, priorities, mentors) | Blocked | L | P3 |  |
| TCI-UX-013 | Flow A end-to-end: manager identifies gap → campaign | Missing | XL | P2 |  |
| TCI-UX-014 | Flow B end-to-end: find an internal expert | Conflicting | XL | P3 |  |
| TCI-UX-015 | Flow C end-to-end: investigate high spend per member | Partial | L | P2 |  |
| TCI-UX-016 | Flow D end-to-end: individual reviews team-assigned development | Partial | M | P2 |  |
| TCI-UX-017 | Dense controls (radar, matrix density/column toggles, 10+ filters) vs minimal-by-default | Conflicting | M | P1 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#ux) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.10 Tests & acceptance criteria (`TCI-QA-*`)

TCI §16 is only five short acceptance blocks (Team Overview, Capability Matrix, Coaching Center, Costs, Privacy), but as a QA lead I read each block as "what test would prove this ships correctly?" — and most have no surface to test against yet because the team/manager layer is unbuilt. The repo already has strong, reusable test patterns I can point every acceptance block at: a registry-driven tenant-isolation completeness tripwire, an FK-ordered account-deletion purge tripwire with a ≥21-edge floor, MIN_PEOPLE floor tests, anti-gamification schema+copy sweeps, shared-source digest/dashboard parity, migration-equivalence guards, per-person self-view tests, and vitest-axe smokes. The single biggest QA gap is authz: today's route tests only cover signed-out (401), non-admin (403), and cross-org — there is NO manager-vs-member per-role authorization matrix, and the whole TCI spec hinges on one (IC / manager / admin / observer). The single biggest QA red flag is that §16 "Capability Matrix — a manager can compare all members across capabilities" plus the per-member profile directly contradict the founder-signed self-view-only model for capability/mastery state and the count-only MIN_PEOPLE team view — that is a privacy-model reversal, not a screen, and its acceptance test would have to overturn dashboard-privacy.test.ts. Finally, a team layer that roughly doubles the suite must tolerate the known Windows vitest-pool and pseudonym-collision flakes at higher volume.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-QA-001 | Team Overview one-screen acceptance test | Missing | M | P1 |  |
| TCI-QA-002 | Every score shows confidence + member coverage | Partial | S | P1 | Yes |
| TCI-QA-003 | Every primary insight deep-links to detail | Missing | S | P2 |  |
| TCI-QA-004 | Capability Matrix — manager sees every member's per-capability scores | Conflicting | XL | P0 |  |
| TCI-QA-005 | Low-confidence / insufficient-data cells visually distinct + every cell explainable | Partial | S | P2 |  |
| TCI-QA-006 | Coaching Center — insight→action, tracked to completion, baseline+follow-up stored | Missing | L | P1 |  |
| TCI-QA-007 | Costs — separate high spend from adoption/capability; cost never in scoring | Partial | M | P1 |  |
| TCI-QA-008 | Manager-vs-member per-role authorization sweep (NEW test infra) | Partial | L | P0 |  |
| TCI-QA-009 | Raw prompt content hidden by default | Complete | S | P2 |  |
| TCI-QA-010 | Manager notes cannot affect algorithmic scoring | Missing | L | P1 |  |
| TCI-QA-011 | Data limitations visible where they materially affect interpretation | Partial | S | P2 | Yes |
| TCI-QA-012 | Three-registration discipline for every new team table | Missing | XL | P0 |  |
| TCI-QA-013 | MIN_PEOPLE floor tests for every new team aggregate | Partial | M | P1 |  |
| TCI-QA-014 | Anti-gamification / banned-phrasing sweeps for all new team copy | Partial | S | P1 | Yes |
| TCI-QA-015 | Shared-source parity + migration-equivalence guards for team reuse | Partial | M | P2 |  |
| TCI-QA-016 | Suite scale + flake tolerance for the expanded team suite | Partial | M | P2 |  |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#qa) · evidence: [tci-traceability.csv](tci-traceability.csv)

### 7.11 Documentation & governance (`TCI-DOC-*`)

The TCI document is an unsigned proposal, not product ground truth: every single line is tagged [INFERRED] (HIGH/MED), it carries a bare "Document version: 1.0" with no provenance, no repo path, and no founder ratification. By the repo's own rules (CLAUDE.md rule 4, docs/product-signoffs.md), nothing here is decided until the founder signs it, and docs/Revealyst_Product_Spec_V4.md remains ground truth. Mechanically, the repo already has a house style for exactly this kind of work — docs/product/ (gap-analysis.md + requirements.csv + traceability.csv + implementation-roadmap.md), the superseded-banner pattern, ADR numbering (latest 0043, migrations independent, latest 0035), and the product-signoffs ledger — so the DOCS gap is filing discipline, not net-new invention. The substantive risk is that TCI, taken literally, crosses several founder-signed decisions and named external gates: a manager-facing per-person capability/cost view (contradicts self-view-only mastery, ADR 0036, and the count-only + MIN_PEOPLE + pseudonymized-private-mode privacy model), prompt-level evidence (crosses the hard "no prompt-content ingestion in Team mode" tripwire), eight non-engineering role packs (crosses NOT-015 + the OQ-003/004 role-expansion Future gate), a whole team product assumed live (blocked on the W6-A ~6-week dogfood clock), an 11-item nav tree (crosses the minimal-nav U0 IA and founder D4 fewer/bigger-cards decision), and a new inactive→expert level ladder + 0–100 capability score (crosses the "never a competing ladder / score demoted" decisions). The resolution rule the orchestrator set — adopt TCI only where it does not cross a founder-signed decision or gate — must itself be recorded, and each crossing needs a product-signoffs row before any build.

| ID | Requirement | Status | Effort | Priority | Quick win |
|---|---|---|---|---|---|
| TCI-DOC-001 | TCI is an unsigned proposal, not ground truth | Conflicting | S | P0 | Yes |
| TCI-DOC-002 | Gap analysis must follow the docs/product/ house style | Partial | M | P1 |  |
| TCI-DOC-003 | Superseded-banner + single-source-of-truth discipline | Partial | S | P1 | Yes |
| TCI-DOC-004 | Each new TCI entity needs an ADR + 3 registrations | Missing | XL | P1 |  |
| TCI-DOC-005 | Every conflicting TCI ask needs a product-signoffs row first | Missing | S | P0 | Yes |
| TCI-DOC-006 | Manager-facing per-person capability view crosses self-view-only | Conflicting | XL | P1 |  |
| TCI-DOC-007 | Named per-person team scores cross count-only + MIN_PEOPLE | Conflicting | L | P1 |  |
| TCI-DOC-008 | Manager-visible individual cost crosses privacy model | Conflicting | L | P2 |  |
| TCI-DOC-009 | Prompt-level evidence crosses the no-prompt-content tripwire | Conflicting | S | P0 | Yes |
| TCI-DOC-010 | Eight non-engineering role packs cross NOT-015 + role-expansion gate | Blocked | S | P2 |  |
| TCI-DOC-011 | Whole team product assumed live — blocked on W6-A dogfood clock | Blocked | S | P0 |  |
| TCI-DOC-012 | 11-item nav tree crosses minimal-nav U0 IA + D4 | Conflicting | M | P1 |  |
| TCI-DOC-013 | New inactive→expert ladder + 0–100 score cross 'no competing ladder' | Conflicting | M | P1 |  |
| TCI-DOC-014 | Repositioning to a manager-first platform crosses individual-first VIS-001 | Conflicting | S | P2 |  |
| TCI-DOC-015 | Record the orchestrator conflict-resolution rule | Missing | S | P0 | Yes |

Full per-gap detail: [tci-gap-details.md](tci-gap-details.md#docs) · evidence: [tci-traceability.csv](tci-traceability.csv)

---

## 8. Quick wins (31 flagged; the 12 that matter most)

Quick wins are S/M items that reuse shipped machinery and cross no decision. The full flag set is in [tci-requirements.csv](tci-requirements.csv) (`quick_win=yes`); the highest-leverage dozen:

| Win | What it is | Reuses |
|---|---|---|
| TCI-TEL-010/011 | "Data Sources" health panel: providers, sync status, last sync, member matching, allocation gaps, freshness | `connections-view.ts`, `data-confidence.ts`, reconcile surface — a re-surfacing job, not new telemetry |
| TCI-BE-014 | Quarterly Capability Review | `composeExecReport` over a 3-month window + one cron branch + a quarter compare-and-set claim |
| TCI-BE-013 | Monthly Capability Review enrichment (movement, coverage, concentration sections) | the shipped monthly exec memo pipeline |
| TCI-BE-016 | CSV export for team/cost tables (aggregate only) | `maturity-csv.ts` serializer + existing route pattern |
| TCI-FE-018/020, TCI-UX-006 | §8 Data Confidence Disclosure + honest Empty State | already shipped — map, don't rebuild (extend EmptyState to the four-field structure) |
| TCI-UX-004 / TCI-QA-002 | Per-score confidence badge so no score ever renders without confidence + coverage, plus the render test that enforces it | `confidenceTierLabel` vocabulary + data-confidence framework |
| TCI-MET-001 pin | A regression test asserting no spend/model-mix key ever reaches maturity/capability scoring | `maturity.ts` axis inputs — locks in a §16 acceptance criterion today |
| TCI-QA-014 | Banned-phrasing + anti-gamification sweep extended over all future team/benchmark copy | the missions/curriculum copy-test pattern |
| TCI-ARCH-001 + settings | Team Structure settings (name, members) | `teamsNamespace` CRUD — no new table |
| TCI-FE-012 | Benchmark rows (team vs previous period, vs workspace) | existing `BenchmarkPanel` |
| §15 partials | Coaching action rate + dismissal rate | `recEngagementRollup` counts-only rollup, printable today |
| TCI-DATA-004 | low/medium/high confidence band derivation | pure function over stored `user_capability_state.confidence` |

## 9. Recommended sequencing

**Phase 0 — decisions and paper (days; no build).** File this analysis; add the six D-TCI pending rows to `product-signoffs.md` (done in this PR); founder signs or kills D-TCI-1…6. Nothing Conflicting is scheduled before its row is signed. *(Critical path: D-TCI-1/D-TCI-3 decide the shape of everything manager-facing; D-TCI-6 decides whether trends are buildable.)*

**Phase 1 — quick wins + guard rails (parallel-safe; no gates; mostly S).** The §8 table above. Also: the scoring-input-isolation test, the §15 instrumentation seam decision (which manager events to emit through the existing Analytics Engine pipeline). Everything here is safe regardless of how D-TCI-1…6 land.

**Phase 2 — team-layer foundation (needs ADRs; no privacy reversal).** In dependency order:
1. **Manager role tier** (D-TCI-3): extend org membership; per-team manager assignment table (L); the manager-vs-member authorization test matrix (the QA fan-out's #1 infrastructure gap).
2. **Team settings** persistence (L) — visibility toggles default-off, admin-controlled.
3. **Per-capability history** (D-TCI-6, L): an append-only periodic rollup keyed by (team, capability, period) with represented-member counts — the substrate for trends, movement counts, and coaching baselines. Without it, §6.5 Growth and every "improving/declining" arrow stays unbuildable.
4. **Aggregate Team Overview enrichment** (M): maturity distribution bar (count-only), ≤4 priority insight cards, growth chart from #3, coaching-queue preview at cohort grain, data-freshness header.
5. **Aggregate manager insight feed** (L): persisted, count-only insights with a new/viewed/acted/dismissed lifecycle; categories that need no person id (capability gap, plateau, concentration, low adoption, data incomplete).
6. **Weekly Team Brief** (M): a manager digest lane on the existing SES + CAS backbone.
7. **§15 instrumentation** (M): manager-engagement events (overview viewed, insight opened, report viewed) through the worker seam.

**Phase 3 — founder-gated (only what got signed).** If D-TCI-1 signs: the ADR-0038-mold ADR, consent machinery in the visibility framework, then a *simplified* member view (profile before matrix; the matrix is XL and reads worst) plus cohort→named coaching actions and manager notes (L, purge-registered, never feeds scoring — pin with a test). If D-TCI-2 signs: the admin cost-visibility toggle, then a per-member cost table honestly labeled with allocation confidence. If W6-A clears: companion-in-team-orgs, which unlocks IC "team context" and assigned-development flows (Flow D's manager half).

**Phase 4 — deferred/excluded (do not build).** Prompt-content dimensions and skill extraction (excluded — tripwire); non-eng role packs (blocked — OQ-003/004); external benchmarks, forecasting, custom capability dimensions (excluded — DSL tripwire), business-outcome linkage, org-wide intelligence (all deferred to the Future ledger, where TCI's own "Later" bucket already agrees); PDF export (Workers cannot render PDFs in-process; the print-friendly HTML export is the substitute until a Browser Rendering binding is justified).

**Parallelizable:** Phase 1 is embarrassingly parallel. In Phase 2, items 2/4/6/7 can run in parallel once 1 lands; 3 gates 4's growth chart and 5's trend-based categories. The known trap for this repo (recorded twice in CLAUDE.md): parallel workstreams that each add tables collide on migration/ADR numbers — serialize the *builds* of 1/2/3/5, not just the merges.

## 10. Risks

1. **Privacy-model whiplash** (high). Shipping any per-person manager surface without the D-TCI-1 ADR breaks the product's central trust promise and several code-enforced tests. Mitigation: the decision gate + the authorization matrix before any surface.
2. **Fabricated numbers under pressure** (high). Per-model dollars, per-member allocated spend, and universal dimensions for non-instrumented users are all one eager PR away from an invariant-(b) violation. Mitigation: the honesty patterns are already code (ratio-omission, null-over-guessing); the Phase-1 pin tests make regressions loud.
3. **Dashboard-itis regression** (medium). TCI's 11 screens × filters would reverse the W5 fold. Mitigation: D-TCI-5 default = extend 5 cards; every new control needs a "why can't this be a drawer" answer.
4. **History table drift** (medium). A snapshot table that disagrees with compute-on-read outputs would create two truths. Mitigation: derive snapshots from the same pure functions the dashboard uses (shared-source parity test, the digest/dashboard pattern).
5. **Suite scale** (low). The team layer roughly doubles the test suite on a machine with known Windows flakes. Mitigation: keep per-person query independence (perf-guard pattern), tolerate-and-rerun policy documented in CLAUDE.md.

## 11. Simplify / defer / exclude register

- **Simplify:** 11-item nav → cards/drawers on existing surfaces · radar → aligned bars (TCI agrees) · matrix → start with the member profile, if D-TCI-1 signs at all · 10-filter panels → 2–3 filters · saved views/density toggles → cut · 5-level ladder → map onto the shipped 4-band · TeamCapabilitySnapshot → one append-only history rollup, not a parallel scoring system.
- **Defer:** scheduled/configurable report delivery (fixed crons first) · mentor matching (needs per-person visibility + workload data that doesn't exist) · coaching campaigns (needs coaching actions first) · executive/observer role (private-mode aggregates already serve the need) · in-app notification inbox (email lanes first).
- **Exclude:** prompt-content signals and any "prompt-level evidence" toggle · per-model dollar splits · custom capability dimensions/weights · external benchmarks without valid comparison data · a single blended "AI Efficiency Score" (TCI itself forbids it) · any leaderboard/ranking rendering of benchmarks.

## 12. Assumptions ledger

1. TCI "workspace" = the repo's org (`kind='team'`); TCI "team" = the existing `teams` table (groups of tracked *people*, not login users). Multi-team-per-workspace therefore already has a data home; the manager *relation* does not.
2. TCI "members" are tracked people (mostly non-login); "assign a manager" means linking a team to a login user — a relation that does not exist today.
3. TCI's 0–100 "score" and the repo's 0–1 "mastery" are the same concept on different scales; the scale/ladder question is D-TCI-4, not assumed.
4. "Confidence low/medium/high" maps onto the existing measured/directional/insufficient tiers — a vocabulary mapping, not a rebuild.
5. The seven-dimension universal model is treated as a *presentation* over capabilities bound to honest signals — not a new scoring engine. Dimensions whose signals don't exist render as "not yet measurable," never as fabricated zeros.
6. Notifications are acceptable as email-first (no in-app inbox exists); member notifications that stay within self-view need no privacy decision.
7. The analysis grain is ~175 consolidated requirements, not TCI's ~230 raw bullets; consolidation mappings are visible in each requirement's quoted text + section pointer.
8. CLAUDE.md's wave ledger is stale at "latest ADR 0041"; the repo actually contains ADRs through 0043 (`0043-rec-interaction-clear-action.md`) — this analysis uses the verified 0043 as the next-free baseline (first new ADR = 0044) and flags the CLAUDE.md line as stale.
9. Specialists disagreed on effort for a few overlapping items (e.g., the insight feed L vs M); this document records the more conservative grade.

---

*Analysis produced by an 11-domain parallel agent fan-out orchestrated per the fleet workflow (rules 3–4: specialists did not review their own domains' prose; an adversarial pass fact-checked claims against code). Statuses describe `main` at `72005e4` (2026-07-16) and go stale as code ships — trust the cited code over this prose.*
