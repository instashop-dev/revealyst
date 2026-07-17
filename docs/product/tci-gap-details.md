# Team Capability Intelligence — Gap Details (execution-ready appendix)

> **Status update (2026-07-17):** pinned to `main` = `72005e4`; see the status banner in
> [tci-gap-analysis.md](tci-gap-analysis.md) for the TCI slice that has shipped since
> (ADRs 0044–0046, 0050–0051; migrations 0036–0041) and is not reflected in the
> per-requirement detail below.

> Companion to [tci-gap-analysis.md](tci-gap-analysis.md) — read that first. This file holds the full
> per-gap working detail (value, changes, data logic, impact, privacy, dependencies, tests) for every
> requirement that is not already Complete. Requirement registry: [tci-requirements.csv](tci-requirements.csv);
> per-requirement code evidence: [tci-traceability.csv](tci-traceability.csv).
> Statuses here describe the repo at main `72005e4` (2026-07-16) and go stale as code ships — trust the cited code over this prose.
>
> Citations of the form `tci.md:NNNN` point into the attached TCI proposal document (v1.0), which is
> deliberately **not** committed to the repo (it is an unsigned external proposal — see the gap
> analysis §2). Use the quoted requirement text + TCI section number (`§n.n`) as the stable reference;
> the full requirement wording is preserved in [tci-requirements.csv](tci-requirements.csv).

<a id="product"></a>
## Product scope & principles

### TCI-PROD-001 — Manager-facing team capability platform (product definition)

**Partial** · effort L · priority P1 · risk high

> Extend the individual companion into a manager-facing platform where a manager can understand, improve, and distribute AI capability across their team, answering six manager questions (team capability level; strong/weak/improving/declining capabilities; who needs coaching; who can mentor; where expertise is concentrated; is spend producing growth). *(TCI §1)*

- **What exists today (evidence):** docs/Revealyst_Product_Spec_V4.md:64 (product = AI Growth Platform, team/exec intelligence is a by-product); :116 (P2 manager JTBD exists); src/app/(app)/dashboard/team-overview.tsx:329-342 (team surface exists but aggregate/count-only); tci.md:11-23
- **Why users want it:** A manager gets one place to see whether their team's AI capability is broad or fragile and where the bottleneck is.
- **What has to change:** Some manager questions are already answerable at the AGGREGATE level (team AI health, capability coverage, concentration/champion-dependence, spend vs growth). The 'who needs coaching' and 'who can mentor' questions require reading per-person capability — which is a self-view-only surface today. Recommend: build the aggregate manager questions fully; treat any per-person manager read as a separate, gated privacy-model decision (see TCI-PROD-011), not part of the base definition.
- **Data & metric logic:** Aggregate team rollups already read user_capability_state coverage counts (team-overview.tsx:336) and maturity (src/lib/maturity.ts); the two per-person questions have no privacy-approved read path.
- **Backend/API & UI impact:** Backend: reuse existing team rollup reads. UI: extend the 5-card team surface. No new per-person exposure without an ADR.
- **Privacy & permissions:** Per-person manager reads collide with the self-view-only model; must not be smuggled into the product-definition scope.
- **Dependencies & migrations:** Companion-in-team-orgs (W6-A) is founder-gated on the ~6-week dogfood clock (since 2026-07-14) — the richer team experience depends on that outcome.
- **Tests & acceptance:** Acceptance: a manager can answer the aggregate four questions on the team surface without any per-person capability number rendering; assertTeamOnlyPseudonymized still passes in private mode.

### TCI-PROD-007 — Principle: universal core + role packs across 10+ job functions

**Conflicting** · effort XL · priority P3 · risk high

> Revealyst should work across engineering, product, marketing, sales, customer success, operations, finance, HR, design, legal and other knowledge-work teams — a shared universal capability model plus role packs adding domain-specific criteria. *(TCI §2.5)*

- **What exists today (evidence):** CONTRADICTS docs/Revealyst_Product_Spec_V4.md:653 ('No non-engineering role libraries in MVP or V1'), :616-618 (role expansion beyond Engineering is Future, evidence-gated — no honest telemetry source exists for non-eng tools; the only org-wide cross-role capture is a browser extension, a permanent tripwire), :72 (the wedge stays Engineering); only the 'engineering' domain is seeded (drizzle/0030_capability-graph.sql:55). tci.md:65-69, 267-409
- **Why users want it:** Managers of non-engineering teams could assess AI capability too.
- **What has to change:** Do NOT build the 8+ non-engineering role packs in the TCI MVP. There is no privacy-honest data source for marketing/sales/HR/finance/etc. AI usage (no admin API; browser-extension capture is a standing tripwire). Recommend: keep the universal-core + role-pack ARCHITECTURE (already extensible via the relational capability graph) but ship only the Engineering pack until an honest telemetry source is proven for a second role (V4 §16 research question).
- **Data & metric logic:** Role packs need per-role telemetry bindings; capability_signals today bind only to engineering-tool signals already ingested.
- **Backend/API & UI impact:** Building 10 packs now would ship capability scores with no honest data behind non-eng roles — an invariant-(b) fabrication risk.
- **Dependencies & migrations:** Blocked on the M365 Copilot / Google Workspace admin-API research question (Spec V4 §16) before any non-eng pack has an honest source.

### TCI-PROD-009 — MVP: team/workspace structure + manager permissions

**Partial** · effort L · priority P2 · risk medium

> MVP must-haves include team creation and membership and manager permissions (managers distinct from workspace admins; sub-teams/subgroups within a workspace). *(TCI §13)*

- **What exists today (evidence):** roles/role_assignments exist but are an engineering-capability seed, not a team-management RBAC (drizzle/0026_roles-entity.sql); visibility modes + platform admin exist (CLAUDE.md); but Revealyst's org == one team (personal = org of one) — no multi-team-within-workspace or subgroup grouping today; tci.md:2103-2107
- **Why users want it:** An admin can carve a workspace into teams and assign a manager to each.
- **What has to change:** Add a team/subgroup grouping entity within an org and a manager role scoped to a subset of members. This is net-new relational structure, not a UI tweak. Keep it minimal (one manager-of-subset relation) rather than TCI's full workspace/team/subgroup hierarchy.
- **Data & metric logic:** Needs a team-membership + manager-assignment table, org-scoped.
- **Backend/API & UI impact:** New table(s), org-scoping, and manager-scoped read predicates threaded through the team surface.
- **Privacy & permissions:** Manager scope must not become a back-door to per-person capability reads (see TCI-PROD-011).
- **Tests & acceptance:** tenant-isolation SCOPED_READS + purge registration + ADR for any new org-scoped table.

### TCI-PROD-010 — MVP: manager-facing per-person surfaces (Capability Matrix, Team Members, individual profile, Coaching Center, Skills & Experts)

**Conflicting** · effort XL · priority P3 · risk high

> MVP must-haves include a Capability Matrix (members × capabilities), a Team Members roster with per-person capability, a manager-facing individual profile, a Coaching Center where managers assign coaching to individuals, and a Skills & Experts directory naming individuals. *(TCI §13)*

- **What exists today (evidence):** CONTRADICTS docs/Revealyst_Product_Spec_V4.md:119-123 (self-view-only is 'the mechanism' that makes voluntary use possible; assertTeamOnlyPseudonymized, src/lib/visibility.ts), :641-642 ('No manager visibility into any individual recommendation, coaching content, or interaction state (code-enforced)'); user_capability_state is self-view-only (CLAUDE.md P2); team-overview.tsx:336 caps the manager to count-only, no per-person data. tci.md:651-843, 2115-2119
- **Why users want it:** Managers could see exactly which member is weak where and coach them directly.
- **What has to change:** This is the central conflict, and per the task framing it is a MAJOR privacy-model change, not a UI feature. Do NOT build a manager-facing per-person capability matrix / roster / profile / coaching assignment / named expert directory in the TCI MVP as specified. If pursued at all, it requires a founder-signed ADR reversing self-view-only, opt-in from each member, and a re-audit of assertTeamOnlyPseudonymized. Recommend: keep the manager surface aggregate (coverage counts, concentration risk, floored champions) and route individual coaching through the person's own self-view.
- **Data & metric logic:** There is deliberately no manager read route over user_capability_state, recommendation_exposure, or rec interaction state.
- **Backend/API & UI impact:** Reverses a code-enforced privacy boundary across scoring, coaching, and the visibility audit surface.
- **Privacy & permissions:** Direct violation of the self-view-only posture that V4 calls load-bearing for voluntary use.
- **Dependencies & migrations:** Blocked: would need a privacy-reversal ADR + founder sign-off + likely the W6-A dogfood outcome first.
- **Tests & acceptance:** Any such build must keep private-mode teams pseudonymized and prove no per-person capability leaks via /api/*.

### TCI-PROD-011 — MVP: aggregate team surfaces (Team Overview, Growth, insight feed, confidence disclosures)

**Partial** · effort M · priority P1 · risk low

> MVP must-haves include a Team Overview, a team Growth screen, a manager insight feed, and confidence/data-quality disclosures. *(TCI §13)*

- **What exists today (evidence):** src/app/(app)/dashboard/team-overview.tsx (5 card sections incl. count-only capability coverage :336-342, floored segments, plateau verdict); maturity model + /maturity; src/lib/data-confidence.ts (confidence disclosures); CLAUDE.md (Team Intelligence folded ~17→5 cards); tci.md:481-649, 2129-2131
- **Why users want it:** A manager sees a 30-second aggregate read of team capability, priorities, and data quality.
- **What has to change:** Team Overview + confidence disclosures largely exist; the aggregate 'insight feed' is thin (synthesis lives in narrative, not a manager-facing feed) and a dedicated team Growth-over-time chart is limited. Extend the existing 5-card surface rather than adding TCI's separate Overview/Growth/Insights screens — the consolidation-to-5-cards is founder direction (D4).
- **Data & metric logic:** Reuse maturity trend + coverage counts; keep count-only + MIN_PEOPLE floor.
- **Backend/API & UI impact:** UI extension of the existing team surface; no new per-person exposure.
- **Privacy & permissions:** Must stay count-only / floored.
- **Tests & acceptance:** Cards render count-only, capabilities below MIN_PEOPLE dropped entirely.

### TCI-PROD-012 — MVP: team + individual cost analytics

**Partial** · effort M · priority P2 · risk medium

> MVP must-haves include individual and team cost analytics, with admin-controlled visibility of individual cost to managers. *(TCI §13)*

- **What exists today (evidence):** Spend Governance shipped (budgets, threshold alerts, drill-down, email alerts) — docs/Revealyst_Product_Spec_V4.md:575, :595; cost is kept separate from capability (:678); but manager-facing PER-INDIVIDUAL cost with an admin visibility toggle is not built and touches the self-view boundary; tci.md:2127, 1997
- **Why users want it:** A manager understands team spend and (where permitted) per-person spend alongside capability.
- **What has to change:** Team-level spend exists; a per-person cost table visible to managers needs the same admin-visibility-gate + privacy decision as TCI-PROD-010. Keep cost strictly out of capability scoring (already enforced) and never recommend cutting access solely for expense (TCI §6.8 rule, matches V4 no-ROI stance).
- **Data & metric logic:** Cost allocation + allocation-confidence surfacing already partly exists via budgets; per-person allocation to a manager view is new.
- **Privacy & permissions:** Individual cost visibility to a manager is an admin-configurable exposure — treat as a privacy setting, not a default.

### TCI-PROD-013 — MVP: manager reports (weekly team brief + monthly capability review)

**Partial** · effort M · priority P2 · risk medium

> MVP must-haves include weekly and monthly manager reports summarizing changes, risks, coaching priorities, emerging experts, and data-quality issues. *(TCI §13)*

- **What exists today (evidence):** Weekly digest shipped but it is the INDIVIDUAL self-view delivery vehicle (docs/Revealyst_Product_Spec_V4.md:597; src/poller/digest.ts); monthly Executive narrative memo shipped at org level (composeExecReport, /api/exec-report — CLAUDE.md); a manager-scoped weekly TEAM brief is not built; tci.md:2133, 1503-1535
- **Why users want it:** A manager gets a recurring team summary without opening the app.
- **What has to change:** Reuse the SES sender + exec-narrative composition to add a manager-scoped weekly/monthly team brief, but source it from AGGREGATE team data only (no per-person capability/coaching lines), or it inherits the TCI-PROD-010 conflict.
- **Data & metric logic:** Reuse narrative.ts + maturity + coverage counts.
- **Privacy & permissions:** Brief must be aggregate/floored, not a per-person digest to the manager.

### TCI-PROD-014 — MVP 'Should Have': mentor matching, concentration risk, campaigns, benchmarks, role packs

**Partial** · effort L · priority P3 · risk medium

> Should-haves include mentor matching, knowledge-concentration risk, coaching campaigns, benchmark comparisons, saved views, scheduled reports, and role-specific packs. *(TCI §13)*

- **What exists today (evidence):** Concentration/champion-dependence exists in V4 (docs/Revealyst_Product_Spec_V4.md:762) and the team surface (team-overview.tsx concentration/champion floor); within-org percentile benchmark lens exists (:596); but mentor matching + coaching campaigns require naming individuals (self-view conflict) and additional role packs conflict with TCI-PROD-007; tci.md:2135-2149
- **What has to change:** Ship the aggregate/floored pieces (concentration risk, within-org benchmarks). Defer mentor matching + campaigns (they name individuals — same privacy gate as TCI-PROD-010) and additional role packs (same gate as TCI-PROD-007).
- **Privacy & permissions:** Mentor/expert naming collides with pseudonymized private mode + MIN_PEOPLE floor.

### TCI-PROD-017 — Role-agnostic architecture so future packs slot in without redesign

**Partial** · effort M · priority P2 · risk low

> The architecture and UI must remain role-agnostic so additional role packs can be added without redesigning the team product. *(TCI §14)*

- **What exists today (evidence):** The capability graph is a relational, extensible reference model (domains/capabilities/capability_signals) — architecturally role-agnostic (drizzle/0030_capability-graph.sql; CLAUDE.md P1); but the shipped UI/copy is engineering-shaped (companion-glossary, exec-report-copy) and no role-agnostic team product exists yet; tci.md:2169
- **What has to change:** The data layer is already role-agnostic; the gap is a role-neutral team UI. No new tables needed — this is a UI/copy discipline requirement to avoid hard-coding engineering vocabulary into any new team surface.

### TCI-PROD-019 — Reposition as 'AI Capability Intelligence & Growth Platform' with a manager layer

**Partial** · effort S · priority P2 · risk medium

> Position Revealyst as an AI Capability Intelligence and Growth Platform, with Team Intelligence as the manager layer on top of individual growth. *(TCI §17)*

- **What exists today (evidence):** V4 already positions as the 'AI Growth Platform' with one-engine/three-read-lenses (docs/Revealyst_Product_Spec_V4.md:64-66, :85-86); the §17 value hierarchy (activity→behavior→skills→growth→team readiness→efficiency→business impact) matches V4's compounding model; BUT V4 is emphatic that team/exec intelligence is a by-product 'never as the pitch' (:64), whereas TCI foregrounds the manager as primary user (tci.md:5, 2287-2321)
- **Why users want it:** A clear market position spanning individual and team.
- **What has to change:** The 'Capability Intelligence & Growth Platform' naming and the value hierarchy are compatible with V4 and mostly a copy/positioning update. The conflict is emphasis: do not make the manager the headline buyer or lead with the team layer — V4's individual-first, voluntary-use thesis is load-bearing for the privacy model. Keep team as the by-product tier.

<a id="privacy"></a>
## Privacy & permissions

### TCI-PRIV-001 — Four-role permission model

**Partial** · effort L · priority P0 · risk high

> Support four distinct roles — Individual Contributor, Team Manager, Workspace Administrator, Executive/Observer — each with its own data-access scope. *(TCI §3)*

- **What exists today (evidence):** src/db/schema/core.ts:197-199 defines org_members.role as enum ['admin','member'] only; src/lib/api-context.ts:64 threads ctx.role from that two-tier value. No 'manager' or 'executive' role or per-role scoping exists.
- **Why users want it:** Managers, admins, executives, and individual contributors each see only what their job needs — the basis for every other permission rule.
- **What has to change:** Extend the org membership role model beyond admin/member to add Manager and Executive/Observer, or introduce a separate manager-assignment/team-manager mapping. This is a frozen-schema change (core.ts) so it needs an ADR plus gating updates at every page/API choke point that reads ctx.role. Recommend scoping to the minimum needed (Manager + read-only Observer) rather than a full RBAC system.
- **Data & metric logic:** New role/permission resolution in org-context; a person→manager or team→manager mapping distinct from the engineering role_assignments table.
- **Backend/API & UI impact:** Backend: role enum + resolution; every authenticated page/route re-audits its ctx.role gate. UI: nav items gated per role (§5).
- **Privacy & permissions:** Defines who can see individual data — the gate all of §10 depends on; must fail closed for new roles.
- **Dependencies & migrations:** ADR for the frozen schema change; blocks TCI-PRIV-002/003/017.
- **Tests & acceptance:** tenant-isolation sweep extended for the new roles; a gate test that a Manager cannot reach admin-only routes and an Observer cannot reach individual evidence.

### TCI-PRIV-002 — Manager sees named per-person capability profile by default

**Conflicting** · effort XL · priority P1 · risk high

> A team manager can, by default, open a named team member's individual capability profile (universal + role-pack breakdown, evidence, trend). *(TCI §3.2, §6.4)*

- **What exists today (evidence):** src/db/org-scope/mastery.ts:6-15 states self-view enforcement: 'a manager cannot reach another person's mastery here'; ADR 0038 lines 37-39 confirm user_capability_state is structurally excluded from TeamVisibleView so it cannot leak; src/lib/visibility.ts:214-224 assertTeamOnlyPseudonymized enforces team-only-pseudonymized in private mode. CLAUDE.md: manager-facing per-person capability view is 'a major privacy-model change'.
- **Why users want it:** Managers want to understand and coach each member's AI capability.
- **What has to change:** This reverses the founder-approved self-view-only design and the pseudonymized-private-by-default posture. Requires a founder-signed ADR (like ADR 0038), a new manager read surface on mastery, registration of the new identity-bearing surface in src/lib/visibility.ts, and consent machinery (see TCI-PRIV-006). Recommend NOT building by default; if built, gate behind explicit opt-in (managed/full + consent) and per-role scoping, never a private-mode default.
- **Data & metric logic:** A new manager-scoped read of user_capability_state joined to named people; today none exists.
- **Backend/API & UI impact:** Backend: new read route + visibility registration. UI: manager individual-profile screen (§6.4).
- **Privacy & permissions:** The core privacy reversal of the whole spec; changes Revealyst from self-coaching to manager evaluation of named individuals.
- **Dependencies & migrations:** TCI-PRIV-001 (Manager role); W6-A companion-in-team-orgs founder gate (dogfood clock since 2026-07-14); founder-signed ADR.
- **Tests & acceptance:** New visibility surface leak test; consent-gated access test; assertTeamOnlyPseudonymized must still hold in private mode.

### TCI-PRIV-003 — Manager sees individual (named) cost analytics

**Conflicting** · effort L · priority P1 · risk high

> Managers can see per-person monthly cost, model mix, premium-model share, token volume, and efficiency classification for named members. *(TCI §3.2, §6.4, §6.12)*

- **What exists today (evidence):** src/app/(app)/dashboard/team-overview.tsx:145-153,249-368 shows cost only as team aggregate spend + count-only segments with MIN_PEOPLE floor; budgets are admin-configured governance data role-gated to admins (team-overview.tsx:69-93). No per-named-person spend table or manager cost read exists.
- **Why users want it:** Managers want to see whether spend is producing capability growth per person.
- **What has to change:** Building named per-person cost breaks the aggregate/count-only + pseudonymized posture. Needs the same consent/ADR path as TCI-PRIV-002 plus the admin cost-visibility toggle (TCI-PRIV-005). Recommend keeping cost aggregate + pseudonym-scoped unless an admin explicitly opts in under managed/full.
- **Data & metric logic:** Per-person cost allocation surfacing (CostAllocation-like) joined to named people; today spend is team-level with allocation confidence only.
- **Backend/API & UI impact:** Backend: per-person cost read + role gate. UI: individual Cost and Usage tab (§6.4).
- **Privacy & permissions:** Per-person spend is individual behavioral data; surfacing it named is workplace evaluation subject to the readiness/DPIA steps.
- **Dependencies & migrations:** TCI-PRIV-001, TCI-PRIV-005; founder ADR.
- **Tests & acceptance:** Cost read denied to non-managers and in private mode; allocation-confidence surfaced; cost never enters scoring.

### TCI-PRIV-004 — Manager notes entity

**Missing** · effort L · priority P2 · risk high

> Managers can write private notes on a team member (author, timestamp, optional follow-up date), manager-private, that never affect calculated scores. *(TCI §3.2, §6.4, §6.12, §16)*

- **What exists today (evidence):** Grep for manager note / managerNote / manager_note across the repo returned no files. No such table, route, or component exists.
- **Why users want it:** Managers track coaching context per person over time.
- **What has to change:** New org-scoped table manager_notes keyed (org_id, person_id) with author + timestamp + follow-up; a manager-only read/write route; a visibility toggle for manager-private vs shared (§6.12). Must be excluded from scoring inputs and from TeamVisibleView.
- **Data & metric logic:** Free-text notes stored per person; explicitly NOT fed to deriveAttention or capability-state.
- **Backend/API & UI impact:** Backend: new table + CRUD route. UI: Notes tab (§6.4).
- **Privacy & permissions:** Free-text notes about a named employee are sensitive personal data — need retention config, access scoping, and purge on account deletion.
- **Dependencies & migrations:** TCI-PRIV-001 (Manager role); three registrations (tenant-isolation SCOPED_READS, PURGE_TABLES before people, ADR).
- **Tests & acceptance:** Notes never alter scores (scoring-equivalence); notes not in TeamVisibleView; purge on person delete; only manager/author can read.

### TCI-PRIV-005 — Admin toggle: individual cost visible to managers

**Missing** · effort M · priority P2 · risk medium

> Workspace administrators control whether individual cost data is visible to managers. *(TCI §3.3, §6.12, §10)*

- **What exists today (evidence):** src/app/(app)/settings/page.tsx:156-175 exposes only the org-level Visibility mode control (private/managed/full) and workspace/digest/roles cards; no per-concern cost-visibility toggle exists.
- **Why users want it:** Admins keep control over how sensitive per-person spend is shared internally.
- **What has to change:** Add an admin setting persisted at org level gating the per-person cost read (TCI-PRIV-003). Small once cost data exists, but meaningless until it does.
- **Data & metric logic:** New org setting column/row consulted by the cost read.
- **Backend/API & UI impact:** Backend: setting + gate. UI: Settings toggle + Team Settings Visibility section.
- **Privacy & permissions:** Directly a privacy control; must default to off (not visible).
- **Dependencies & migrations:** TCI-PRIV-003 (per-person cost must exist first).
- **Tests & acceptance:** Toggle off hides individual cost from managers; default off.

### TCI-PRIV-006 — Granular Team Settings visibility toggles

**Partial** · effort M · priority P2 · risk medium

> Configure independently: whether members see team aggregates, whether managers see individual cost, whether prompt-level evidence is available, whether mentor recommendations are visible, whether notes are manager-private. *(TCI §6.12)*

- **What exists today (evidence):** src/lib/visibility-playbook.ts:33-61 + src/components/settings/visibility-mode-control.tsx provide ONE org-level mode (private/managed/full) that only governs name reveal, not these five independent concerns; ADR 0018 covers the settings visibility route.
- **Why users want it:** Admins tune exactly what each audience can see without an all-or-nothing switch.
- **What has to change:** Add per-concern settings. Note several depend on features that don't exist yet (individual cost, manager notes, mentor recs) or are excluded (prompt evidence — see TCI-PRIV-007). Recommend adding toggles only alongside the feature each governs, not a settings page of dead switches.
- **Data & metric logic:** New org-setting fields, each consulted by its feature's read.
- **Backend/API & UI impact:** Backend: settings schema. UI: Team Settings Visibility section.
- **Privacy & permissions:** These ARE the privacy controls; each must default to the more private option.
- **Dependencies & migrations:** Per-toggle dependencies on TCI-PRIV-003/004 and TCI-PRIV-007.
- **Tests & acceptance:** Each toggle changes exactly its surface; private defaults.

### TCI-PRIV-007 — Prompt-level evidence availability toggle

**Conflicting** · effort S · priority P1 · risk high

> Configure whether prompt-level evidence is available; raw prompt content hidden by default. *(TCI §6.12, §2.4, §10, §16)*

- **What exists today (evidence):** src/app/legal/what-we-collect/page.tsx:66-75: 'There is no content field anywhere in the Revealyst data model.' Frozen tripwire (CLAUDE.md): 'no prompt-content ingestion in Team mode'. Prompts are never collected, so there is nothing to toggle available.
- **Why users want it:** The privacy goal (never expose raw conversations) is what users actually want.
- **What has to change:** The 'hidden by default' guarantee is already met structurally and more strongly than TCI asks. A toggle to make prompt evidence AVAILABLE cannot be built without violating the tripwire and would be a regression — recommend excluding it from the spec and documenting that prompt content is never ingested.
- **Data & metric logic:** None — no prompt content exists to gate.
- **Backend/API & UI impact:** Documentation only; do not build the availability path.
- **Privacy & permissions:** Building it would introduce prompt-content ingestion, the single most sensitive thing the product forbids.
- **Dependencies & migrations:** None.
- **Tests & acceptance:** Existing no-content-field guarantees; a banned-surface test if a prompt field were ever added.

### TCI-PRIV-009 — Role-scoped name visibility (managers see names, ICs see pseudonyms)

**Conflicting** · effort L · priority P1 · risk high

> Real names are visible to managers while individual contributors continue to see pseudonyms / no named peer scores. *(TCI §3.1, §3.2, §7.3)*

- **What exists today (evidence):** Visibility is an org-wide mode, not role-scoped: src/lib/visibility-playbook.ts:43-60 — managed/full reveal real names 'across the workspace' to everyone; src/app/(app)/people/page.tsx:23 gates names purely on org.visibilityMode; src/lib/visibility.ts:23-30 toPersonRef nulls names by mode, not by viewer role.
- **Why users want it:** Managers can act on named individuals while peers stay protected.
- **What has to change:** Making name visibility depend on the VIEWER's role (not just the org mode) is a new privacy axis: the single toPersonRef decision point would need a viewer-role parameter and every call site re-audited. Founder ADR required; interacts with the consent readiness steps.
- **Data & metric logic:** toPersonRef and every name-gating call site made viewer-aware.
- **Backend/API & UI impact:** Backend: name-gating signature change (frozen decision point). UI: names appear for managers only.
- **Privacy & permissions:** Changes the fundamental unit of the privacy model from org-mode to per-viewer.
- **Dependencies & migrations:** TCI-PRIV-001 (Manager role); ADR touching src/lib/visibility.ts.
- **Tests & acceptance:** IC viewer never sees names even in managed mode unless permitted; manager does; private mode still fully pseudonymous.

### TCI-PRIV-010 — Distinguish observed behavior vs score vs inference vs note vs missing data

**Partial** · effort M · priority P2 · risk low

> The system clearly distinguishes observed behavior, calculated score, inferred capability, manager-provided note, and incomplete/unavailable data. *(TCI §10)*

- **What exists today (evidence):** Confidence tiers exist (src/db/org-scope/mastery.ts:34 confidenceTier measured|modeled|directional|not_measured) and the data-confidence framework surfaces incomplete data; but there is no manager-note category (grep found none) and no single typed taxonomy separating observed-vs-inferred labels on each surface.
- **Why users want it:** Users trust the profile because they can tell a measured fact from an inference or a human note.
- **What has to change:** Add explicit provenance labels distinguishing the five kinds wherever a value is shown; the manager-note kind depends on TCI-PRIV-004. Much of this reuses existing confidence tiers.
- **Data & metric logic:** Provenance tag on rendered capability values; note provenance once notes exist.
- **Backend/API & UI impact:** UI: labels on capability/score surfaces.
- **Privacy & permissions:** Prevents inferences being read as facts about an employee.
- **Dependencies & migrations:** TCI-PRIV-004 for the note category.
- **Tests & acceptance:** Each surface labels provenance; inference never rendered as observed.

### TCI-PRIV-013 — No implication of performance/productivity/employment quality

**Partial** · effort S · priority P1 · risk medium

> The interface must not imply performance, productivity, or employment quality from AI capability, and must avoid ROI/productivity/ranking claims. *(TCI §10, §16, §14)*

- **What exists today (evidence):** Anti-gamification is founder-signed (CLAUDE.md P5); no XP/streak/leaderboard (schema-shape + banned-phrasing tests); visibility-playbook.ts:48 frames scores as 'self-coaching — never a manager leaderboard'. But TCI adds manager surfaces (coaching queue, efficiency classification, 'needs coaching') that push toward evaluation; today's code upholds the principle, new surfaces would put it at risk.
- **Why users want it:** Employees are not judged as workers by an AI-usage number.
- **What has to change:** Any new manager surface must carry the same self-coaching framing and banned-phrasing guards; add copy tests to the new team screens. Low effort but must be enforced on every new surface.
- **Backend/API & UI impact:** UI copy + banned-phrasing tests on new manager screens.
- **Privacy & permissions:** Guards against the product becoming employee surveillance.
- **Dependencies & migrations:** Applies to all new §6 manager screens.
- **Tests & acceptance:** Banned-phrasing sweep extended to new manager surfaces.

### TCI-PRIV-015 — Executive/Observer read-only aggregate role

**Partial** · effort L · priority P3 · risk low

> An optional read-only Executive/Observer role can access aggregate team trends without individual-level evidence or prompt data. *(TCI §3.4)*

- **What exists today (evidence):** No such role exists (core.ts:197 only admin/member). However the aggregate-only, no-individual-evidence view TCI wants is exactly what Private mode already renders for every member (team-overview.tsx aggregate cards; no prompt data anywhere).
- **Why users want it:** Executives get a trend view without seeing individuals.
- **What has to change:** The aggregate content already exists; only a distinct read-only role label + gate is missing. If the four-role model (TCI-PRIV-001) lands, Observer is a thin read-only variant. Recommend not building a separate role until TCI-PRIV-001 exists.
- **Data & metric logic:** Reuse the existing aggregate team read; add a read-only gate.
- **Backend/API & UI impact:** Backend: role gate. UI: hide manager write actions for Observer.
- **Privacy & permissions:** Must be barred from any individual-evidence surface.
- **Dependencies & migrations:** TCI-PRIV-001.
- **Tests & acceptance:** Observer cannot reach individual profiles/notes/cost.

### TCI-PRIV-016 — Configurable retention & privacy settings

**Partial** · effort L · priority P3 · risk medium

> Workspace administrators can configure retention and privacy settings. *(TCI §3.3)*

- **What exists today (evidence):** Privacy: visibility mode control exists (settings/page.tsx:156-175) and account deletion purges per-person data (src/db/account-deletion.ts PURGE_TABLES). But there is no admin-configurable data-retention period; retention is implicit (purge on delete), not a setting.
- **Why users want it:** Admins meet their own compliance/retention obligations.
- **What has to change:** Privacy config partly exists; a configurable retention window (auto-purge after N months) is missing and would be a new scheduled-purge mechanism. Recommend deferring unless a customer requires it.
- **Data & metric logic:** New retention-window setting + scheduled purge job.
- **Backend/API & UI impact:** Backend: setting + cron purge. UI: retention control in Team Settings.
- **Privacy & permissions:** Retention limits are a core privacy control.
- **Dependencies & migrations:** Purge machinery exists; retention config is additive.
- **Tests & acceptance:** Retention purge removes aged rows; account-deletion tripwire still holds.

### TCI-PRIV-017 — Admin configures permissions & assigns managers

**Missing** · effort L · priority P2 · risk high

> Workspace administrators can assign managers and configure permissions. *(TCI §3.3)*

- **What exists today (evidence):** role_assignments maps a person to an engineering JOB role for recommendation targeting, not to a manager/permission grant (src/db/schema/roles.ts:34-42); Settings exposes role assignment for that purpose only (settings/page.tsx:90-104,185-187). No manager-assignment or permission-config UI exists.
- **Why users want it:** Admins delegate team oversight and control access.
- **What has to change:** Introduce a manager-assignment mapping (person/team → manager) distinct from job roles, plus permission configuration UI. Depends entirely on the role model.
- **Data & metric logic:** New team-manager mapping consumed by the manager-scoped reads.
- **Backend/API & UI impact:** Backend: mapping table + resolution. UI: Team Settings manager assignment.
- **Privacy & permissions:** Determines who gains individual-data access — must be admin-only and audited.
- **Dependencies & migrations:** TCI-PRIV-001; likely a new org-scoped table (three registrations + ADR).
- **Tests & acceptance:** Only assigned managers reach their team's individual data; cross-team denied.

<a id="architecture"></a>
## Architecture & team structure

### TCI-ARCH-001 — Team entity inside a workspace

**Partial** · effort S · priority P0 · risk low · quick win

> A named Team that lives inside a workspace and groups its members, so managers can view and act on one team at a time. *(TCI §9, §6.12)*

- **What exists today (evidence):** src/db/schema/core.ts:138-183 (teams + team_members group tracked people, composite tenant FKs); src/db/org-scope/teams.ts:5-73 (CRUD namespace); src/app/(app)/teams/page.tsx:19-96 (admin-managed teams page)
- **Why users want it:** Managers can scope every view to a specific team rather than the whole org.
- **What has to change:** Reuse the existing teams table; it already models a group-of-people within an org. Gap is only the extra fields TCI's Team shape assumes (see TCI-ARCH-002/013/012).
- **Data & metric logic:** team_members joins people to teams; team-level scores already aggregate over members.
- **Backend/API & UI impact:** Backend teams namespace exists; UI teams roster exists. No new API needed for the base entity.
- **Privacy & permissions:** Names gated by org.visibilityMode (private pseudonymizes) — already enforced in teams/page.tsx:34.
- **Tests & acceptance:** Team CRUD already exercised via fixtures (src/db/fixtures.ts:142-146). New fields would each need tenant-isolation coverage.

### TCI-ARCH-002 — Manager role and per-team manager assignment

**Missing** · effort XL · priority P0 · risk high

> A 'manager' concept — a person/user assigned to manage one or more teams, with elevated access to that team's data — and an admin workflow to assign managers. *(TCI §3.2, §3.3, §6.12, §9)*

- **What exists today (evidence):** src/db/schema/core.ts:159-183 (teams have NO manager column); src/lib/api-context.ts:63-66 (org role is only admin|member); grep for 'manager' in src/db/src/lib returns only self-view guard comments, no manager entity
- **Why users want it:** A team lead sees and coaches only their own team, distinct from a full workspace admin.
- **What has to change:** Add a manager relation (e.g. team_managers linking a team to a login user/person). Decide whether 'manager' is a new org membership tier or a per-team grant. Frozen schema change → ADR.
- **Data & metric logic:** Access checks must resolve 'is this user a manager of team T' for every team-scoped read.
- **Backend/API & UI impact:** New backend access predicate + admin assignment UI; touches api-context/access.
- **Privacy & permissions:** Defines who may see team-member data — gates the whole manager surface; must respect visibilityMode.
- **Dependencies & migrations:** Frozen-contract ADR + tenant-isolation SCOPED_READS + purge registration for the new mapping table (three-registration law).
- **Tests & acceptance:** Tenant-isolation seed for the new table; access tests that a non-manager 403s on a team they don't manage.

### TCI-ARCH-003 — Manager-facing per-member capability view

**Conflicting** · effort XL · priority P1 · risk high

> Managers can open any team member's individual capability profile, scores, evidence, and history. *(TCI §3.2, §6.4, §6.2)*

- **What exists today (evidence):** src/db/org-scope/mastery.ts:5-15 ('there is NO team/other-person read surface... a manager cannot reach another person's mastery here'); src/db/org-scope/exposures.ts:6-10 and rec-interactions.ts:9-11 (same self-view posture); CLAUDE.md: mastery is deliberately self-view-only, a manager per-person view is a MAJOR privacy-model change
- **Why users want it:** Managers can diagnose and coach individuals — TCI's core loop.
- **What has to change:** This reverses a founder-signed self-view-only stance. Requires an explicit privacy-reversal ADR (precedent: exposure-log ADR 0038 reversed a 'don't log' stance), a new manager read route, and re-audit of MIN_PEOPLE/pseudonymization. Recommend: gate behind org visibilityMode='managed'/'full' + manager-only, never in private mode.
- **Data & metric logic:** A new (org, manager, member) authorized read over user_capability_state; must not floor missing data to 0 (invariant b).
- **Backend/API & UI impact:** New manager surface + access predicate; largest single privacy change in the spec.
- **Privacy & permissions:** Core privacy-model change — individual mastery becomes manager-visible; needs founder sign-off, not an engineering decision.
- **Dependencies & migrations:** Depends on TCI-ARCH-002 (manager role). Privacy-reversal ADR. Interacts with W6-A companion-in-team gate.
- **Tests & acceptance:** Access tests proving private-mode still blocks; MIN_PEOPLE floor unaffected; no per-user fabrication.

### TCI-ARCH-004 — Individual-contributor self-view within a team org

**Blocked** · effort M · priority P1 · risk medium

> In a team workspace, each member sees their own capability profile, recommendations, coaching, and permitted team aggregates. *(TCI §3.1, §7.1-7.3)*

- **What exists today (evidence):** src/lib/nav-items.ts:60-69 (Growth/companion route 'activates for team-org members once T5.1 / W6-A clears its dogfood gate — no build ahead of that gate'); CLAUDE.md marks W6-A companion-in-team-orgs founder-gated on the ~6-week dogfood clock since 2026-07-14
- **Why users want it:** Team members get the same personal companion ICs get today.
- **What has to change:** No new work permitted until the dogfood gate clears; the route + nav wiring are already staged for it.
- **Data & metric logic:** Self-view mastery already computed per person; only the team-org gate blocks exposure.
- **Backend/API & UI impact:** Nav config already conditionally supports it (navFor).
- **Privacy & permissions:** Self-view only — no new exposure.
- **Dependencies & migrations:** External gate: W6-A / T5.1 dogfood outcome (do not force).

### TCI-ARCH-005 — Executive / Observer read-only aggregate role

**Missing** · effort L · priority P3 · risk medium

> An optional read-only role that sees aggregate team trends only, with no individual-level evidence or prompt data. *(TCI §3.4)*

- **What exists today (evidence):** src/lib/api-context.ts:63-66 (only admin|member org roles + isPlatformAdmin boolean); no observer/executive role in src/db/schema/core.ts:189-221 invites enum
- **Why users want it:** Executives get org-wide trends without individual surveillance.
- **What has to change:** Add a third read-only role tier OR model it as a scoped view of the existing exec memo. Given minimal-UX + the shipped monthly exec memo (ADR 0031), prefer reusing exec-report over a new role tier. Recommend: defer / fold into exec memo.
- **Data & metric logic:** Aggregate-only reads (MIN_PEOPLE-floored) — reuse team-overview aggregates.
- **Backend/API & UI impact:** New role plumbing if built as a tier.
- **Privacy & permissions:** Aggregate/count-only by definition; low risk if it reuses existing floors.
- **Dependencies & migrations:** TCI-ARCH-002 role model.
- **Tests & acceptance:** Access tests that observer cannot reach per-member routes.

### TCI-ARCH-006 — Sub-teams / subgroups (nested team hierarchy)

**Missing** · effort L · priority P2 · risk medium

> Teams can contain subgroups (squads/locations), and views can group/filter by subgroup. *(TCI §3.3, §6.12, §6.2)*

- **What exists today (evidence):** src/db/schema/core.ts:138-154 (teams has id/orgId/name only — no parent_team_id, no subgroup); team_members is flat (core.ts:159-183)
- **Why users want it:** Large teams organize members into squads for finer coaching.
- **What has to change:** Add a self-referential parent or a subgroup table. Frozen schema change → ADR. Consider whether the existing count-only segments already satisfy the underlying need before adding nesting.
- **Data & metric logic:** Aggregations must roll up subgroup→team, respecting MIN_PEOPLE at each level.
- **Backend/API & UI impact:** Schema + aggregation + filter UI.
- **Privacy & permissions:** Smaller subgroups risk falling under MIN_PEOPLE — must suppress, not imply.
- **Dependencies & migrations:** Frozen-contract ADR + three registrations if a new table.
- **Tests & acceptance:** MIN_PEOPLE floor at subgroup granularity; tenant-isolation.

### TCI-ARCH-007 — Workspace-admin team management and permission configuration

**Partial** · effort L · priority P1 · risk medium

> Workspace admins can create/manage teams, assign managers, configure per-area permissions, enable role packs, and set visibility of cost/prompt evidence. *(TCI §3.3, §6.12)*

- **What exists today (evidence):** src/app/(app)/teams/page.tsx:21,47 (admin-gated team create/manage exists); src/db/schema/core.ts:86-95 (visibilityMode is org-level, three modes) — but no per-team permission config, no manager assignment, no role-pack enablement
- **Why users want it:** Admins control who sees what across teams.
- **What has to change:** Team creation/membership: reuse. Manager assignment: TCI-ARCH-002. Per-team permission/visibility config and role-pack enablement: new settings surface + storage (today visibilityMode is a single org-wide switch, not per-team, not per-area).
- **Data & metric logic:** A per-team settings blob would drive gating across surfaces.
- **Backend/API & UI impact:** New Team Settings surface (see §6.12 items).
- **Privacy & permissions:** This is the control plane for the manager-visibility decisions in TCI-ARCH-003.
- **Dependencies & migrations:** TCI-ARCH-002; frozen change if settings live on the teams table.
- **Tests & acceptance:** Settings persistence + gate-honoring tests.

### TCI-ARCH-008 — Team Intelligence top-level nav area (11 sub-items)

**Conflicting** · effort M · priority P2 · risk medium

> Add a top-level 'Team Intelligence' area with Overview, Capability Matrix, Team Members, Growth, Coaching, Skills & Experts, Costs & Efficiency, Insights, Benchmarks, Reports, Team Settings; hide manager-only items from non-managers. *(TCI §5)*

- **What exists today (evidence):** src/lib/nav-items.ts:17-26 (W5-H dashboard-itis fold: nav deliberately minimized, roster/methodology retired) and :71-76 (team nav is 4 items: Team/AI maturity/Connections/Account); src/app/(app)/dashboard/team-overview.tsx renders exactly 5 card sections on one route
- **Why users want it:** Managers navigate a full team product.
- **What has to change:** An 11-item sub-nav contradicts the founder minimal-UX principle and the W5-H fold. Recommend: progressive disclosure — keep /dashboard as Team Overview and add at most a few sub-routes (Capability Matrix, Team Members, Coaching, Reports), not an 11-item tree. The gating mechanism (navFor role gate) already exists and can hide manager-only items.
- **Data & metric logic:** Nav is pure config (navFor) — cheap to extend, expensive to justify at 11 items.
- **Backend/API & UI impact:** Config edit in nav-items.ts + one route per surface actually built.
- **Privacy & permissions:** Non-manager gating already supported by navFor role gate (nav-items.ts:129).
- **Dependencies & migrations:** TCI-ARCH-002 for the manager gate; each sub-item depends on its owning screen being built.
- **Tests & acceptance:** nav-items.test.ts already pins gating — extend it.

### TCI-ARCH-009 — Manager-only navigation gating

**Partial** · effort S · priority P1 · risk low · quick win

> Users without manager/admin permission must not see manager-only nav items. *(TCI §5)*

- **What exists today (evidence):** src/lib/nav-items.ts:107-130 (navFor gates ADMIN_NAV_ITEMS on role==='admin' and PLATFORM on isPlatformAdmin) — gating exists but keys off admin/platform, not a 'manager' role
- **Why users want it:** Members aren't shown surfaces they can't use.
- **What has to change:** Once a manager role exists (TCI-ARCH-002), add a manager gate branch in navFor. Mechanism is already there; only the role input is missing.
- **Data & metric logic:** Pure resolver, no data reads.
- **Backend/API & UI impact:** Small config change.
- **Privacy & permissions:** Nav gating is defense-in-depth; server routes must still re-check (existing pattern).
- **Dependencies & migrations:** TCI-ARCH-002.
- **Tests & acceptance:** Extend nav-items.test.ts for the manager tier.

### TCI-ARCH-010 — Team entity data shape (managerIds, memberIds, rolePackIds, settings)

**Partial** · effort L · priority P1 · risk medium

> Team = { id, workspaceId, name, managerIds[], memberIds[], rolePackIds[], settings }. *(TCI §9)*

- **What exists today (evidence):** src/db/schema/core.ts:138-154 (teams has id, orgId, name, createdAt only); team_members supplies memberIds (core.ts:159-183) — managerIds, rolePackIds, settings all absent
- **Why users want it:** One object carries a team's structure and configuration.
- **What has to change:** memberIds via team_members (reuse). managerIds → TCI-ARCH-002. rolePackIds → TCI-ARCH-011. settings → a per-team settings store (JSON column or child table). All are frozen-schema additions → ADR.
- **Data & metric logic:** Assemble the shape in the teams namespace read.
- **Backend/API & UI impact:** Schema fields + namespace read shape.
- **Privacy & permissions:** settings holds the visibility toggles from §6.12.
- **Dependencies & migrations:** Frozen-contract ADR; three registrations if settings become a table.
- **Tests & acceptance:** tenant-isolation for any new table; shape assembly test.

### TCI-ARCH-011 — RolePack entity (versioned capability bundles, per-team enablement)

**Partial** · effort XL · priority P2 · risk high

> RolePack = { id, name, capabilityIds[], version, status: draft|active|deprecated }, enabled per team, adding role-specific capabilities on top of the universal model. *(TCI §4.2, §6.12, §9, §14)*

- **What exists today (evidence):** src/db/schema/roles.ts:23-32 (flat roles reference table, engineering seed, no capability bundling, no status lifecycle) and :43-78 (role_assignments = person→one role); src/db/schema/capability-graph.ts:29-60 (domains/capabilities global reference, engineering domain only, not per-team-enableable)
- **Why users want it:** Marketing/Sales/etc. teams get domain-specific capabilities without a redesign.
- **What has to change:** The pieces (roles catalog, domains, capabilities) exist but as GLOBAL reference bound to engineering, with no pack grouping, no version/status lifecycle, and no per-team enablement mapping. Building RolePacks = new pack entity + team↔pack mapping + non-engineering capability seeds (the non-eng role expansion is itself a documented DEFERRED gate needing a real role-telemetry source).
- **Data & metric logic:** Enabled packs determine which capability columns a team's matrix shows.
- **Backend/API & UI impact:** Reference-data + per-team mapping + capability engine binding.
- **Privacy & permissions:** None directly.
- **Dependencies & migrations:** Non-eng role expansion is founder-DEFERRED (CLAUDE.md: needs an honest M365/Workspace role-telemetry source that doesn't exist). Frozen-contract ADR for the pack + mapping tables.
- **Tests & acceptance:** Migration-equivalence for the engineering pack; tenant-isolation for the mapping table.

### TCI-ARCH-012 — Per-team Capability Configuration (enable caps, importance, custom labels/dimensions)

**Missing** · effort L · priority P3 · risk high

> Per team: choose enabled universal capabilities and role packs, set capability importance weights, custom skill labels, and custom capability dimensions. *(TCI §6.12)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:29-60 (capabilities are GLOBAL reference, not per-org/per-team configurable; no importance/weight column, no custom-dimension surface)
- **Why users want it:** Teams tailor which capabilities matter to them.
- **What has to change:** Enable/importance/labels → a per-team config store. Custom capability DIMENSIONS specifically risks the frozen no-formula-DSL tripwire — user-defined scoring dimensions are the banned DSL. Recommend: build enable/label config (safe); EXCLUDE custom dimensions or route through an ADR that keeps scoring code-owned.
- **Data & metric logic:** Config filters/weights the capability read; weighting must not fabricate scores where evidence is absent (invariant b).
- **Backend/API & UI impact:** Team Settings surface + capability read changes.
- **Privacy & permissions:** None directly.
- **Dependencies & migrations:** TCI-ARCH-010 settings store; custom-dimensions blocked by the formula-DSL tripwire.
- **Tests & acceptance:** Config honored in reads; tripwire guard that no user formula reaches scoring.

### TCI-ARCH-013 — TeamCapabilitySnapshot entity

**Conflicting** · effort L · priority P2 · risk medium

> A stored per-period team snapshot { teamId, periodStart/End, overallScore, capabilityScores, maturityDistribution, confidence, represented/totalMemberCount }. *(TCI §9)*

- **What exists today (evidence):** No snapshot table in src/db/schema/* (grep 'snapshot' returns none); team-overview computes on read (src/app/(app)/dashboard/team-overview.tsx); CLAUDE.md warns score_results.computed_at is rewritten by nightly upsert (materialized history deliberately avoided) and the codebase prefers compute-on-read (readDashboardView)
- **Why users want it:** Historical team trends and coaching-impact baselines.
- **What has to change:** The repo intentionally computes team aggregates on read rather than materializing snapshots. If genuine historical baselines are needed (coaching impact, growth-over-time), a purpose-built append-only snapshot table is the right tool — but it must be justified against the compute-on-read preference, not adopted wholesale. Recommend: build only if the Growth/Coaching-impact screens (other domains) prove they need stored baselines.
- **Data & metric logic:** Append-only per (team, period); never overwrite (unlike score_results).
- **Backend/API & UI impact:** New table + a snapshot-writing cron/queue step.
- **Privacy & permissions:** Aggregate + count fields; keep MIN_PEOPLE floor in represented counts.
- **Dependencies & migrations:** Frozen-contract ADR + three registrations; a new cron/queue writer.
- **Tests & acceptance:** tenant-isolation seed; append-only invariant test.

### TCI-ARCH-014 — CapabilityDefinition universal vs role_specific categorization

**Partial** · effort M · priority P2 · risk medium

> CapabilityDefinition carries category 'universal'|'role_specific', scoringVersion, and evidenceTypes. *(TCI §9, §4.1-4.2)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:41-60 (capabilities have slug/domainSlug/version/label/summary + prose columns) — a version exists, but there is no universal/role_specific category flag and only one engineering domain is seeded
- **Why users want it:** The model separates a shared core from role-specific depth.
- **What has to change:** Add a category flag (or derive universal vs role from a reserved domain). Frozen-schema addition → ADR. Ties to the universal-capability-model requirement owned by the capability-model domain.
- **Data & metric logic:** Category drives which capabilities appear for every team vs only role-pack teams.
- **Backend/API & UI impact:** Reference-data column + seed.
- **Privacy & permissions:** None.
- **Dependencies & migrations:** TCI-ARCH-011 role packs; ADR for the frozen reference-table change.
- **Tests & acceptance:** Migration-equivalence on existing engineering rows.

### TCI-ARCH-015 — New team-layer entities require frozen-contract ADR + three registrations

**Partial** · effort M · priority P0 · risk medium

> Any new org-scoped table (team_managers, per-team settings, subgroups, snapshots, role-pack mappings) must be added via the frozen-contract process. *(TCI §9)*

- **What exists today (evidence):** CLAUDE.md Frozen contracts + 'A new org-scoped table needs THREE registrations': tenant-isolation SCOPED_READS, ADR (docs/decisions/, latest 0043), account-deletion purge; drizzle latest 0035; existing composite-tenant-FK pattern in src/db/schema/core.ts:159-183 and roles.ts:64-77
- **Why users want it:** Tenancy isolation and account deletion stay correct as the team layer grows.
- **What has to change:** This is a cross-cutting build constraint, not a feature: every table in TCI-ARCH-002/006/010/011/013 pays ADR + tenant-isolation seed + purge registration + composite (org_id, …) FK.
- **Data & metric logic:** org_id in the key for every new table; composite FK to parent so cross-org rows are unrepresentable.
- **Backend/API & UI impact:** Governance overhead multiplied across the ~5 new tables the spec implies.
- **Privacy & permissions:** Purge registration is the account-deletion guarantee.
- **Dependencies & migrations:** Applies to all new-table requirements above.
- **Tests & acceptance:** tenant-isolation completeness tripwire + account-deletion purge-completeness tripwire (both CI-enforced).

<a id="data"></a>
## Data model

### TCI-DATA-001 — Per-capability score object (CapabilityScore)

**Partial** · effort M · priority P1 · risk medium

> Every capability score for a person uses one common structure: capabilityId, userId, score, level, trend, change, confidence, confidenceScore, evidenceCount, positiveSignals, limitingSignals, dataLimitations, lastCalculatedAt. *(TCI §4.3)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:149-214 (user_capability_state: personId, capabilitySlug, mastery, confidence numeric, confidenceTier, evidenceCount, lastEvidenceAt, components jsonb, updatedAt); src/scoring/capability-state.ts:69-80 (CapabilityStateComputed shape)
- **Why users want it:** A person (and, in TCI, a manager) can see not just a number but why it is what it is — the signals behind it, how sure the system is, and what data is missing.
- **What has to change:** Most fields already exist under other names: score≈mastery (repo is 0–1, TCI implies 0–100 — pick one scale), userId=personId, evidenceCount exists, confidenceScore≈confidence numeric, lastCalculatedAt≈updatedAt/lastEvidenceAt, and components jsonb already holds the per-signal contributions positiveSignals/limitingSignals would be derived from. Missing as typed outputs: `level` (see TCI-DATA-002 conflict), `trend`+`change` (see TCI-DATA-003), a typed positive/limiting SignalSummary split, and a typed dataLimitations[] array. Most of these are read-time derivations over data that already exists, not new columns.
- **Data & metric logic:** Derive positive/limiting signals by ranking user_capability_state.components contributions; derive dataLimitations from the existing data-confidence framework (src/lib/data-confidence.ts). level/trend/change need the items below.
- **Backend/API & UI impact:** Backend: a read-model that projects user_capability_state into the CapabilityScore shape. UI: the shared Capability Score Card / detail drawer (§8) consumes it.
- **Privacy & permissions:** Exposing this object to anyone other than the subject person is the major change flagged in TCI-DATA-005 — the object itself is fine self-view.
- **Dependencies & migrations:** TCI-DATA-002 (level), TCI-DATA-003 (trend/change).
- **Tests & acceptance:** Projection test that every CapabilityScore field is populated or explicitly null; honesty test that a no-evidence capability yields NO object (never a fabricated 0), matching capability-state.ts computeOne returning null.

### TCI-DATA-002 — Five-level capability ladder (inactive→expert)

**Conflicting** · effort S · priority P1 · risk low

> level is one of inactive | beginner | intermediate | advanced | expert. *(TCI §4.3)*

- **What exists today (evidence):** TCI §4.3 line 423 (5-level enum) vs src/lib/capability-glossary.ts:10-24 (positive-first 4-band CapabilityBand: Established | Building | Developing | Getting started; masteryBand thresholds) and file header 'Discovery, never deficiency ... never a competing third ladder (L5)'; CLAUDE.md anti-deficiency + 'no 4th ladder' rules
- **Why users want it:** A clear label for how developed a capability is.
- **What has to change:** Recommend NOT adopting the deficiency-named 5-level ladder verbatim. 'inactive'/'beginner' framing directly contradicts the approved positive-first, discovery-not-deficiency banding, and the repo already forbids introducing a competing ladder (maturity level vs capability band already coexist under a deliberate 'decomposition, not a third ladder' rule). Either keep the 4 positive-first bands and map spec screens onto them, or get an explicit founder decision to change the framing. Do not silently ship a second, negatively-framed 5-level scale.
- **Data & metric logic:** masteryBand() already maps mastery→band; extend or re-label only via a founder-approved framing change.
- **Backend/API & UI impact:** Every screen that renders a capability level (matrix, distribution, member profile).
- **Dependencies & migrations:** Founder framing decision; docs/product-signoffs.md ledger.
- **Tests & acceptance:** Banned-phrasing test already guards deficiency language — a 5-level rollout would trip it; that's the signal to resolve at the product level first.

### TCI-DATA-003 — Per-capability trend and change (period-over-period)

**Missing** · effort L · priority P1 · risk high

> Each capability score carries trend (improving|stable|declining|insufficient_data) and change (numeric delta), and team growth charts show capability over time. *(TCI §4.3, §9)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:149-214 (user_capability_state has NO trend/change/history columns — it is point-in-time, upserted per recompute); scoring.ts:106-118 (score_results is an upsert, overwritten in place); CLAUDE.md timestamp gotcha: score_results.computed_at is rewritten by the nightly recompute so it cannot serve as a change history
- **Why users want it:** Managers and members can see whether a capability is getting stronger or slipping, not just its current level.
- **What has to change:** There is no stored history of past capability values, so a delta cannot be computed today. Add an append-only per-period capability snapshot (per person and/or per team) so trend/change are diffs between periods; 'insufficient_data' when fewer than two comparable periods exist.
- **Data & metric logic:** Snapshot mastery per (person, capability, period) on each recompute; trend = sign of latest-minus-prior beyond a directional threshold; feed team growth line charts and the coaching baseline/follow-up (§6.6).
- **Backend/API & UI impact:** New table + a recompute step that writes a period row; read models for growth screens.
- **Privacy & permissions:** A per-person capability time series is self-view-only under the same rule as the point-in-time state; only aggregate/team series may be manager-visible.
- **Dependencies & migrations:** Overlaps TCI-DATA-010 (TeamCapabilitySnapshot) and TCI-DATA-013 (version-change audit).
- **Tests & acceptance:** tenant-isolation SCOPED_READS entry + purge registration + ADR (the three-registration law); a delta test proving two snapshots produce the right trend and one snapshot yields insufficient_data.

### TCI-DATA-004 — Confidence always shown; low/medium/high band

**Partial** · effort S · priority P2 · risk low · quick win

> A capability score is never shown without confidence and evidence availability; confidence renders as low|medium|high (+ insufficient-data). *(TCI §4.3, §8)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:163-175 (confidence numeric [0,1] + confidenceTier + evidenceCount stored); src/scoring/capability-state.ts:109,154,164 (no evidence → NO row, the never-shown-without-confidence rule is already the honesty invariant); src/lib/capability-glossary.ts:45-56 (confidenceTierLabel) + 96-110 (early-read vs measured explainer)
- **Why users want it:** Users never see a bare score they might over-trust — the strength of the evidence is always attached.
- **What has to change:** The numeric confidence exists and the no-evidence-no-row rule already enforces 'never without evidence'. Missing only the low|medium|high display banding — a pure derivation from the stored numeric confidence (S). Note a real limitation to surface honestly: the engine is hard-capped `directional` and only reaches `measured` when ≥2 bound OTel markers exist, which most capabilities never have — so a genuinely 'high confidence' capability score is largely unreachable today; the low/med/high band must not imply otherwise.
- **Data & metric logic:** band = thresholds over user_capability_state.confidence; keep the confidenceTier (measured vs early-read) as the honest availability axis alongside it.
- **Backend/API & UI impact:** Shared Confidence Badge component (§8).
- **Dependencies & migrations:** OTel/measured tier for the top band to be reachable.
- **Tests & acceptance:** Derivation test mapping numeric confidence → band; a test that no CapabilityScore renders when evidenceCount is 0.

### TCI-DATA-005 — Manager-visible per-person capability score

**Blocked** · effort XL · priority P0 · risk high

> CapabilityScore.userId identifies a person and managers can view individual team-member capability profiles (§3.2, §6.4). *(TCI §4.3, §9)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:138-146 ('Self-view-only ... a per-person capability number NEVER leaves self-view (no team read surface consumes this table — P6's rollup aggregates it count-only)'); src/db/schema/recommendations.ts:29-30,226 (rec state + exposure are self-view-only, no manager read route); CLAUDE.md: companion-in-team-orgs (W6-A) is founder-gated on a ~6-week dogfood clock since 2026-07-14
- **Why users want it:** Managers can coach based on where each person is strong or needs help.
- **What has to change:** This is the single biggest change in the whole spec and is NOT a UI task: today every per-person capability/mastery/rec surface is structurally self-view-only by design. A manager-facing per-person capability view reverses that privacy model and must ride an explicit ADR + founder decision, and it is entangled with the W6-A companion-in-team-orgs gate (do not force it). Aggregate, count-only, MIN_PEOPLE-floored team views (P6 pattern) are the sanctioned path until that gate clears.
- **Data & metric logic:** Any manager read of user_capability_state needs a new authorized read route with visibility-mode + MIN_PEOPLE + pseudonymization enforcement equivalent to the dashboard's assertTeamOnlyPseudonymized.
- **Backend/API & UI impact:** New authorized read surfaces; org-scope additions; privacy audit predicates.
- **Privacy & permissions:** Central privacy-model reversal; must respect visibilityMode (private/managed/full) and the pseudonymous default (core.ts:86-91).
- **Dependencies & migrations:** W6-A dogfood outcome; founder ADR; docs/product-signoffs.md.
- **Tests & acceptance:** Manager cannot read another person's raw capability score in `private` mode; MIN_PEOPLE floor on any aggregate; cross-org isolation.

### TCI-DATA-006 — Team entity (Team)

**Partial** · effort M · priority P0 · risk medium

> Team = { id, workspaceId, name, managerIds[], memberIds[], rolePackIds[], settings }. *(TCI §9)*

- **What exists today (evidence):** src/db/schema/core.ts:138-183 (teams table: id, orgId, name; team_members: org_id, team_id, person_id with composite tenant FKs); tests/tenant-isolation.test.ts:65-66 (teams.list, teams.members) and :544 (teams.addMember)
- **Why users want it:** A real, org-scoped grouping of people a manager is responsible for.
- **What has to change:** id, workspaceId (=org_id), name, and memberIds (via team_members) all exist. Missing: managerIds — there is NO team-level manager concept (org_members carries an org-wide admin|member role from invites, core.ts:197, but nothing marks a person/user as manager OF a specific team); rolePackIds (see TCI-DATA-008); settings (see TCI-DATA-007). Add a team-manager mapping and the two references.
- **Data & metric logic:** team-manager assignment table or column keyed (org_id, team_id, user_id); drives §3.2 permission scoping.
- **Backend/API & UI impact:** Team CRUD + manager assignment (admin flows, §3.3); permission checks.
- **Privacy & permissions:** Manager scoping gates who can see which team's aggregates.
- **Dependencies & migrations:** TCI-DATA-007, TCI-DATA-008.
- **Tests & acceptance:** tenant-isolation coverage already exists for teams/team_members; add manager-assignment isolation.

### TCI-DATA-007 — TeamSettings persistence

**Missing** · effort L · priority P1 · risk medium

> Per-team configuration: enabled universal capabilities, enabled role packs, capability importance, custom skill labels, visibility toggles (member aggregates, individual cost, prompt evidence, mentor recs, note privacy), concentration thresholds, benchmark config. *(TCI §9, §6.12)*

- **What exists today (evidence):** src/db/schema/core.ts:138-154 (teams table has only id/orgId/name — no settings jsonb or child config); no team-settings table in src/db/schema/*.ts
- **Why users want it:** Admins/managers tune what the team product measures and who can see what, per team.
- **What has to change:** New org-scoped team-settings table (or a settings jsonb on teams). Note the org already has an org-level visibilityMode (core.ts:86-91) — decide whether team visibility overrides or inherits it rather than duplicating the concept.
- **Data & metric logic:** Config consumed by capability filtering, cost visibility gating, concentration thresholds (§6.7 'thresholds must be configurable').
- **Backend/API & UI impact:** Team Settings surface (§6.12); every read that honors a toggle.
- **Privacy & permissions:** 'whether managers see individual cost' and 'whether prompt-level evidence is available' are privacy-critical toggles — but note prompt-content ingestion in Team mode is a hard tripwire, so a 'prompt-level evidence' toggle must never expose raw prompt content.
- **Dependencies & migrations:** TCI-DATA-006.
- **Tests & acceptance:** L: ADR + SCOPED_READS + purge registration; toggle-enforcement tests (a disabled cost-visibility toggle blocks the manager cost read).

### TCI-DATA-008 — RolePack entity

**Partial** · effort L · priority P2 · risk medium

> RolePack = { id, name, capabilityIds[], version, status(draft|active|deprecated) } grouping role-specific capabilities; packs for Engineering, Product, Marketing, Sales, CS, HR, Finance, Operations. *(TCI §9, §4.2)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:31-67 (domains table groups capabilities by area, Engineering only; capabilities.domainSlug); src/db/schema/roles.ts:23-32 (roles = per-person role slugs, engineering-only seed, NOT a capability bundle); CLAUDE.md: non-eng role expansion is DEFERRED/gated on an honest role-telemetry source that doesn't exist
- **Why users want it:** Role-specific capability sets layered on the universal model.
- **What has to change:** The closest existing construct is `domains` (a capability grouping) — but there is no versioned, status-bearing RolePack that bundles capabilityIds, and `roles` is a different thing (a person's job role, not a capability pack). Engineering content exists as the 9-capability seed; the other 7 packs do not exist and are explicitly gated (no honest non-eng telemetry). Model RolePack as either an evolution of `domains` or a new reference table; keep Engineering-only at launch per §14.
- **Data & metric logic:** RolePack→capabilities membership; status filters which packs are live.
- **Backend/API & UI impact:** Capability matrix columns, role-pack breakdowns, team settings enablement.
- **Dependencies & migrations:** Non-eng packs Blocked on role-telemetry source (CLAUDE.md).
- **Tests & acceptance:** Seed-contract test that pack.capabilityIds resolve to live capabilities.slug (mirrors existing capability-signals seed test).

### TCI-DATA-009 — CapabilityDefinition entity

**Partial** · effort S · priority P2 · risk low · quick win

> CapabilityDefinition = { id, name, description, category(universal|role_specific), scoringVersion, evidenceTypes[] }. *(TCI §9)*

- **What exists today (evidence):** src/db/schema/capability-graph.ts:47-67 (capabilities: slug PK, label, summary, version, workflow/playbook/learningPath) + 75-110 (capability_signals binds each capability to metric/component evidence)
- **Why users want it:** A stable, versioned definition of each capability and what evidence feeds it.
- **What has to change:** id=slug, name=label, description=summary, scoringVersion=version, and evidenceTypes are already modeled richer as capability_signals bindings. The one missing field is `category` (universal vs role_specific) — an additive column with a small backfill (all 9 current seeds are Engineering/role_specific-ish; the §4.1 universal-7 dimensions do not yet exist as rows — that overlaps the capability-model domain). Adding the column touches the frozen schema, so it needs an ADR.
- **Data & metric logic:** category discriminates universal dimensions from role-pack capabilities in matrix columns and settings.
- **Backend/API & UI impact:** Matrix column grouping; team-settings enablement lists.
- **Dependencies & migrations:** Universal-dimension seed (capability-model domain).
- **Tests & acceptance:** Migration-equivalence guard already pins capability output; extend the seed-contract test to assert every capability has a category.

### TCI-DATA-010 — TeamCapabilitySnapshot entity

**Missing** · effort L · priority P1 · risk high

> TeamCapabilitySnapshot = { id, teamId, periodStart, periodEnd, overallScore, capabilityScores(Record), maturityDistribution(Record), confidence, representedMemberCount, totalMemberCount }. *(TCI §9)*

- **What exists today (evidence):** src/db/schema/scoring.ts:61-119 (score_results supports subjectLevel 'team' with teamId — but only for the 3 frozen score definitions, NOT per-capability, and it is upserted/overwritten); no persisted team capability aggregate or maturity-distribution table; P6 rollup (per CLAUDE.md) is computed count-only at read time in readDashboardView, not stored
- **Why users want it:** A durable per-period team capability summary powering the overview, growth trend, and — critically — coaching baseline/follow-up snapshots.
- **What has to change:** Team-level scoring exists for adoption/fluency/efficiency, but there is no persisted per-capability team aggregate, no stored maturity distribution, and no represented-vs-total member snapshot. Add an append-only snapshot table so (a) team trend/change is computable, (b) CoachingCampaign.baselineSnapshotId (§6.6) has something to point at, and (c) reports (§6.11) are reproducible. Keep it aggregate/count-only to respect the individual-privacy model.
- **Data & metric logic:** On recompute, write per-team capability aggregates + maturity-level counts + represented/total members; MIN_PEOPLE floor so a capability below the floor is omitted entirely, never a suppressed-but-implied number.
- **Backend/API & UI impact:** Recompute job writes it; Team Overview / Growth / Reports read it.
- **Privacy & permissions:** Aggregate + MIN_PEOPLE-floored; carries no person id (the P6 rule).
- **Dependencies & migrations:** TCI-DATA-003 (trend), TCI-DATA-006 (team-manager scoping).
- **Tests & acceptance:** L: ADR + SCOPED_READS + purge registration; a floor test that a below-MIN_PEOPLE capability is dropped, not zero-filled.

### TCI-DATA-011 — CostAllocation entity

**Partial** · effort M · priority P2 · risk medium

> CostAllocation = { userId?, teamId, provider, model?, period, amount, currency, confidence, allocationMethod } with allocated-vs-unallocated spend and allocation confidence. *(TCI §9, §6.8)*

- **What exists today (evidence):** src/db/schema/tracking.ts:173-222 (metric_records: per subject/day, value in usd_cents via metric_catalog unit, dim carries model=…, source_connector identifies the provider, attribution level per row); src/db/schema/billing.ts:70-103 (budgets is an org-level monthly ceiling only; comment: month-to-date spend is derived on read from spend_cents metric_records, no ledger)
- **Why users want it:** Managers see spend by provider/model/role/member and how much cost cannot be attributed to a person — without cost ever feeding capability scores.
- **What has to change:** The spend FACTS exist (per subject, per model, per day, in cents, with an attribution level and source connector) and can be aggregated by team/provider/model like today's budget read. Missing: an explicit allocation model — allocationMethod, a per-allocation confidence, allocated-vs-unallocated split, and multi-currency (today everything is usd_cents). This can likely be a compute-on-read view (like budgets) rather than a new table; only persist if snapshots/reports need reproducibility. Keep cost strictly out of capability scoring (an acceptance criterion, §16).
- **Data & metric logic:** 'unallocated' = spend on subjects with no resolved person identity (attribution below person level) — the attribution ladder already encodes this; allocation confidence derives from attribution level + identity-resolution completeness.
- **Backend/API & UI impact:** Costs & Efficiency screen; cost snapshot on overview; personal cost analytics (§7.2).
- **Privacy & permissions:** Per-person cost visible to a manager is gated by a team-settings visibility toggle (TCI-DATA-007) and by the same self-view considerations as capability data; do not surface named individual spend by default.
- **Dependencies & migrations:** TCI-DATA-007 (cost-visibility toggle).
- **Tests & acceptance:** Aggregation test that unallocated = sum of below-person-attribution spend; a guard that cost never enters a score_results/capability computation.

### TCI-DATA-012 — Background calculation jobs for team entities

**Partial** · effort M · priority P2 · risk medium

> Background jobs: individual capability recalculation, team aggregation, maturity distribution, growth calculation, cost allocation, insight generation (plus skill/mentor/concentration generation). *(TCI §9)*

- **What exists today (evidence):** CLAUDE.md + recompute-capability-state.ts (per-person capability recompute is a poller score-recompute step, all reads batched, query count independent of person count); P6 team coverage is read-time count-only, not a persisted job; src/db/schema/billing.ts:70-103 (cost derived on read, no allocation job)
- **Why users want it:** The team views stay current without per-request heavy computation.
- **What has to change:** Individual capability recalculation exists and is the reuse anchor. Team aggregation + maturity distribution currently happen at read time (count-only) and would need to become persisted-snapshot writers if TCI-DATA-010 lands. Cost allocation is read-derived. Skill extraction, mentor matching, concentration-risk, and manager-insight generation are new jobs owned by other domains (skills/coaching/insights) — noted here only as producers/consumers of the DATA entities.
- **Data & metric logic:** Add a team-snapshot writer step to the existing poller recompute pipeline; keep the batched-read discipline (no per-person query).
- **Backend/API & UI impact:** Poller step additions; no new frozen contract if it reuses org-scope readers.
- **Privacy & permissions:** Snapshot writers must apply the MIN_PEOPLE floor at write time.
- **Dependencies & migrations:** TCI-DATA-010.
- **Tests & acceptance:** A perf test that team aggregation stays O(1) in query count vs team size (mirrors tests/perf/capability-state-queries).

### TCI-DATA-013 — Auditability record

**Partial** · effort M · priority P2 · risk medium

> Store scoring version, calculation timestamp, evidence categories, confidence inputs, changes between score versions, manager actions, and dismissed recommendations. *(TCI §9)*

- **What exists today (evidence):** src/db/schema/audit.ts:19-46 (audit_log: append-only, org-scoped, actor + dot-namespaced action + target, metadata — the manager-action trail); src/db/schema/capability-graph.ts:52,163-186 (capabilities.version=scoring version; user_capability_state stores confidence inputs + components=evidence categories + updatedAt); src/db/schema/recommendations.ts:31-69 (rec_interaction_state 'dismissed' — but SELF-VIEW ONLY, a person dismissing their own rec, not a manager dismissing an insight)
- **Why users want it:** Every score and every manager action is explainable and traceable after the fact — a trust requirement (§16 Privacy).
- **What has to change:** Well covered on three of seven items: manager actions have audit_log (new coaching verbs to add, no schema change), evidence categories + confidence inputs live in user_capability_state.components/confidence, and scoring version is capabilities.version. Two real gaps: (1) 'changes between score versions' — there is NO score/capability history; score_results is upserted and its computed_at is rewritten each recompute (CLAUDE.md gotcha), so a version-over-version diff cannot be reconstructed today (this is the same missing history as TCI-DATA-003/010). (2) 'dismissed recommendations' at the manager/insight level differs from the existing self-view rec_interaction_state — a ManagerInsight.status='dismissed' is a new, manager-scoped concept.
- **Data & metric logic:** Score-version history comes from the append-only snapshot (TCI-DATA-010); manager insight dismissal is a status on the (new) manager-insight entity; manager coaching actions emit audit_log rows.
- **Backend/API & UI impact:** Scoring & Disclosure settings (§6.12) reads score version/cadence/thresholds; audit trail surfaces.
- **Privacy & permissions:** audit_log metadata already forbids credentials/payloads — keep evidence categories as labels, never prompt content.
- **Dependencies & migrations:** TCI-DATA-010 (version history), manager-insight entity (insights domain).
- **Tests & acceptance:** A test that a recompute writes a new history row rather than overwriting (closing the computed_at gotcha); audit_log emitted for each manager coaching action.

<a id="telemetry"></a>
## Telemetry & capability signals

### TCI-TEL-002 — AI Communication dimension signals

**Conflicting** · effort M · priority P2 · risk high

> Score how effectively a user communicates objectives, context, constraints, output structure, and examples to AI (clarity/completeness/constraint/structure/examples). *(TCI §4.1)*

- **What exists today (evidence):** tci.md:167-181 signal list is prompt-text-derived; no such key in src/contracts/metrics.ts:53-108; local-log denylist forbids message.content (docs/connector-facts.md:357-360); only proxy is acceptance ratio (metrics.ts:65-66, effective-prompting seed drizzle/0030:76-78)
- **Why users want it:** Intended: help users write better prompts. Honest reality: only an outcome proxy (are suggestions accepted?) is measurable without reading prompts.
- **What has to change:** Recommend narrowing Communication to the acceptance-ratio proxy (suggestions_accepted/offered) and RENAMING it away from 'communication quality', or dropping the dimension. Do NOT build the clarity/context/constraint subsignals — they require prompt-content ingestion, a founder-signed Team-mode tripwire. context_tokens (metrics.ts:98-107) exists but has no producer and is not a communication-quality signal.
- **Data & metric logic:** Bind only suggestions_accepted/suggestions_offered; label it an outcome proxy, never 'clarity'. No content parsing.
- **Backend/API & UI impact:** Backend: reuse effective-prompting capability. UI: honest label + confidence disclosure.
- **Privacy & permissions:** Building the full spec version would breach the no-prompt-content-in-Team-mode tripwire and principle 2.4.
- **Dependencies & migrations:** Founder decision to accept the proxy-only scope; ADR if a new capability binding is added.
- **Tests & acceptance:** Assert no code path reads message.content; proxy capability output-equivalence.

### TCI-TEL-003 — AI Thinking dimension signals

**Conflicting** · effort XL · priority P3 · risk high

> Score use of AI for reasoning, research, planning, decomposition, option comparison, and synthesis. *(TCI §4.1)*

- **What exists today (evidence):** tci.md:183-197 signal list is entirely prompt/output-content-derived; no telemetry key or proxy exists in src/contracts/metrics.ts:53-108; docs/connector-facts.md field inventories expose no decomposition/planning/synthesis signal
- **Why users want it:** Intended: reward high-quality reasoning with AI. No honest telemetry supports it.
- **What has to change:** Recommend EXCLUDING this dimension from the telemetry-backed model. Measuring reasoning quality requires reading prompt/response content (banned in Team mode) — there is no proxy to fall back on, unlike Communication. Presenting a 'Thinking' score would either be fabricated (invariant b) or require the banned tripwire.
- **Data & metric logic:** None available.
- **Backend/API & UI impact:** Removing it from the universal set keeps the model honest.
- **Privacy & permissions:** Any real implementation breaches the no-prompt-content tripwire and the surveillance-avoidance principle 2.4.
- **Dependencies & migrations:** Founder decision to drop or defer; would need a genuinely new content-free source that does not exist.

### TCI-TEL-004 — AI Iteration dimension signals

**Partial** · effort M · priority P2 · risk medium

> Score refinement through feedback: follow-up depth, correction behaviour, iterative refinement, reuse of outputs, sustained task progression. *(TCI §4.1)*

- **What exists today (evidence):** retries + edit_actions_accepted/rejected exist but are UNBOUND (src/contracts/metrics.ts:67-69); sub-daily session/turn structure exists (subject_day_signals, metrics.ts:149-166); OTel edit decisions give real accept/reject (otel-ingest.ts:120-126). But 'correction behaviour' and 'reuse of previous outputs' are content-derived.
- **Why users want it:** A member/manager can see whether the user iterates and corrects with AI rather than one-shotting — an honest behavioural signal.
- **What has to change:** Bind a new iteration capability to retries + edit_actions_rejected/accepted + session depth; drop the content-derived subsignals (reuse-of-outputs, correction semantics). Note retries is a documented gap for several vendors (docs/connector-facts.md:84,156,225) so coverage is partial and must be disclosed.
- **Data & metric logic:** Follow-up/iteration proxy = session turn counts + retries + edit-rejection-then-acceptance patterns; content-free.
- **Backend/API & UI impact:** New capability + signal bindings (ADR-gated, additive to the frozen graph).
- **Privacy & permissions:** Content-free by construction.
- **Dependencies & migrations:** ADR + capability_signals binding; retries coverage varies by vendor.
- **Tests & acceptance:** Binding points at a live metric_catalog key (tests/capability-catalog.test.ts pattern); no-content assertion.

### TCI-TEL-005 — AI Verification dimension signals

**Missing** · effort L · priority P2 · risk high

> Score how consistently a user validates AI output: fact-checking, testing, source requests, cross-checking, uncertainty handling, review before use. *(TCI §4.1)*

- **What exists today (evidence):** No telemetry key for testing/fact-checking exists in src/contracts/metrics.ts:53-108; no vendor admin API exposes a test-run or verification signal (docs/connector-facts.md field inventories); OTel markers are active_time + code-edit decisions only (otel-ingest.ts:11-24). This is the exact capability tci.md Flow A (§12) builds a coaching campaign around.
- **Why users want it:** Intended flagship: help teams verify AI work. But nothing measures it today, so a Verification score would be fabricated.
- **What has to change:** Do not ship a Verification score from current telemetry. It needs a genuinely NEW honest source (e.g. CI/test-run telemetry, PR-review signals) — the content-based version (detecting fact-checking in prompts) is banned. Flag Flow A's 'Verification campaign' as depending on a source that does not yet exist.
- **Data & metric logic:** None today; would require a CI/test connector or an OTel test-decision marker to be designed.
- **Backend/API & UI impact:** XL: new connector or marker family + capability + registrations.
- **Privacy & permissions:** A content-inference version is a tripwire; a CI/test-telemetry version is content-free but is a new build.
- **Dependencies & migrations:** New telemetry source (does not exist); ADR; 3 registrations.

### TCI-TEL-006 — AI Workflow Integration dimension signals

**Partial** · effort M · priority P2 · risk medium

> Score how deeply AI is embedded in repeatable work: saved workflows, reusable prompts, templates, connected tools, automations, agent/multi-step workflows. *(TCI §4.1)*

- **What exists today (evidence):** agentic family (agent_sessions/agent_requests/agent_active, metrics.ts:81-83) + agentic-delivery seed (drizzle/0030:79-81); feature_used / MCP + subagent adoption from local-log tool_use.name (docs/connector-facts.md:353); but saved-workflows/reusable-prompts/templates have no signal
- **Why users want it:** A manager can see who has moved AI into repeatable, agentic, tool-connected workflows vs occasional chat — genuinely measurable for coding tools.
- **What has to change:** Map Workflow Integration to the existing agentic + feature/tool-usage signals; drop saved-workflow/template/reusable-prompt subsignals (no telemetry, and prompt reuse is content). Disclose that agent signals are per-vendor (only Copilot CLI + Cursor + Claude Code report agent fields, metrics.ts:76-83).
- **Data & metric logic:** agent_active/agent_sessions/agent_requests + feature breadth (MCP/tool names) as content-free workflow-depth proxy.
- **Backend/API & UI impact:** Reuse agentic-delivery + feature-breadth capabilities.
- **Privacy & permissions:** tool_use.name is name-only (allowlist), never input.
- **Dependencies & migrations:** Optional new capability binding (ADR if added).

### TCI-TEL-007 — AI Learning Velocity dimension signals

**Partial** · effort M · priority P1 · risk medium

> Score the rate of capability improvement: score change over time, recommendation adoption, new-capability acquisition, movement to advanced workflows, weakness reduction. *(TCI §4.1)*

- **What exists today (evidence):** This is internal-state, not vendor telemetry: capability-state history exists (src/scoring/capability-state.ts, directional/measured tiers per CLAUDE.md); rec adoption via rec_interaction_state + recommendation_exposure log; missions detect measured capability crossings (mig 0032/0037). Team-level velocity aggregation is new.
- **Why users want it:** A manager/member can see whether capability is actually improving over time and whether recommendations are being adopted.
- **What has to change:** Derive velocity from existing per-person capability-state deltas + rec-interaction/exposure + mission completions; no new telemetry source. New work is the team-level aggregation (count-only, MIN_PEOPLE floor) and exposing member-level velocity to managers (privacy-model change — see conflicts).
- **Data & metric logic:** Score-change over time from capability-state snapshots; rec-adoption from rec_interaction_state/exposure; new-capability from mission crossings. Note: never derive 'first score' timing from score_results.computed_at (rewritten nightly, CLAUDE.md timestamp gotcha) — use connector_runs / score-row existence.
- **Backend/API & UI impact:** Team aggregation surface; manager exposure of per-person velocity is the privacy question.
- **Privacy & permissions:** Per-person velocity to a manager reverses self-view-only mastery.
- **Dependencies & migrations:** W6-A companion-in-team-orgs is founder-gated (~6-week dogfood clock); manager per-person exposure is a privacy ADR.

### TCI-TEL-008 — Engineering role-pack capability feasibility

**Partial** · effort L · priority P1 · risk medium

> Provide Engineering-pack capabilities: code generation, debugging, testing, architecture reasoning, code review, context engineering, agentic development, dev-tool integration. *(TCI §4.2)*

- **What exists today (evidence):** Existing 9-cap eng seed maps SOME: code-review-with-ai (drizzle/0030:88-89, pull_requests+feature_used), agentic-delivery (79-81), ship-with-ai (85-87, commits/PRs/lines), model-selection (90-91). But debugging/testing/architecture-reasoning have NO signal (metrics.ts:53-108); context engineering's context_tokens key exists (metrics.ts:98-107) but has NO producer (emitter fixture-gated, D11).
- **Why users want it:** Engineering is the one role where telemetry is strong (docs/connector-facts.md), so a meaningful pack is possible — but not all eight named capabilities.
- **What has to change:** Ship the measurable subset (code review, agentic development, shipping-with-AI, dev-tool integration, model selection). Exclude or defer debugging/testing/architecture-reasoning (no honest signal) and context-engineering (context_tokens has no producer — needs the Anthropic usage-report context_window harvest, documented but not built, metrics.ts:104-107). Note the seed's capability slugs differ from TCI's names — reconcile vocabulary.
- **Data & metric logic:** Reuse existing bindings; context-engineering blocked on a real recorded context_window payload (rule 2).
- **Backend/API & UI impact:** Vocabulary reconciliation between seed slugs and TCI capability names.
- **Dependencies & migrations:** context_tokens producer (fixture-gated); ADR for any new binding.
- **Tests & acceptance:** tests/capability-catalog.test.ts binding-liveness guard.

### TCI-TEL-009 — Non-engineering role packs (Product/Marketing/Sales/CS/HR/Finance/Operations) telemetry

**Blocked** · effort XL · priority P3 · risk high

> Provide role packs and universal-dimension scores for product, marketing, sales, customer success, HR, finance, and operations teams. *(TCI §4.2)*

- **What exists today (evidence):** All connected vendors are developer tools (docs/connector-facts.md:16-23 summary table: Copilot, Cursor, Anthropic, OpenAI, Claude Code); no M365/Workspace/CRM/design telemetry connector exists in src/connectors/registry.ts; CLAUDE.md records non-eng role expansion is DEFERRED pending 'an honest M365/Workspace role-telemetry source (doesn''t exist)'.
- **Why users want it:** Intended: a universal cross-department product. Blocked because there is no honest usage signal for non-developer AI work.
- **What has to change:** Do not build these packs on current telemetry — any score would be fabricated (invariant b). The gate is a real non-developer telemetry source (M365 Copilot, Google Workspace, ChatGPT Enterprise Compliance API, CRM). Keep the architecture role-agnostic (tci.md:2169) but ship engineering-only, as §14 itself recommends.
- **Data & metric logic:** No source; ChatGPT Team has no analytics API and Enterprise surfaces are workspace-entitlement not admin-key reachable (docs/connector-facts.md:269).
- **Backend/API & UI impact:** Requires one or more new connectors before any non-eng pack is possible.
- **Dependencies & migrations:** External: a non-developer AI telemetry source must exist and be connected; founder-gated role expansion (OQ-003/OQ-004).

### TCI-TEL-010 — Team Settings → Data Sources health panel

**Partial** · effort M · priority P1 · risk low · quick win

> Show connected providers, sync status, last sync, and data freshness in team settings. *(TCI §6.12)*

- **What exists today (evidence):** Connected-providers list + connected-source counts + per-connection latest-run honesty badges exist (src/lib/connections-view.ts:12-60; src/app/(app)/connections/page.tsx); last-sync via connections.markSynced (src/lib/agent-ingest.ts:213) and append-only connector_runs; freshness via data-confidence 'as-of' qualifier (src/lib/data-confidence.ts:62)
- **Why users want it:** An admin can see which telemetry sources feed the team and whether they are fresh and syncing — the trust foundation for every score.
- **What has to change:** Mostly a re-surfacing job: compose the existing connections-view + connector_runs + data-confidence data into a team-settings Data Sources section. Little-to-no new telemetry.
- **Data & metric logic:** Reuse countConnectedSources, latestGapKindsByConnection, connectorRuns.latest, and data-confidence freshness.
- **Backend/API & UI impact:** New settings surface reading existing derivations.
- **Dependencies & migrations:** Team-settings surface (manager/admin role gating).

### TCI-TEL-011 — Member matching status + allocation-gap disclosure

**Partial** · effort S · priority P2 · risk low · quick win

> Show member matching status and allocation/coverage gaps for team data sources. *(TCI §6.12)*

- **What exists today (evidence):** Identity resolution / unresolved-subject surfacing exists (src/app/(app)/reconcile/page.tsx, src/components/reconcile-subject-dialog.tsx, tracked_user contract src/contracts/tracked-user.ts: resolved vs surfaced-not-billed subjects); allocation/coverage gaps exist as honesty gaps in src/lib/data-confidence.ts (coverage/import-quality/sync-issues categories, lines 39-44)
- **Why users want it:** An admin can see which people's telemetry could not be matched (e.g. shared/service-account keys, OAuth-user holes) and where coverage is incomplete — critical for honest team scores.
- **What has to change:** Re-surface the reconcile + data-confidence data into the team Data Sources section; label the documented per-vendor person-level holes (Anthropic OAuth-user bug, OpenAI non-user-key, Copilot server-side-telemetry users — docs/connector-facts.md:28,90,235-241) as coverage gaps, never zero-fill.
- **Data & metric logic:** Reuse tracked_user resolution + honesty-gap coverage disclosures; counts only, MIN_PEOPLE-safe.
- **Backend/API & UI impact:** Reads existing surfaces into a team panel.
- **Privacy & permissions:** Surfacing unresolved subjects must remain count/aggregate where private-mode applies.
- **Dependencies & migrations:** Team-settings surface.

<a id="metrics"></a>
## Metrics, cost & measurement

### TCI-MET-002 — No opaque efficiency score; explainable classifications first

**Partial** · effort M · priority P2 · risk medium

> Do not launch a single opaque 'AI Efficiency Score'; use explainable classifications, each of which explains why it was assigned. *(TCI §6.8 Efficiency Classification)*

- **What exists today (evidence):** Principle already honored: src/lib/metrics-glossary.ts:501,509 frames `efficiency` as a cost-efficiency (not ROI) read with plain-English explanation; drizzle/0030_capability-graph.sql:63,90-91 give explainable `cost-efficient-usage` and `model-selection` capabilities. But the specific per-member 6-bucket classifier (tci.md:1337-1347) joining capability-growth to spend does not exist anywhere in src/lib.
- **Why users want it:** A manager sees plain reasons ('high spend, limited observed growth') instead of an unexplained number, so they can act without distrusting a black box.
- **What has to change:** Add a pure classifier that labels each subject into the 6 explainable buckets from a growth signal + spend, with a per-bucket reason string. Keep the existing efficiency score and cost-efficient-usage capability as the honest backbone; do NOT introduce a blended opaque score.
- **Data & metric logic:** Join per-subject capability/maturity delta (score_results history / user_capability_state) against per-subject spend. Spend is largely org-level and often unallocatable per person (see TCI-MET-005), so most subjects will resolve to 'insufficient data' — that must be the honest default, never a fabricated bucket.
- **Backend/API & UI impact:** New lib module + a card on the team cost surface; classifier output is a label + reason, never a number folded into capability.
- **Privacy & permissions:** Per-subject classification is a manager-facing per-person read — subject to the same self-view-only/pseudonymized constraint as TCI-MET-005; count-only or band-first presentation preferred.
- **Dependencies & migrations:** Depends on resolving the per-member cost-allocation privacy question (TCI-MET-005) before any per-person efficiency label ships.
- **Tests & acceptance:** Unit tests per bucket incl. the insufficient-data path (empty spend or empty growth → 'insufficient data', never a real bucket); a guard that no single blended efficiency number is emitted.

### TCI-MET-003 — Team Cost Overview (aggregate spend, breakdowns, allocation confidence)

**Partial** · effort M · priority P1 · risk low

> Show total spend, period change, spend by provider/tool, spend by model, allocated vs unallocated spend, and cost-data confidence. *(TCI §6.8 Team Cost Overview)*

- **What exists today (evidence):** src/lib/spend-governance.ts:83-98 (month-to-date reported vs estimated), :178-207 (summarizeSpendByTool = by provider/tool), :218-233 (summarizeModelVolume = by model as TOKEN volume, not dollars), :432-497 (composed SpendGovernanceView with projection, cost-per-unit, model-mix trend). Present on the team view as an aggregate footer + budget banner: src/app/(app)/dashboard/team-overview.tsx:145-150,227-268. Missing: an explicit period-over-period spend delta, an explicit allocated-vs-unallocated percentage, and a dedicated 'cost-data confidence' figure.
- **Why users want it:** Managers get one honest spend picture — how much, on what tools, trending which way — without a per-person surveillance table.
- **What has to change:** Add period-change and allocated-vs-unallocated derivations to spend-governance (allocated = spend attributable to a resolved subject; unallocated = org-level spend that can't be split). Surface 'cost-data confidence' from the reported-vs-estimated ratio.
- **Data & metric logic:** period change = MTD reported vs prior-month same-window reported (vendor-reported only, never blended with estimated). Unallocated share = org spend minus sum of subject-attributable spend. Confidence derives from reported/(reported+estimated) coverage.
- **Backend/API & UI impact:** Extends SpendGovernanceView + a UI card; aggregate-only, no per-person rows.
- **Tests & acceptance:** Ratio-honesty tests: null period-change when prior window has no reported spend; unallocated never negative; confidence null when no spend at all.

### TCI-MET-004 — Spend by model shown as dollars

**Conflicting** · effort S · priority P2 · risk low

> Break spend down by model. *(TCI §6.8 (spend by model))*

- **What exists today (evidence):** src/lib/spend-governance.ts:14-16 and :210-233 deliberately present per-model TOKEN VOLUME, not dollars, because 'no connected vendor reports per-MODEL spend today … The absence is surfaced as a gap, never estimated into a fabricated cost.' TCI tci.md:1299 lists 'spend by model' under a cost (dollar) overview.
- **Why users want it:** Managers understand model usage mix — but honestly as usage share, since a per-model dollar figure would be invented.
- **What has to change:** Do NOT build a per-model dollar split. Keep the approved token-volume approach and label it clearly as usage mix, not cost. If a future vendor reports per-model dollars, add it then behind that real signal.
- **Data & metric logic:** model_tokens dim='model=…' volume share only (summarizeModelVolume); a dollar split is not derivable without fabricating (invariant b).

### TCI-MET-005 — Per-member / per-role cost table visible to managers

**Conflicting** · effort XL · priority P2 · risk high

> Give managers a per-member cost table (monthly spend, spend change, premium-model share, active days, efficiency classification, allocation confidence) and spend by role/by team member. *(TCI §6.8 Individual Cost Table)*

- **What exists today (evidence):** Team view is aggregate/count-only (src/app/(app)/dashboard/team-overview.tsx:145-150 shows only a total-spend footer; budget banner is role-gated at src/lib/spend-governance.ts:532-539). Spend is summed org-wide, never per person (spend-governance.ts:83-98,178-207). CLAUDE.md founder laws: mastery/capability state is self-view-only; MIN_PEOPLE floor + pseudonymized private mode. Per-model/per-person dollar allocation is largely unavailable (spend-governance.ts:14-16), and TCI itself concedes much spend is unallocatable (tci.md:1359).
- **Why users want it:** The intended value (spot who is expensive vs productive) is real, but delivering it as named per-person dollars would break the product's privacy promise and often show fabricated allocations.
- **What has to change:** Treat as a major privacy-model change, not a table. Recommend: (a) gate strictly behind an admin 'managers see individual cost' visibility toggle (TCI §6.12/§10 already asks for it); (b) present band-first / count-only where possible; (c) only show a per-person dollar when that person's spend is genuinely attributable, else 'unallocated'. Escalate the self-view-only reversal for founder sign-off before any per-person cost reaches a manager.
- **Data & metric logic:** Requires per-subject spend attribution that mostly does not exist today; premium-model share per person needs per-model-per-person tokens (not ingested per-dollar). Active days per person exists (active_day metric).
- **Backend/API & UI impact:** New manager-facing per-person surface + a new visibility permission + likely a new allocation table; multi-surface.
- **Privacy & permissions:** Direct reversal of the self-view-only posture and the count-only team law — the central risk of this whole section.
- **Dependencies & migrations:** Founder decision to allow manager-visible individual cost (privacy ADR); admin visibility config (TCI §6.12); companion-in-team-orgs W6-A is founder-gated on the ~6-week dogfood clock (since 2026-07-14) and gates any per-member manager surface built on companion data.
- **Tests & acceptance:** Tenant-isolation SCOPED_READS for any new cost-allocation table; a test that private/pseudonymized mode never leaks a named per-person dollar; unallocated-spend never mislabeled to a person.

### TCI-MET-006 — Honest cost-insight narratives (growth-vs-spend)

**Partial** · effort M · priority P2 · risk medium

> Produce plain-English cost insights (e.g. 'premium-model usage increased but capability growth stayed stable', 'low spend because adoption is low', 'growth without a spend increase', 'large share of spend unallocated'). *(TCI §6.8 Cost Insight Examples)*

- **What exists today (evidence):** src/lib/exec-report.ts:170-194 (honest vendor-reported spend line, estimated shown alongside, never blended), :296-305 (cost-per-active-user, ratio-honest); src/lib/metrics-glossary.ts:501,509 (efficiency framed as cost-efficiency, not ROI); src/lib/spend-governance.ts:349-413 (model-mix share-shift = the 'premium usage increased' signal). Missing: a composed insight feed that pairs a capability/growth movement with a spend movement into these specific sentences.
- **Why users want it:** Managers get a written 'here's what your spend is telling you' instead of raw dollars, with honesty about what can't be allocated.
- **What has to change:** Add a small insight-composer that maps (growth delta, spend delta, adoption level, unallocated share) to the approved sentence templates, reusing exec-report/spend-governance numbers. Must NOT recommend cutting access purely on cost (see TCI-MET-007).
- **Data & metric logic:** growth delta from score_results/capability history; spend delta from reported MTD vs prior; premium share shift from summarizeModelMixTrend; unallocated share from TCI-MET-003. Every sentence must degrade to a data-limitation note when a side is missing.
- **Backend/API & UI impact:** New lib module + placement in the manager insight feed / cost surface.
- **Privacy & permissions:** Team-aggregate insights are fine; per-person insights inherit TCI-MET-005 constraints.
- **Dependencies & migrations:** Reuses TCI-MET-003 (unallocated) and TCI-MET-002 growth join.
- **Tests & acceptance:** Snapshot tests per template incl. missing-side fallbacks; a banned-phrasing sweep so no insight implies ROI or productivity.

### TCI-MET-007 — Cost insights must not recommend cutting access solely for being expensive

**Partial** · effort S · priority P2 · risk low

> Never frame cost reduction as the default objective; never recommend reducing a user's access just because they are expensive. *(TCI §6.8 / §7.2 / §16)*

- **What exists today (evidence):** Copy already resists ROI/cost-cut framing: src/lib/metrics-glossary.ts:501 ('never estimates the value or time your team actually produced'), :509 ('never an ROI figure'). No automated recommendation currently tells a manager to cut access. But there is no explicit guard/test ensuring a future cost insight or recommendation can't say 'reduce access because expensive'.
- **Why users want it:** Protects employees from being penalized for high (possibly high-value) AI usage; keeps the product coaching-first, not cost-policing.
- **What has to change:** When TCI-MET-006 insight templates land, add a banned-phrasing/guard test that forbids access-reduction recommendations keyed on spend alone; any model-selection nudge must be evidence-backed (existing model-selection capability), not cost-alone.
- **Dependencies & migrations:** Pairs with TCI-MET-006.
- **Tests & acceptance:** Banned-phrasing test over cost-insight and recommendation copy (no 'reduce/revoke access because … cost/expensive'); model-selection recs require a model-mix signal, not just high spend.

### TCI-MET-008 — §15 Activation metrics for the team product

**Partial** · effort M · priority P1 · risk low

> Measure % of workspaces creating a team, % of managers opening Team Overview, % of teams with sufficient data coverage, % of managers viewing Capability Matrix. *(TCI §15 Activation)*

- **What exists today (evidence):** Row-derivable half exists: src/lib/launch-funnel.ts:168-209 + src/db/system.ts:190-257 (orgs→connected→backfilled→activated funnel, personal→team conversion). 'Sufficient data coverage' maps to existing confidence/coverage (MIN_PEOPLE, data-confidence.ts). Missing: view-side events for Team Overview and Capability Matrix — src/lib/launch-events.ts:24-39 only defines landing_view/digest_return/companion_revisit; no team/manager/matrix event (grep confirmed none in worker.ts).
- **Why users want it:** Tells the team whether managers actually adopt the manager surfaces, so the team product is measured, not assumed.
- **What has to change:** Add new LaunchEventName events (e.g. team_overview_view, capability_matrix_view) emitted at the src/worker.ts edge seam like landing_view; add a team-creation funnel stat from org.kind='team' rows. Keep counts-only, no identity.
- **Data & metric logic:** Team-creation % and data-coverage % are row-derivable (extend readLaunchFunnelRows); the two view metrics need the new Analytics Engine events read via a script mirroring digest-return-rate.ts.
- **Backend/API & UI impact:** Extends the event pipeline + launch-metrics script; no schema change (Analytics Engine, not Postgres).
- **Privacy & permissions:** Events carry no person identity (existing pattern — writeLaunchEvent writes event/dim/host only).
- **Dependencies & migrations:** Depends on the team surfaces (Team Overview / Capability Matrix) actually existing to instrument.
- **Tests & acceptance:** isTeamOverviewView/isCapabilityMatrixView predicate tests (GET/HEAD, exact path) mirroring isLandingPageView; null-safe funnel rates.

### TCI-MET-009 — §15 Engagement metrics (manager active, insight opens, coaching action, report views, expert searches)

**Partial** · effort M · priority P1 · risk low

> Measure weekly manager active rate, insight-card open rate, coaching recommendation action rate, report-view rate, and expert-directory searches. *(TCI §15 Engagement)*

- **What exists today (evidence):** Coaching/recommendation action + dismissal already computable: src/db/system.ts:310-362 recEngagementRollup (shown/tried/dismissed/snoozed, counts-only, no personId in RecEngagementRollupRow). But insight-card-open, report-view, expert-directory-search, and weekly-manager-active have NO events — src/lib/launch-events.ts:24-39 event union lacks them; no expert directory or report surface is instrumented.
- **Why users want it:** Shows whether managers engage with the intelligence (open insights, act on coaching, run reports) versus glance once and leave.
- **What has to change:** Add events for insight_open, report_view, expert_search, and a manager-active signal; keep the existing recEngagementRollup for coaching action rate (already good). Report the ratios in a manual metrics script, no baked pass/fail threshold (OQ-001 pattern).
- **Data & metric logic:** coaching action rate = tried/(shown) from recEngagementRollup; the other three are new edge-seam events read from Analytics Engine; weekly-manager-active = distinct manager sessions/week (needs a manager-scoped event, careful to stay counts-only).
- **Backend/API & UI impact:** Event pipeline extension + metrics script; no Postgres schema change.
- **Privacy & permissions:** Counts-only; a per-manager 'active' metric must aggregate, never expose an individual manager's activity to peers.
- **Dependencies & migrations:** Depends on Insights, Reports, and Skills-and-Experts surfaces existing to instrument.
- **Tests & acceptance:** Event-predicate tests; a test that RecEngagementRollupRow stays personId-free (existing law).

### TCI-MET-010 — §15 Capability-outcome metrics

**Partial** · effort M · priority P2 · risk medium

> Measure improvement in weak team capabilities, increase in advanced-capability coverage, reduction in knowledge concentration, recommendation completion, and sustained capability growth. *(TCI §15 Capability Outcomes)*

- **What exists today (evidence):** Building blocks exist: score_results history + user_capability_state (directional/measured) power capability trend; recommendation completion ≈ recEngagementRollup 'tried' (src/db/system.ts:330-341); knowledge-concentration coverage counts exist in the team P6 rollup (CLAUDE.md W7 P6 count-only capability-coverage card). Missing: packaged period-over-period outcome metrics (e.g. 'weak capability improved', 'advanced coverage increased', 'concentration reduced') as computed figures.
- **Why users want it:** Proves the product's core promise — that capability actually grows and concentration actually reduces — rather than just showing a snapshot.
- **What has to change:** Add period-over-period derivations over score/capability history and the existing coverage counts; reuse the ratio-honesty pattern (null when a period lacks data). Aggregate/count-only.
- **Data & metric logic:** weak-capability improvement = delta of lowest-scoring team capability across periods; advanced coverage = count crossing an 'advanced' band over time; concentration reduction = change in the P6 coverage-count distribution; recommendation completion from recEngagementRollup.
- **Backend/API & UI impact:** New derivations in a lib/script; no schema change if reading existing score/capability tables.
- **Privacy & permissions:** Count-only, MIN_PEOPLE-floored (reuse SEGMENT_MIN_PEOPLE_TO_NAME), no per-person outcome exposed.
- **Dependencies & migrations:** Team capability/coverage surfaces from Wave 7 P6; some depend on companion-in-team-orgs (W6-A, founder-gated) for team member data.
- **Tests & acceptance:** Null-on-empty-period tests; MIN_PEOPLE floor so a below-floor capability is dropped, never a suppressed-but-implied number.

### TCI-MET-011 — §15 Trust metrics (confidence coverage, explanation usage, dismissal, disputes, disclosure rate)

**Partial** · effort L · priority P2 · risk medium

> Measure % of scores at medium/high confidence, score-explanation usage, manager dismissal rate for inaccurate insights, user disputes/corrections, and incomplete-data disclosure rate. *(TCI §15 Trust)*

- **What exists today (evidence):** Dismissal rate is computable now (recEngagementRollup 'dismissed', src/db/system.ts:338-341). Confidence tiers exist (directional/measured, src/scoring/capability-state.ts; data-confidence framework src/lib/data-confidence.ts). Missing: an aggregate '% of scores at medium/high confidence' figure, a score-explanation-open event, a disclosure-shown-rate metric, and any user-dispute/correction mechanism (none in repo).
- **Why users want it:** Lets the team watch whether users trust the scores — do they open explanations, dispute, or dismiss — which is the honesty-first product's key health signal.
- **What has to change:** Add: an aggregate confidence-coverage derivation over score/capability rows; an explanation_open event; a disclosure_shown counter (data-confidence already knows when it renders); a lightweight dispute/correction capture flow (net-new). Dismissal rate reuses recEngagementRollup.
- **Data & metric logic:** confidence coverage = share of capability rows at measured/high tier; explanation usage + disclosure rate are new edge/interaction events; disputes need a new capture surface + likely a small table.
- **Backend/API & UI impact:** Event pipeline + data-confidence instrumentation + a possible new dispute table (that one is L: table + ADR + registrations).
- **Privacy & permissions:** Counts-only aggregates; a dispute record is personal data — org-scoped, purge-registered.
- **Dependencies & migrations:** Dispute mechanism is net-new product scope; confidence-coverage depends on capability data present in team orgs (W6-A gate for member data).
- **Tests & acceptance:** Aggregate confidence null when no scores; dispute table tenant-isolation SCOPED_READS + purge registration if built.

### TCI-MET-012 — §15 Cost-outcome metrics

**Partial** · effort M · priority P2 · risk low

> Measure allocated-spend coverage, reduction in unnecessary premium-model usage, capability growth relative to spend, and number of actionable cost insights. *(TCI §15 Cost Outcomes)*

- **What exists today (evidence):** Derivable today: allocated-vs-unallocated from reported-vs-estimated (src/lib/spend-governance.ts:83-98 + TCI-MET-003); premium-model usage shift from summarizeModelMixTrend (:349-413); capability-growth-relative-to-spend ≈ the existing `efficiency` score (metrics-glossary.ts:494-514) + output_per_spend/engagement_per_spend. Missing: a packaged 'allocated-spend coverage %' metric, a period-over-period premium-usage-reduction figure, and an 'actionable cost insights count' (depends on TCI-MET-006 existing).
- **Why users want it:** Shows the operational-efficiency payoff honestly (coverage of spend data, premium-usage trend, value-per-dollar) without turning cost-cutting into the product's goal.
- **What has to change:** Add allocated-coverage % and premium-usage-reduction derivations (vendor-reported only); count actionable cost insights once TCI-MET-006 lands. Never present as ROI.
- **Data & metric logic:** allocated coverage = attributable spend / total spend; premium reduction = premium share delta from model-mix trend; growth-relative-to-spend reuses the efficiency score — do not invent a new blended number.
- **Backend/API & UI impact:** Script/lib derivations over existing spend-governance; no schema change.
- **Privacy & permissions:** Aggregate-only.
- **Dependencies & migrations:** 'Actionable cost insights count' depends on TCI-MET-006; premium/coverage depend on spend-governance (present).
- **Tests & acceptance:** Ratio-honesty: coverage null when no spend; premium-reduction null with <2 complete weeks (reuse summarizeModelMixTrend's guard).

<a id="backend"></a>
## Backend jobs, reports & notifications

### TCI-BE-002 — Team aggregation + team capability snapshot persistence

**Partial** · effort L · priority P1 · risk medium

> A job aggregates member capability into a team-level view (TeamCapabilitySnapshot: overallScore, per-capability scores, maturity distribution, represented vs total member count) and stores period snapshots. *(TCI §9)*

- **What exists today (evidence):** src/lib/dashboard-view.ts (team overview derived on read-path, count-only) and src/lib/maturity.ts readMaturityView aggregate org-level today, but there is NO snapshot table (grep of src/db/schema found none); usage-distribution.ts:36 MIN_PEOPLE_FOR_DISTRIBUTION floors small groups
- **Why users want it:** Managers get one reliable team capability number with coverage, and can chart it over time.
- **What has to change:** Add a team_capability_snapshot table + a per-period aggregation step in the poller (slot next to recompute-capability-state); persist the eight-number board plus per-capability rollups per period so the Growth chart reads history, not a live re-derivation.
- **Data & metric logic:** Aggregate user_capability_state + score_results across the team; represented/total member counts from identities; reuse mastery.coverageCounts + MIN_PEOPLE floor so no capability below the floor is emitted.
- **Backend/API & UI impact:** New backend surface + a read route for the team overview/growth chart.
- **Privacy & permissions:** Aggregate/count-only is safe, but any snapshot that stores per-member capability crosses the self-view-only line — keep snapshots aggregate-only unless the privacy model changes.
- **Dependencies & migrations:** Persisting per-member team capability depends on W6-A companion-in-team-orgs (founder-gated dogfood clock since 2026-07-14).
- **Tests & acceptance:** tenant-isolation SCOPED_READS + purge registration for the new table; golden aggregation test; MIN_PEOPLE floor test.

### TCI-BE-003 — Maturity/capability distribution by member counts

**Partial** · effort M · priority P1 · risk medium

> A job computes member counts by maturity level (inactive/beginner/intermediate/advanced/expert) per capability and for the team overall. *(TCI §9, §6.1)*

- **What exists today (evidence):** src/lib/usage-distribution.ts computes band tallies + concentration aggregate-only; src/lib/maturity.ts produces one org maturity level; there is no per-capability level distribution across named/counted members
- **Why users want it:** Managers see how capability is spread across the team, not just an average.
- **What has to change:** Add a count-only distribution step over user_capability_state mastery tiers per capability; emit tallies, never per-person rows.
- **Data & metric logic:** Bucket mastery/confidenceTier from user_capability_state into the five levels; count per bucket; suppress buckets under MIN_PEOPLE.
- **Backend/API & UI impact:** Feeds the Team Overview capability-distribution bar.
- **Privacy & permissions:** Counts are safe; click-through 'filter into Team Members' (a named per-member list) is the privacy-crossing part, not the counts.
- **Dependencies & migrations:** Same self-view-only + W6-A gate as TCI-BE-002 for any named drill-down.
- **Tests & acceptance:** Distribution golden test; floor test.

### TCI-BE-004 — Growth / movement calculation

**Partial** · effort M · priority P2 · risk medium

> A job computes capability change over time: velocity, movement up/down a level, plateau, and decline counts. *(TCI §9, §6.5)*

- **What exists today (evidence):** src/lib/recent-movement.ts computeRecentMovement; src/lib/attribution-trend.ts; maturity plateau logic in src/lib/maturity.ts (kind: insufficient|stale|growing|flattened); exec-report.ts:455 already calls computeRecentMovement
- **Why users want it:** Managers see whether the team is improving, plateaued, or declining.
- **What has to change:** Extend movement to per-capability level-crossing counts (moved up / down / stable / insufficient) and expose team-level counts; keep the honest 'insufficient_data' state rather than a fabricated flat.
- **Data & metric logic:** Diff current vs prior period snapshots (TCI-BE-002); reuse plateau kinds; label forecasts as projections with assumptions per §6.5.
- **Backend/API & UI impact:** Feeds Growth screen movement counts + coaching-impact framing.
- **Privacy & permissions:** Aggregate counts are safe.
- **Dependencies & migrations:** Needs the period snapshots from TCI-BE-002 to diff against.
- **Tests & acceptance:** Movement golden test incl. insufficient-data path.

### TCI-BE-005 — Skill extraction job

**Conflicting** · effort XL · priority P3 · risk high

> A job detects/extracts discrete AI-related skills per person (prompt design, verification, automation, specific tools, role-specific workflows) with proficiency and evidence recency. *(TCI §9, §6.7)*

- **What exists today (evidence):** No skill-extraction code exists (grep for skill.extract found nothing); CLAUDE.md tripwire 'no prompt-content ingestion in Team mode'; agent collection is content-free by design (src/lib/agent-collection-schema.ts, desktop-collector memory 'content-free events')
- **Why users want it:** Managers can find who is good at what.
- **What has to change:** Recommend deriving 'skills' ONLY from the existing content-free capability_signals/markers, not from prompt text — a true skill extractor that reads conversation content is a banned tripwire in Team mode. Reframe as a projection of the 9-capability graph, or defer.
- **Data & metric logic:** If pursued: map existing measured/directional capabilities → skill labels via a glossary (capability-glossary pattern), no NLP over prompts.
- **Backend/API & UI impact:** Skills tab + Skills & Experts screen.
- **Privacy & permissions:** Reading prompt content to infer skills would violate the Team-mode content tripwire AND the self-view-only mastery model.
- **Dependencies & migrations:** Blocked by the prompt-content tripwire for any content-based extractor.
- **Tests & acceptance:** Banned-phrasing/content-source guard.

### TCI-BE-006 — Mentor matching job

**Missing** · effort XL · priority P2 · risk high

> A job matches learners to internal mentors per capability with a mentor-confidence score and workload/conflict warnings. *(TCI §9, §6.6)*

- **What exists today (evidence):** No mentor code exists (grep for mentor found nothing in src/); roles/role_assignments exist (src/db/org-scope) but carry no proficiency-for-mentoring signal
- **Why users want it:** Managers pair strong members with those who need coaching.
- **What has to change:** New matching computation + a mentor-match/assignment table; requires manager-visible per-person capability (a rank of who is strong), which is the self-view-only model reversal.
- **Data & metric logic:** Rank per-capability mastery across the team, gate on a proficiency floor, exclude the learner, surface workload from active_day volume.
- **Backend/API & UI impact:** Coaching Center Mentor Matches + assignment writes.
- **Privacy & permissions:** MAJOR: exposing 'member X is an expert in Y' to a manager reverses the deliberate self-view-only mastery model — flag as a privacy-model change, not a feature add.
- **Dependencies & migrations:** Blocked by W6-A companion-in-team-orgs gate + the self-view-only reversal (needs a founder-signed privacy ADR like P7's exposure-log reversal).
- **Tests & acceptance:** tenant-isolation + purge registration for the new table.

### TCI-BE-007 — Concentration-risk detection (per-capability, configurable thresholds)

**Partial** · effort M · priority P2 · risk medium

> A job flags capabilities where expertise is concentrated in one or two members, with configurable risk thresholds (low/moderate/high/critical). *(TCI §9, §6.7)*

- **What exists today (evidence):** src/lib/usage-distribution.ts computes top-decile PROMPT concentration (aggregate, org-level, uncalibrated); src/lib/maturity.ts concentration number; exec-report.ts:284 concentration section — but it is by prompt volume, not per-capability expert count, and thresholds are hard-coded/directional
- **Why users want it:** Managers spot bus-factor risk before a key person leaves.
- **What has to change:** Add per-capability concentration over mastery (how many members hold advanced proficiency), plus a configurable threshold setting; keep counts-only + MIN_PEOPLE.
- **Data & metric logic:** Count advanced-tier members per capability from user_capability_state; risk band from configurable share thresholds; suppress under MIN_PEOPLE.
- **Backend/API & UI impact:** Skills & Experts Knowledge Concentration + a threshold config in Team Settings.
- **Privacy & permissions:** Counts safe; naming the one/two concentrated members is the crossing.
- **Dependencies & migrations:** Per-member mastery visibility (self-view-only gate).
- **Tests & acceptance:** Threshold + floor golden test.

### TCI-BE-008 — Coaching recommendation generation (manager-facing)

**Partial** · effort L · priority P1 · risk medium

> A job turns capability gaps into ranked coaching recommendations for managers (member/cohort, gap, priority, evidence, confidence, suggested action, effort). *(TCI §9, §6.6)*

- **What exists today (evidence):** src/lib/score-insights.ts deriveAttention + src/lib/recommendation-catalog.ts computeUtility (deterministic ranker, benefit/difficulty/confidence/capabilityGap) already generate ranked recs with a 'why this' line + confidence disclosure, but self-view only
- **Why users want it:** Managers get a prioritized, explainable coaching queue.
- **What has to change:** Add a team-scoped derivation that ranks recs across members for a manager; reuse computeUtility + the eligibility gate; must respect the self-view-only reversal for per-member targeting.
- **Data & metric logic:** Reuse deriveAttention/recommendation_catalog; aggregate to cohort-level where per-member is not permitted.
- **Backend/API & UI impact:** Coaching Center Needs-Attention + Team Overview coaching preview.
- **Privacy & permissions:** Per-member coaching target is the self-view-only crossing; cohort-level is safe.
- **Dependencies & migrations:** W6-A + privacy reversal for per-member.
- **Tests & acceptance:** Shared-source parity test (dashboard/digest pattern already exists).

### TCI-BE-009 — Cost allocation job (CostAllocation, per-user, method + confidence)

**Partial** · effort L · priority P2 · risk medium

> A job allocates AI spend to users/teams with an allocationMethod and confidence, tracking allocated vs unallocated spend. *(TCI §9, §6.8)*

- **What exists today (evidence):** src/lib/spend-governance.ts aggregates vendor-reported spend_cents per connection + per-model by TOKEN volume, keeps estimated separate (never summed), and surfaces gaps; but there is no per-USER allocation and no CostAllocation row with allocationMethod/confidence
- **Why users want it:** Managers see cost per member and how much spend can't be attributed.
- **What has to change:** Add a per-user allocation derivation (only where vendor data supports it) + an explicit unallocated bucket + a confidence/method label; never fabricate a per-user split when the vendor reports only org totals.
- **Data & metric logic:** Attribute spend_cents to resolved exclusive subjects where the vendor reports per-user; otherwise mark unallocated; reuse the shared-account exclusion rule from usage-distribution.
- **Backend/API & UI impact:** Costs & Efficiency individual cost table + allocation confidence.
- **Privacy & permissions:** Per-member cost visibility is admin-configurable per §10/§6.12 — gate behind a workspace setting.
- **Dependencies & migrations:** Vendor per-user cost data (often absent — honesty gap, not estimated in).
- **Tests & acceptance:** Allocation honesty test (no fabricated split); floor test.

### TCI-BE-010 — Manager insight generation + persisted feed with status lifecycle

**Partial** · effort L · priority P1 · risk high

> A job generates ManagerInsight cards (category, severity, evidence, affected users/capabilities, recommended action) and persists a feed with a new/viewed/acted_on/dismissed lifecycle. *(TCI §9, §6.9)*

- **What exists today (evidence):** src/lib/score-insights.ts AttentionItem taxonomy (recommendation|anomaly|plateau|milestone|spend|agentic-transition) + src/lib/anomaly.ts generate insights; rec_interaction_state stores snooze/dismiss/mark-tried BUT self-view-only; there is no ManagerInsight table with severity/status persistence
- **Why users want it:** Managers get a prioritized narrative feed they can act on and dismiss.
- **What has to change:** Add a manager_insight table + a generation step (poller) + status writes; reuse the AttentionItem taxonomy and deriveAttention; must be team-scoped and respect insight visibility (affectedUserIds is a per-person leak surface — gate it).
- **Data & metric logic:** Derive from the same movement/plateau/concentration/anomaly computations; dedupe + expire.
- **Backend/API & UI impact:** Manager Insights feed + convert-to-coaching action.
- **Privacy & permissions:** affectedUserIds naming members to a manager is the self-view-only crossing.
- **Dependencies & migrations:** W6-A + privacy reversal; deterministic only (no separate ML service tripwire; no LLM in Team mode per G6).
- **Tests & acceptance:** tenant-isolation + purge registration; taxonomy golden test.

### TCI-BE-011 — Auditability store for scores/actions

**Partial** · effort L · priority P2 · risk medium

> Store scoring version, calculation timestamp, evidence categories, confidence inputs, changes between score versions, manager actions, and dismissed recommendations. *(TCI §9 Auditability)*

- **What exists today (evidence):** score_results carries components + computed_at (but CLAUDE.md warns computed_at is REWRITTEN by nightly upsert — not an audit trail); rec exposure log recommendation_exposure (ADR 0038) + rec_interaction_state store dismissals self-view; audit_log exists for account actions; no per-score-version diff / manager-action audit
- **Why users want it:** Users and managers can trust and dispute scores with a paper trail.
- **What has to change:** Add append-only version/change records (never derive audit timing from computed_at); log manager actions + dismissals at team scope.
- **Data & metric logic:** Snapshot scoringVersion + evidence categories per calc; diff vs prior snapshot for 'changes between versions'.
- **Backend/API & UI impact:** Scoring & Disclosure settings + dispute flows.
- **Privacy & permissions:** Manager-action log must not become a surveillance record of individuals.
- **Dependencies & migrations:** Depends on TCI-BE-002 snapshots for version diffs.
- **Tests & acceptance:** Append-only + purge registration test.

### TCI-BE-012 — Weekly Team Brief report

**Partial** · effort M · priority P2 · risk medium

> Generate a weekly manager brief: major changes, new risks, coaching priorities, emerging experts, data-quality issues. *(TCI §6.11)*

- **What exists today (evidence):** src/poller/digest.ts runWeeklyDigest + src/lib/digest-content.ts assemble a weekly email, but it is the personal-companion lane-aware digest to ADMINS (src/db/system.ts listDigestRecipients), not a manager team-capability brief with these five sections
- **Why users want it:** Managers get a weekly pulse without opening the app.
- **What has to change:** Add a team-brief composer (reuse the digest cron slot + SES + CAS week-claim) assembling the five TCI sections from the movement/concentration/insight jobs; keep aggregate-only unless privacy reversed for emerging-experts naming.
- **Data & metric logic:** Reuse computeRecentMovement + concentration + deriveAttention; 'emerging experts' naming is the privacy-crossing part.
- **Backend/API & UI impact:** Reports screen + weekly email lane.
- **Privacy & permissions:** 'Emerging experts' names members — gate behind visibility settings.
- **Dependencies & migrations:** TCI-BE-004/007/010; emerging-experts naming behind W6-A + reversal.
- **Tests & acceptance:** Compose golden test + week-claim idempotency (pattern exists).

### TCI-BE-013 — Monthly Capability Review report

**Partial** · effort M · priority P1 · risk low · quick win

> Generate a monthly review: team maturity, capability trends, member movement, gaps, coaching progress, concentration, spend context, priorities. *(TCI §6.11)*

- **What exists today (evidence):** src/lib/exec-report.ts composeExecReport/readExecReport already compose a monthly board memo (maturity board, QoQ trajectory, plateau, spend, honesty gap, capability-coverage line) via src/poller/exec-report.ts on MONTHLY_EXEC_CRON (src/worker.ts:261); shared compose path with the /api/exec-report export
- **Why users want it:** Managers/execs get a monthly capability one-pager.
- **What has to change:** Extend composeExecReport with member-movement, coaching-progress, and per-capability concentration sections; the compose+export+email machinery is already there to reuse.
- **Data & metric logic:** Add movement (TCI-BE-004) + coaching-progress (TCI-BE-008) inputs to the existing depth-1 Promise.all in readExecReport.
- **Backend/API & UI impact:** Reports screen; already emails admins monthly.
- **Privacy & permissions:** Stays aggregate/count-only like the existing memo.
- **Dependencies & migrations:** TCI-BE-004/007/008 for the new sections.
- **Tests & acceptance:** Golden-file tests already pin the memo; extend them.

### TCI-BE-014 — Quarterly Capability Review report

**Missing** · effort M · priority P2 · risk low · quick win

> Generate a quarterly review: longer-term trend, role-pack development, coaching outcomes, skill coverage, operational cost trend, next-quarter priorities. *(TCI §6.11)*

- **What exists today (evidence):** No quarterly cron/report exists (src/worker.ts crons are nightly/daily/weekly/monthly only; grep found no quarterly)
- **Why users want it:** Managers get a quarterly readout for reviews/planning.
- **What has to change:** Add a quarterly cron branch (e.g. 1st of Jan/Apr/Jul/Oct) fanning per-org messages, reusing composeExecReport with a quarter window + an exec_report_state-style quarter CAS for idempotency.
- **Data & metric logic:** Reuse the monthly compose over a 3-month window; QoQ trajectory already exists in maturity.
- **Backend/API & UI impact:** Reports screen + quarterly email lane.
- **Privacy & permissions:** Aggregate-only.
- **Dependencies & migrations:** Reuses TCI-BE-013 compose path.
- **Tests & acceptance:** Quarter-window golden + quarter-CAS idempotency.

### TCI-BE-015 — PDF export

**Missing** · effort M · priority P3 · risk medium

> Export reports and the capability matrix as PDF. *(TCI §6.11, §6.2)*

- **What exists today (evidence):** No PDF machinery anywhere (grep for pdf/jspdf/puppeteer/pdfkit in src/ + package.json returned nothing); src/app/api/exec-report/route.ts:28 returns print-friendly HTML with content-disposition, not PDF
- **Why users want it:** Managers hand a polished PDF to leadership.
- **What has to change:** Either rely on browser 'print to PDF' of the existing print-friendly HTML (zero backend), or add a rendering dependency — note Cloudflare Workers cannot run headless Chrome in-worker, so server PDF needs an external Browser Rendering binding or a print-CSS approach.
- **Data & metric logic:** Reuse renderExecReportDocument HTML; wrap in print CSS.
- **Backend/API & UI impact:** Export actions across Reports/Matrix.
- **Privacy & permissions:** Same as underlying report.
- **Dependencies & migrations:** A Workers-compatible PDF path (Cloudflare Browser Rendering) if true PDF bytes are required.
- **Tests & acceptance:** Snapshot of print HTML.

### TCI-BE-016 — CSV export of underlying report/matrix tables

**Partial** · effort S · priority P2 · risk low · quick win

> Export underlying tables (matrix, cost table, board numbers) as CSV. *(TCI §6.11, §6.2)*

- **What exists today (evidence):** src/lib/maturity-csv.ts maturityViewToCsv is a pure RFC-4180 serializer wrapped by src/app/api/maturity/export/route.ts (text/csv via handleApi, 402 applies); team board CSV export already ships per CLAUDE.md
- **Why users want it:** Managers pull numbers into a spreadsheet.
- **What has to change:** Add CSV serializers for the capability matrix + individual cost table following the maturity-csv pattern (pure serializer + a route wrapper); carry confidence/honest-empty into every cell as maturity-csv does.
- **Data & metric logic:** Reuse csvField/csvRow escaping; honest empty states, never fabricated 0.
- **Backend/API & UI impact:** Export CSV control on Matrix/Costs/Reports.
- **Privacy & permissions:** A per-member matrix CSV is the self-view-only crossing — aggregate CSVs are safe.
- **Dependencies & migrations:** Per-member matrix export behind the privacy reversal.
- **Tests & acceptance:** Golden-file byte test (pattern exists).

### TCI-BE-017 — Scheduled / configurable report email delivery

**Partial** · effort L · priority P2 · risk medium

> Deliver reports on a schedule via email, ideally user-configurable per report type. *(TCI §6.11)*

- **What exists today (evidence):** Fixed crons already deliver weekly digest + monthly memo (src/worker.ts:47/55) via SES with CAS idempotency (exec-report-state, digest week-claim); but delivery is hard-coded crons to admins/owners, not a user-configurable schedule, and settings only toggle on/off (src/app/api/settings/digest/route.ts, settings/exec-report/route.ts)
- **Why users want it:** Managers choose which reports land in their inbox and when.
- **What has to change:** Add a report-schedule config (cadence + recipients + report type) + a scan step; reuse the cron→queue→SES→CAS backbone. Recipient scoping today is admins/owners only (listDigestRecipients) — manager-scoped delivery is new.
- **Data & metric logic:** Reuse listDigestRecipients + CAS claim; add a schedule table read.
- **Backend/API & UI impact:** Team Settings scheduling + delivery lanes.
- **Privacy & permissions:** Recipient scoping must respect who may see team/individual data.
- **Dependencies & migrations:** Manager role scoping of recipients.
- **Tests & acceptance:** Schedule scan + idempotency test.

### TCI-BE-018 — Manager notification delivery + triggers

**Partial** · effort L · priority P2 · risk medium

> Deliver manager notifications (new maturity level, capability declined, several ready for training, expertise concentrated, plateau, cost up without capability growth, data source stopped syncing) with deep link + recommended action. *(TCI §11)*

- **What exists today (evidence):** Delivery backbone exists: SES sendEmail (src/lib/email.ts) + CAS state tables (src/poller/budget-alert.ts:99 claimThreshold, renewal-reminder, exec-report-state) + cron→queue fan-out; budget/renewal/flywheel emails already send to admins with idempotency; but there is NO in-app notification inbox (grep found no notification table/UI) and most of these specific triggers (maturity-level crossing, capability decline, concentration, cost-without-growth) are not computed as events
- **Why users want it:** Managers are alerted to important changes without polling the dashboard.
- **What has to change:** Reuse the SES + CAS + cron backbone; add the specific trigger computations (mostly from TCI-BE-003/004/007/009/010) and a per-event CAS to de-dupe. An in-app inbox is a new surface if wanted; email-only is the cheap path.
- **Data & metric logic:** Fire on level crossings / plateau / concentration thresholds / spend-vs-capability divergence; reuse budget-alert CAS pattern for once-per-crossing.
- **Backend/API & UI impact:** Notification lanes + optional in-app inbox.
- **Privacy & permissions:** 'Expertise concentrated in one person' / 'a member reached a level' name individuals to a manager — self-view-only crossing; gate behind visibility settings.
- **Dependencies & migrations:** Trigger jobs above; per-person naming behind W6-A + reversal.
- **Tests & acceptance:** Per-trigger idempotency (budget-alert pattern) + tenant-isolation for any new state table.

### TCI-BE-019 — Member (individual) notification delivery

**Missing** · effort M · priority P2 · risk medium

> Deliver per-member notifications (new development priority, manager assigned coaching, mentor assigned, capability improved, recommendation ready, personal cost incomplete) with deep link. *(TCI §11)*

- **What exists today (evidence):** All existing email lanes target ADMINS/OWNERS only via src/db/system.ts listDigestRecipients (used by digest, exec-report, renewal); there is no per-member email path and no coaching/mentor-assignment events to notify on
- **Why users want it:** Members learn about assigned coaching, mentors, and their own progress.
- **What has to change:** Add a member-scoped recipient resolver + per-member notification send; the coaching/mentor-assignment triggers depend on features that don't exist yet (TCI-BE-006/008/coaching-actions).
- **Data & metric logic:** Resolve the member's own verified email; fire on self-view events (rec ready, capability improved) which are already computed self-view — those are safe to notify without a privacy reversal.
- **Backend/API & UI impact:** Member notification lane.
- **Privacy & permissions:** Self-directed notifications about one's own profile are consistent with the self-view model; manager-assigned coaching/mentor requires those features first.
- **Dependencies & migrations:** Coaching/mentor assignment (TCI-BE-006/008); member-email resolver.
- **Tests & acceptance:** Recipient-scoping test; idempotency.

<a id="frontend"></a>
## Screens & shared components

### TCI-FE-001 — Top-level 'Team Intelligence' nav with 11 sub-items

**Conflicting** · effort S · priority P2 · risk medium

> Add a new top-level product area 'Team Intelligence' with 11 gated sub-items (Overview, Capability Matrix, Team Members, Growth, Coaching, Skills & Experts, Costs & Efficiency, Insights, Benchmarks, Reports, Team Settings), hidden from non-managers. *(TCI §5)*

- **What exists today (evidence):** tci.md:449-475; src/lib/nav-items.ts:24-36 (routes deliberately RETIRED from nav in W5-H), :62-92 (current 4-item primary + admin groups), :107-138 (role/org-gated navFor); CLAUDE.md W5 ledger 'Team Intelligence folded ~18 panels → 5 cards'
- **Why users want it:** A manager can navigate directly to each team analysis surface.
- **What has to change:** Recommend REJECT/SIMPLIFY as specified: an 11-item nav reverses the founder-approved W5-H consolidation and the 'minimal by default' principle. The role/org gating mechanism already exists (navFor); if any manager surface is approved, add it as 1-2 gated items, not an 11-item tree. Escalate the tree size as a founder product decision.
- **Data & metric logic:** None — nav is a pure config (navFor); gating already keyed on {orgKind, role, isPlatformAdmin}.
- **Backend/API & UI impact:** UI only (sidebar). No backend/API.
- **Privacy & permissions:** Manager-only gating is already expressible; but exposing 11 per-person surfaces is the deeper privacy concern, handled per-screen below.
- **Dependencies & migrations:** Founder product decision on reversing the 5-card consolidation; W6-A companion-in-team-orgs dogfood gate for anything reusing the individual cluster.
- **Tests & acceptance:** nav-items unit test (navFor) asserting manager items appear only for managers; acceptance: non-managers see no Team Intelligence items.

### TCI-FE-002 — Team Overview screen (aggregate summary)

**Partial** · effort M · priority P1 · risk medium

> A manager 30-second overview: overall team capability + maturity + confidence, capability distribution, universal capability profile, ≤4 priority insight cards, growth chart, coaching queue preview, cost snapshot, freshness indicator. *(TCI §6.1)*

- **What exists today (evidence):** src/app/(app)/dashboard/team-overview.tsx:240-368 (the shipped 5 cards: Team AI health, AI maturity+axes, Training opportunities, Benchmarks & distribution, Data trust); MaturityLevelBanner/MaturityAxisMeters :299-304; AttentionSection :238; ScoreTrend/RecentMovement :259,319; SpendGovernanceLine :268
- **Why users want it:** Manager sees team AI health, priorities, and spend context on one screen.
- **What has to change:** Reuse the existing team view as the base. Add: a 5-level maturity distribution bar (extend SegmentBreakdown), 3-4 named priority-insight cards (strongest/weakest/fastest-improving/concentration), and a freshness chip in the header. Do NOT add a blended 'overall team capability score' hero (see TCI-FE-004 conflict).
- **Data & metric logic:** Reuse readDashboardView batch (scores, segments, capabilityCoverage, trends, benchmarks); distribution counts from existing segment maturity buckets; freshness from maturity.dataAsOf.
- **Backend/API & UI impact:** UI rendering only; the insight-card copy needs deriveAttention-style inputs already on the view.
- **Privacy & permissions:** All additions stay aggregate/count-only; no per-person leak.
- **Dependencies & migrations:** TCI-FE-004 (capability-profile decision), TCI-FE-011 (insight feed).
- **Tests & acceptance:** Component tests for the distribution bar counts and insight-card selection; acceptance: strongest/weakest/growth/top-action/spend all visible without leaving the screen.

### TCI-FE-003 — Team Overview header controls (selectors + filters)

**Missing** · effort M · priority P2 · risk medium

> Header with team selector, date-range selector, role filter, location/subgroup filter, compare-period toggle, export action, data-freshness indicator. *(TCI §6.1)*

- **What exists today (evidence):** src/app/(app)/dashboard/team-overview.tsx:222-236 (PageHeader has title/description + banners only — no filter bar, no team selector, no date-range control); dashboardWindow() is a fixed 180d window (:89)
- **Why users want it:** Manager slices the team view by period, role, or subgroup and compares against a prior period.
- **What has to change:** Build a header control bar. Team selector implies a within-org team/subgroup concept that only partly exists (/teams groups people, no per-team dashboard scoping). Date-range + compare-period require the read path to accept a variable window (today it is fixed). Start with date-range + compare-period + export; defer role/location/team-selector until subgroup scoping exists.
- **Data & metric logic:** readDashboardView must accept a caller-supplied window + comparison window; role/subgroup filters need team-membership + role_assignments joins.
- **Backend/API & UI impact:** Backend read-path change (parameterized window) + new UI. Export already exists (MaturityExportButton).
- **Privacy & permissions:** Filters must not narrow to a sub-floor group that re-identifies individuals (keep MIN_PEOPLE floor after filtering).
- **Dependencies & migrations:** Subgroup/team scoping model; TCI-FE-002.
- **Tests & acceptance:** Read-path query-count test that a variable window stays round-trip depth 1; filter guardrail test that sub-floor filtered segments are suppressed.

### TCI-FE-004 — Universal capability profile (bars/radar) + single team capability score

**Conflicting** · effort M · priority P2 · risk high

> Render the 7 universal capability dimensions as aligned bars (radar supplementary) with score/trend/confidence/benchmark, plus a single overall team capability score. *(TCI §6.1)*

- **What exists today (evidence):** tci.md:507-517,555-569; src/app/(app)/dashboard/personal-self-view.tsx:546-547 ('No blended per-person AI health number anywhere (errata §1.2(9))'); repo has 3 scores (adoption/fluency/efficiency) + 3 maturity axes + a 9-capability ENGINEERING graph, not 7 universal dimensions (CLAUDE.md P1/P8); no radar-chart component exists
- **Why users want it:** Manager sees where the team is strong/weak across a comparable capability set.
- **What has to change:** Two conflicts: (1) the universal 7-dimension model does not exist (engineering-only seed; role packs deferred) — this is a capability-model/backend decision, not a chart. (2) A single blended team 'capability score' contradicts the errata-§1.2(9) no-blended-number rule; keep the modeled maturity LEVEL as the headline. Buildable now: aligned bars for the EXISTING measured axes/scores. No radar unless it stays supplementary.
- **Data & metric logic:** Bars can render existing score/axis rows; a 7-dimension universal profile needs the universal capability model to exist first.
- **Backend/API & UI impact:** UI bars are S; the model gap is XL and out of frontend scope.
- **Privacy & permissions:** Aggregate team-level; fine.
- **Dependencies & migrations:** Universal capability model (backend/capability-model specialist); errata §1.2(9) headline rule.
- **Tests & acceptance:** n/a until model exists; if bars added, snapshot test that no fabricated 0 renders for an unmeasured dimension.

### TCI-FE-005 — Capability Matrix (people × capabilities grid)

**Conflicting** · effort XL · priority P3 · risk high

> A grid of team members (rows) × capabilities (columns) with per-cell score/intensity/trend/confidence, hover explanations, click-through capability drawer, filters, column selector, CSV/PDF export, saved views. *(TCI §6.2)*

- **What exists today (evidence):** tci.md:651-769; src/components/companion/capability-profile-card.tsx:26-28 ('the caller passes only the SIGNED-IN person's own rows … so no per-person mastery ever leaves self-view'); src/components/dashboard/capability-coverage-card.tsx:12-17 ('The row prop carries NO person id or name — a per-person shape is structurally impossible'); src/components/dashboard/segment-breakdown.tsx:12-18
- **Why users want it:** Manager compares every member across every capability in one diagnostic view.
- **What has to change:** This is the sharpest conflict: a named-member × capability grid directly reverses the self-view-only mastery boundary and the count-only/MIN_PEOPLE design. Recommend EXCLUDE as specified. The privacy-preserving equivalent already exists: CapabilityCoverageCard (capability × mastered-count). If a per-person manager view is ever wanted it is a founder-signed privacy-model change + ADR, not a UI task.
- **Data & metric logic:** Would require exposing user_capability_state per named person to managers — the opposite of mastery.forUser(self).
- **Backend/API & UI impact:** New surface + a reversal of the frozen self-view boundary; XL and gated.
- **Privacy & permissions:** Direct violation of the self-view-only mastery rule and MIN_PEOPLE floor; re-identifies individuals' inferred capability.
- **Dependencies & migrations:** Founder privacy-model reversal + ADR; W6-A dogfood gate.
- **Tests & acceptance:** n/a — recommend not building; existing tenant-isolation/self-view tests would need to be rewritten, itself a red flag.

### TCI-FE-006 — Team Members roster with per-member capability columns

**Conflicting** · effort L · priority P3 · risk high

> A sortable member table (overall capability, maturity, growth, strongest capability, development priority, coaching status, spend, last active) with expandable per-member rows and bulk coaching/mentor/note actions. *(TCI §6.3)*

- **What exists today (evidence):** tci.md:771-843; existing /people (src/app/(app)/people/page.tsx:40-63) is pseudonym-only, two columns, no capability/spend; /teams (src/app/(app)/teams/page.tsx) is team→member-COUNT only; segment-breakdown.tsx:12-18 forbids per-person listing even under managed/full
- **Why users want it:** Manager scans and compares members without opening each profile.
- **What has to change:** A roster carrying per-member capability/maturity/spend/priority reverses the self-view-only + count-only rules. The existing People page is deliberately pseudonym/count-only. Recommend EXCLUDE the capability/spend columns; a plain member roster (name/role under non-private visibility) already exists. Bulk coaching/mentor/note actions depend on manager-coaching (TCI-FE-009).
- **Data & metric logic:** Per-member capability/growth/priority = self-view mastery exposed to managers (forbidden today).
- **Backend/API & UI impact:** Reverses privacy boundary; XL if built.
- **Privacy & permissions:** Per-person capability + spend + coaching status attached to a name is exactly what the count-only rule prevents.
- **Dependencies & migrations:** Founder privacy reversal + ADR; TCI-FE-009.
- **Tests & acceptance:** n/a — recommend not building the per-capability columns.

### TCI-FE-007 — Individual Team Member Profile (manager-facing)

**Conflicting** · effort XL · priority P3 · risk high

> A manager-facing version of the individual growth profile with tabs (Overview, Capabilities, Skills, Growth, Cost/Usage, Coaching, Notes) for any named member, plus assign-coaching/mentor/note/export actions. *(TCI §6.4)*

- **What exists today (evidence):** tci.md:845-995; src/app/(app)/dashboard/personal-self-view.tsx (the individual profile is SELF-view — reads mastery.forUser(ctx.user.id), missions.progressForUser(ctx.user.id), exposures.forUser); coaching-card.tsx:22-27 ('a manager surface passes no personId'); capability-profile-card.tsx:26-28
- **Why users want it:** Manager reviews one member's capability, growth, and coaching in depth.
- **What has to change:** This is the core self-view boundary reversal: it re-exposes another person's capability, skills, cost, and coaching to a manager. Recommend EXCLUDE / treat as a founder-signed privacy change + ADR, not a UI build. Manager notes (a manager-private note store) could exist independently WITHOUT exposing calculated scores (spec itself says notes must never alter scores), but the capability/skills/cost tabs are the conflict.
- **Data & metric logic:** Every tab sources self-view-only data (mastery, missions, exposures, personal spend) keyed to another user.
- **Backend/API & UI impact:** XL new surface + privacy reversal; also depends on manager-facing capability reads that don't exist.
- **Privacy & permissions:** Largest single privacy reversal in the spec; contradicts the deliberate self-view design and §7 pseudonymization.
- **Dependencies & migrations:** Founder privacy reversal + ADR; W6-A gate; manager-coaching store.
- **Tests & acceptance:** n/a — recommend not building the capability/skills/cost tabs; a manager-note-only surface could be tested separately.

### TCI-FE-008 — Team Growth screen (trend, movement, segments, coaching impact)

**Partial** · effort M · priority P2 · risk medium

> A team growth surface: capability trend line, capability-movement counts (up/down/stable/insufficient), growth segments (fastest/plateaued/declining/newly-active/inactive), coaching-impact pre/post, forecasting (labeled projection). *(TCI §6.5)*

- **What exists today (evidence):** src/app/(app)/growth/page.tsx (a personal /growth surface exists, self-view only, gated to personal orgs :43-45); team-overview.tsx:319 ScoreTrend, :259 RecentMovementPanel, :332-335 TrainingOpportunitiesCard (plateau verdict + count-only segments)
- **Why users want it:** Manager sees whether team capability is improving, plateauing, or declining.
- **What has to change:** The AGGREGATE pieces (trend line, movement counts, count-only growth segments, plateau verdict) are buildable as extensions of the existing team cards and are privacy-safe. Coaching-impact pre/post depends on a manager-coaching campaign store (TCI-FE-009) and must not claim causality (spec agrees). Forecasting is 'Later' and must be labeled a projection. The personal /growth route is self-view and NOT the team surface.
- **Data & metric logic:** Trend/movement/segment counts already computed in readDashboardView; coaching-impact needs baseline snapshots from campaigns.
- **Backend/API & UI impact:** UI extension of existing aggregate cards; coaching-impact is backend-gated.
- **Privacy & permissions:** Keep growth segments count-only (already the pattern); no named members.
- **Dependencies & migrations:** TCI-FE-009 for coaching-impact; forecasting model (Later).
- **Tests & acceptance:** Count-only assertion on growth segments; label test that forecasts render a projection disclaimer.

### TCI-FE-009 — Coaching Center (manager assign/campaigns/mentor matches)

**Conflicting** · effort XL · priority P3 · risk high

> A manager surface to convert capability gaps into assigned coaching actions, run team campaigns, match mentors, and track actions through completion. *(TCI §6.6)*

- **What exists today (evidence):** tci.md:1067-1187; src/components/companion/coaching-card.tsx:22-27 (coaching affordances are self-view — 'a manager surface passes no personId, so no affordances … ever render'); recommendation interaction state is self-view-only per CLAUDE.md W5-D (rec_interaction_state)
- **Why users want it:** Manager drives targeted capability development for the team.
- **What has to change:** Manager-assigns-coaching-to-named-members reverses the self-view coaching model AND requires manager visibility into who is weak (TCI-FE-005). The rendering components (CoachingCard, RecommendationCard, snooze/dismiss/mark-tried) exist but are wired self-view-only. A team-CAMPAIGN concept (aggregate, capability-targeted, opt-in) could be less invasive than per-member assignment, but 'Needs Attention' listing named members with gaps is the conflict. Recommend scope to aggregate campaigns + self-view opt-in; EXCLUDE per-named-member assignment absent a privacy ADR.
- **Data & metric logic:** Needs a coaching_campaign / assignment store keyed to members — manager-writable, member-visible; baseline snapshots per §16.
- **Backend/API & UI impact:** XL new surface + privacy reversal for the per-member parts.
- **Privacy & permissions:** Per-member gap listing + assignment attaches a weakness to a name (self-view reversal).
- **Dependencies & migrations:** Founder privacy reversal + ADR; W6-A gate; new campaign/assignment tables (backend).
- **Tests & acceptance:** n/a for per-member; campaign-level flow tests if aggregate scope chosen.

### TCI-FE-010 — Skills & Experts (inventory + named expert directory)

**Conflicting** · effort L · priority P2 · risk high

> A skills inventory (per-skill counts, maturity distribution, concentration risk) plus an Expert Directory listing named members with expertise, proficiency, recent evidence, and mentor availability. *(TCI §6.7)*

- **What exists today (evidence):** tci.md:1189-1281; src/components/dashboard/capability-coverage-card.tsx:12-17 (aggregate count-only, no person id — the privacy-safe analog); segment-breakdown.tsx:12-18 (no named individuals even under managed/full)
- **Why users want it:** Manager finds where AI expertise lives and who can mentor.
- **What has to change:** Split verdict: the Skills Inventory (per-capability counts, maturity distribution, concentration risk) is buildable as an extension of CapabilityCoverageCard and is privacy-safe IF it stays count-only and MIN_PEOPLE-floored. The Expert DIRECTORY names individuals with proficiency — a self-view reversal; recommend EXCLUDE. Knowledge-concentration RISK can be surfaced as an aggregate signal ('1-2 people hold most advanced proficiency') without naming them.
- **Data & metric logic:** Inventory counts reuse mastery.coverageCounts; expert directory needs named per-person mastery (forbidden).
- **Backend/API & UI impact:** Inventory is M; expert directory is XL + privacy-gated.
- **Privacy & permissions:** Naming experts with inferred proficiency reverses self-view; concentration counts are safe if never resolved to names.
- **Dependencies & migrations:** Founder privacy reversal + ADR for the directory; MIN_PEOPLE floor enforcement.
- **Tests & acceptance:** Count-only + floor assertion on the inventory; verify concentration risk never carries a person id.

### TCI-FE-011 — Manager Insights feed (prioritized narrative + dismiss/convert)

**Partial** · effort L · priority P2 · risk medium

> A prioritized narrative feed of ManagerInsight cards (category, severity, explanation, confidence, evidence, recommended action, status) with filters and dismiss/save/convert-to-coaching actions. *(TCI §6.9)*

- **What exists today (evidence):** src/app/(app)/dashboard/team-overview.tsx:205-238 (deriveAttention builds an AttentionSection strip with recommendations/anomalies/plateau/score-drops); CLAUDE.md 'AttentionItem.kind = recommendation|anomaly|plateau|milestone|spend|agentic-transition'
- **Why users want it:** Manager gets a ranked feed of what changed and what to do.
- **What has to change:** deriveAttention already produces a ranked, typed, confidence-bearing insight strip for the team view — the engine is largely there. Missing: a dedicated FEED screen with per-insight status (new/viewed/acted/dismissed), category/severity filters, and convert-to-coaching. Aggregate categories (capability gap, decline, plateau, low adoption, cost anomaly, incomplete data) are safe; 'emerging expert'/'mentor opportunity' categories that name people are the conflict. Build the aggregate feed; gate the person-naming categories.
- **Data & metric logic:** Reuse deriveAttention output; add an insight-status store for dismiss/acted persistence.
- **Backend/API & UI impact:** New feed surface (M-L) reusing the existing insight engine; status persistence is a small table.
- **Privacy & permissions:** Keep affectedUserIds out of the rendered card for aggregate categories; person-naming categories gated.
- **Dependencies & migrations:** Insight-status store; TCI-FE-009 for convert-to-coaching.
- **Tests & acceptance:** Feed filter/status tests; assertion that aggregate cards render no person id.

### TCI-FE-012 — Benchmarks screen (team/role/cohort comparisons)

**Partial** · effort M · priority P2 · risk low · quick win

> Compare team vs previous period, team vs workspace average, role vs same-role average, subgroup vs parent, and (later) anonymized external benchmark, with population/period/confidence always shown and comparability guardrails. *(TCI §6.10)*

- **What exists today (evidence):** src/components/dashboard/benchmark-panel.tsx (rendered on the team view :352) shows within-org percentile + published norms; personal-self-view.tsx:668-725 verified-benchmarks card with provenance disclosure and 'we don't show unverified figures'
- **Why users want it:** Manager sees how the team compares without misleading public rankings.
- **What has to change:** Team-vs-previous-period and team-vs-workspace-average are buildable extensions of the existing BenchmarkPanel + benchmarks store, which already discloses provenance/confidence — matching the guardrails. Role-vs-role and subgroup-vs-parent need role_assignments/subgroup scoping. External benchmarks are 'Later' and already gated behind verification. No public ranking exists today (good — matches 'no leaderboards').
- **Data & metric logic:** Reuse listBenchmarks + score aggregates; role/subgroup comparisons need those groupings.
- **Backend/API & UI impact:** UI + read extensions; external benchmark stays gated.
- **Privacy & permissions:** Comparisons stay aggregate; enforce comparability + population disclosure (already the pattern).
- **Dependencies & migrations:** Role/subgroup scoping; TCI-FE-003.
- **Tests & acceptance:** Guardrail test: no comparison rendered below sample-size/comparability threshold; population+confidence always present.

### TCI-FE-013 — Reports UI (weekly/monthly/quarterly + export)

**Partial** · effort M · priority P2 · risk low · quick win

> Generate reusable manager reports (Weekly Team Brief, Monthly Capability Review, Quarterly Review) with in-app view, PDF, CSV export, and scheduled email delivery. *(TCI §6.11)*

- **What exists today (evidence):** src/components/maturity/maturity-report.tsx + src/app/(app)/maturity/page.tsx (an in-app board one-pager); team-overview.tsx:288 MaturityExportButton (CSV) + :289-297 link to /maturity full report; CLAUDE.md W6 'Monthly Executive narrative one-pager (email + /api/exec-report export)'; settings/exec-report-preferences-form.tsx (scheduled email opt-in exists)
- **Why users want it:** Manager has ready summaries for reviews and can export/share them.
- **What has to change:** The building blocks exist: an in-app maturity report, CSV export, a monthly exec narrative + email, and scheduled-email preference UI. Missing: the Weekly Team Brief + Quarterly Review report types and a Reports LANDING screen listing report types with per-type generate/export. Reuse the exec-report + maturity-report renderers as templates; add PDF (not present today, CSV/in-app only).
- **Data & metric logic:** Reuse composeExecReport/readMaturityView aggregates; weekly/quarterly need windowed aggregation.
- **Backend/API & UI impact:** New Reports index UI + two report templates; PDF export is new.
- **Privacy & permissions:** Reports stay aggregate/count-only (as the exec memo already is).
- **Dependencies & migrations:** Weekly/quarterly aggregation windows; PDF export mechanism.
- **Tests & acceptance:** Report-content tests that no per-person number appears; export smoke tests.

### TCI-FE-014 — Shared: Capability Score Card + Capability Bar

**Partial** · effort S · priority P2 · risk low · quick win

> A CapabilityScoreCard (score/level/trend/change/confidence/coverage/onExplain) and a Capability Bar (label/score/benchmark/trend/confidence). *(TCI §8)*

- **What exists today (evidence):** src/components/scores/score-card.tsx:185-276 (ScoreCard with value/delta/components/footer + 'How this is calculated' collapsible + honesty null-state); score-meter.tsx (the bar); maturity-axis-meters.tsx (label+score+meter pattern)
- **Why users want it:** A consistent, explainable capability display everywhere.
- **What has to change:** Very close match: ScoreCard already renders score + delta (trend) + an explain collapsible + honest null states. Gaps vs the spec props: an explicit confidence badge and a benchmark line are not first-class on the card today. Add a confidence prop + optional benchmark row rather than a new component.
- **Data & metric logic:** Confidence tier already exists in capability-glossary (confidenceTierLabel); benchmark rows exist in benchmark-panel.
- **Backend/API & UI impact:** S extension of an existing shared component.
- **Dependencies & migrations:** TCI-FE-015 (confidence badge).
- **Tests & acceptance:** Snapshot: null value never renders a fabricated 0 (already tested in score-card.test.tsx).

### TCI-FE-015 — Shared: Confidence Badge + Trend Indicator

**Partial** · effort S · priority P2 · risk low · quick win

> A ConfidenceBadge (high/medium/low/insufficient data) and a TrendIndicator (improving/stable/declining/unavailable). *(TCI §8)*

- **What exists today (evidence):** src/lib/capability-glossary confidenceTierLabel (used in capability-profile-card.tsx:90); score-card.tsx:57-103 DeltaChip renders up/down/none/notComparable/first trend states; no single reusable Badge component named ConfidenceBadge exists
- **Why users want it:** Every score visibly carries how much to trust it and which way it moved.
- **What has to change:** The concepts exist but as ad-hoc pieces (confidenceTierLabel text, DeltaChip). Extract a small ConfidenceBadge (reusing Badge + the tier labels) and generalize DeltaChip into a TrendIndicator so both are reusable across the new surfaces. Low effort, high consistency payoff.
- **Data & metric logic:** Confidence tiers already computed on capability state; trend from delta results.
- **Backend/API & UI impact:** S — extract/generalize existing pieces.
- **Tests & acceptance:** Unit tests for the 4 confidence states + 4 trend states incl. 'insufficient/unavailable' (never a fake value).

### TCI-FE-016 — Shared: Insight Card variants

**Partial** · effort S · priority P2 · risk low · quick win

> An Insight Card with variants positive/opportunity/warning/critical/disclosure. *(TCI §8)*

- **What exists today (evidence):** team-overview.tsx:238 AttentionSection renders deriveAttention items (recommendation/anomaly/plateau/etc); data-confidence.tsx STATE_STYLE:52-78 already encodes reliable/needs-attention/sync-failed visual treatments (an existing severity styling map)
- **Why users want it:** Consistent severity styling for insights across screens.
- **What has to change:** AttentionSection + the DataConfidence state styling cover most variants informally. Consolidate into one Insight Card component with the five variants and reuse it in the Manager Insights feed (TCI-FE-011). Reserve destructive/red for the genuinely critical state (the DataConfidence map already follows this rule).
- **Data & metric logic:** Variant derives from insight severity already present on AttentionItem/anomaly outputs.
- **Backend/API & UI impact:** S-M consolidation.
- **Dependencies & migrations:** TCI-FE-011.
- **Tests & acceptance:** Variant-render tests; red reserved for critical only.

### TCI-FE-017 — Shared: Capability Detail Drawer

**Partial** · effort M · priority P2 · risk medium

> A drawer showing score, explanation, contributing signals, limiting signals, trend, confidence, recommendation, limitations. *(TCI §8)*

- **What exists today (evidence):** src/components/companion/capability-curriculum-drawer.tsx (a Sheet-based capability detail drawer); data-confidence.tsx:255-321 (ResponsiveSheetContent drawer with sectioned disclosure + deep-link-to-section pattern)
- **Why users want it:** A manager/member can drill into why a capability scored as it did.
- **What has to change:** The drawer PATTERN (Sheet + ResponsiveSheetContent + sectioned content + deep-link) is fully established. Build the capability-detail content (contributing/limiting signals + recommendation + limitations) reusing this pattern. Note: contributing/limiting signals per person is self-view data — a MANAGER drawer over a named member's signals is the TCI-FE-005/007 conflict; a self-view or aggregate drawer is fine.
- **Data & metric logic:** Signal summaries come from the scoring engine (score-insights component rows); aggregate vs per-person governs privacy.
- **Backend/API & UI impact:** S-M using the existing drawer shell.
- **Privacy & permissions:** Per-named-person signal drawer inherits the self-view conflict; aggregate/self drawer is safe.
- **Dependencies & migrations:** Privacy scope decision (self/aggregate vs manager-per-person).
- **Tests & acceptance:** Drawer opens to the right section; no per-person signals rendered in a manager/aggregate context.

### TCI-FE-019 — Shared: Member Avatar Row

**Conflicting** · effort S · priority P3 · risk medium

> A row showing avatar, name, role, status, and optional maturity badge for a member. *(TCI §8)*

- **What exists today (evidence):** tci.md:1813-1825; src/app/(app)/people/page.tsx:40-63 (people render as PSEUDONYM by default; real name only when visibilityMode !== private, and never with a capability/maturity badge); segment-breakdown.tsx:12-18 (no per-person maturity labels)
- **Why users want it:** Manager recognizes members at a glance with their maturity.
- **What has to change:** A name+avatar row is fine under non-private visibility (Avatar + people.list exist). The CONFLICT is the 'maturity badge' attached to a named person — that is inferred capability tied to a name, which the count-only/self-view rules forbid. Build the avatar/name/role/status row WITHOUT the maturity badge; the badge needs the same privacy ADR as TCI-FE-005.
- **Data & metric logic:** Avatar/name/role from people.list + role_assignments; maturity badge = per-person mastery (gated).
- **Backend/API & UI impact:** S for the plain row; the badge is the gated part.
- **Privacy & permissions:** Per-person maturity badge reverses self-view; plain identity row respects §7 visibility modes.
- **Dependencies & migrations:** Privacy ADR for the maturity badge.
- **Tests & acceptance:** Assert the badge is absent unless an approved manager-visibility mode + ADR exists; name hidden in private mode.

<a id="ux"></a>
## UX, copy & user flows

### TCI-UX-003 — Per-score explainability (signals, change, evidence, limitations, next action)

**Partial** · effort M · priority P2 · risk medium

> Every capability score exposes contributing signals, confidence, recent changes, supporting evidence, known data limitations, and a recommended next action. *(TCI §2.3)*

- **What exists today (evidence):** Score cards show component breakdown + deltas + named driver (personal-self-view.tsx:317-360, score-insights personScoreDropAttribution); Data Confidence covers limitations (data-confidence.ts); coaching = next action (coaching-card.tsx). But capability-profile-card.tsx:78-104 renders only band + confidence tier + a curriculum link — no positiveSignals/limitingSignals/evidenceCount drawer per capability
- **Why users want it:** A user can fully trace why each capability reads the way it does and what to do next.
- **What has to change:** Add a per-capability detail drawer exposing contributing vs limiting signals, evidence count, last-calculated time and the recommended action (the §8 Capability Detail Drawer), reusing the CapabilityScore shape; keep score-level explainability as-is.
- **Data & metric logic:** user_capability_state already stores mastery + confidenceTier + lastEvidenceAt (capability-state.ts); would need per-signal contribution surfaced, which the engine does not currently expose to the view.
- **Backend/API & UI impact:** New drawer component + a capability-state read that returns signal-level contributions.
- **Privacy & permissions:** Self-view only — must not become a manager-readable per-person signal log.
- **Dependencies & migrations:** Depends on capability engine exposing signal contributions.
- **Tests & acceptance:** Drawer renders every field; forming state shows honest 'still forming', never zeros.

### TCI-UX-004 — Never show a score without confidence + evidence availability

**Partial** · effort S · priority P2 · risk low · quick win

> Capability/score values must never render without an attached confidence and evidence-availability indicator. *(TCI §2.3)*

- **What exists today (evidence):** capability-profile-card.tsx:88-91 renders confidenceTierLabel per capability row; Data Confidence card aggregates trust (personal-self-view.tsx:597). But the numeric 0-100 ScoreCard grid (personal-self-view.tsx:630-634) carries no per-score confidence badge — confidence lives only in the separate aggregate card
- **Why users want it:** Every number a user sees is honestly qualified inline, so low-confidence figures aren't over-trusted.
- **What has to change:** Add an inline confidence badge to ScoreCard using the existing confidenceTierLabel vocabulary; keep the aggregate Data Confidence card for cross-cutting disclosures.
- **Data & metric logic:** Reuse confidence tier already computed for capability state; score cards need a confidence field threaded from the score row.
- **Backend/API & UI impact:** Small ScoreCard prop + badge.
- **Tests & acceptance:** A score card without confidence data fails a guard; badge renders for every rendered score.

### TCI-UX-006 — Structured empty state (why / what's required / who resolves / effect)

**Partial** · effort S · priority P2 · risk low · quick win

> Empty states must explain why data is unavailable, what is required, who can resolve it, and the expected effect after resolution. *(TCI §6, §8)*

- **What exists today (evidence):** empty-state.tsx:11-19 enforces 'why empty + what fills it, never a fake teaser'; onboarding-interim.tsx threads isAdmin (who resolves) (personal-self-view.tsx:610-618). But the full four-field structure (esp. 'who can resolve' + 'expected effect') isn't a first-class, consistently-rendered contract across surfaces
- **Why users want it:** Every dead-end tells the user exactly what to do and who can do it, not just that it's empty.
- **What has to change:** Extend EmptyState with optional whoResolves + expectedEffect props (or a structured variant) and adopt them on capability, growth, and coverage empties.
- **Backend/API & UI impact:** Small component + copy additions in the glossary modules.
- **Tests & acceptance:** Structured variant renders all four fields; existing callers unaffected.

### TCI-UX-007 — Low-confidence values visually distinct

**Partial** · effort S · priority P2 · risk low

> Low-confidence and insufficient-data values are visually distinct across screens (cells, scores). *(TCI §6)*

- **What exists today (evidence):** capability-glossary.ts:44-56 'early read' tier badge; data-confidence.ts:52-58 'needs-attention' state. But numeric score cards have no distinct low-confidence treatment; team CapabilityCoverageCard drops below-MIN_PEOPLE rows entirely (capability-glossary.ts:171-173) rather than marking them low-confidence
- **Why users want it:** Users can tell at a glance which readings to trust less.
- **What has to change:** Introduce a consistent low-confidence visual token (muted/dashed) applied to any score or cell whose confidence tier is 'early read' or lower, reusing existing tier vocabulary.
- **Backend/API & UI impact:** Shared styling helper + adoption on score cards and any future matrix.
- **Tests & acceptance:** Low-confidence values render the distinct token; measured values do not.

### TCI-UX-009 — Individual capability SCORE as the hero metric

**Conflicting** · effort S · priority P1 · risk medium

> Keep the individual capability score as the hero metric on the IC overview. *(TCI §7.1)*

- **What exists today (evidence):** personal-self-view.tsx:542-556 makes the maturity LEVEL + single next step the hero and demotes the raw 0-100 score grid behind a collapsed expander (personal-self-view.tsx:621-634; DIAGNOSTIC_COPY companion-glossary.ts:237-246); founder D4 ratified fewer/larger cards + one dominant action (product-signoffs.md:15); errata §1.2(9) forbids a blended per-person health number
- **Why users want it:** Intended: an at-a-glance capability headline. Shipped (better): a level + one actionable next step, which testing/founder-decision favored over a bare number.
- **What has to change:** Recommend REJECT/re-frame: keep the level/band as the hero (already Complete); do not reintroduce a numeric-score hero. If TCI means the level, no change is needed. Reconcile the spec wording with U1/D4 before building.
- **Dependencies & migrations:** Contradicts approved U1 UI/UX plan + D4.

### TCI-UX-010 — IC overview section set (universal + role-pack breakdown, assigned coaching)

**Partial** · effort M · priority P2 · risk medium

> IC overview shows current capability, growth focus, universal capability breakdown, role-pack breakdown, recommendations, assigned coaching, personal cost, and data confidence. *(TCI §7.1)*

- **What exists today (evidence):** Present: level (GrowthJourneyCard), next step, capability breakdown (CapabilityProfileCard), recommendations (CoachingCard), personal cost (SpendGovernanceLine personal-self-view.tsx:653), data confidence (DataConfidenceCard). Absent: a universal-vs-role-pack SPLIT (only one 9-capability engineering set exists) and manager-'assigned' coaching (coaching is self-derived, not assignable — coaching-card.tsx doc comment)
- **Why users want it:** A complete single-screen self-view; today it's missing the role-pack split and any manager-assigned items.
- **What has to change:** Add a universal/role-pack grouping to the capability breakdown once the model supports it; assigned-coaching depends on a manager assignment surface that does not exist.
- **Data & metric logic:** Requires the universal 7-dimension + role-pack capability model (owned by capability-model specialist) and a coaching-assignment entity.
- **Backend/API & UI impact:** Breakdown-card grouping; new assigned-coaching read.
- **Dependencies & migrations:** Assigned coaching depends on the Coaching Center / manager surface (§6.6) which is Missing.
- **Tests & acceptance:** Breakdown renders universal + role-pack groups; assigned items render only when assignment data exists.

### TCI-UX-011 — Personal cost analytics on the IC view

**Partial** · effort M · priority P2 · risk low

> Show monthly spend, spend trend, model mix, premium-model share, token usage, allocation confidence, and model-selection recommendations — without framing cost reduction as the objective. *(TCI §7.2)*

- **What exists today (evidence):** SpendGovernanceLine shows reported + estimated spend + cost-per-active-user with a link to /spend (personal-self-view.tsx:653-666); estimated-pricing disclosed via Data Confidence (data-confidence.ts:216-235). 'Don't frame cost reduction as objective' is honored (spend is operational, no ROI). Missing on the personal surface: model mix, premium-model share, token volume, model-selection recommendations
- **Why users want it:** A user understands their own spend shape and where a cheaper model would do — without being told to just spend less.
- **What has to change:** Add model-mix / premium-share / token breakdown + explainable model-selection guidance to the personal cost view (behind the diagnostic expander to stay minimal).
- **Data & metric logic:** spend_cents / spend_cents_estimated + per-model records exist; model-selection guidance needs an explainable classification, not an opaque efficiency score (§6.8 rule).
- **Backend/API & UI impact:** Extend the personal /spend view + a model-selection copy module.
- **Tests & acceptance:** Model-mix renders from measured rows; estimated values stay labelled; no 'reduce spend' default framing.

### TCI-UX-012 — Team context on the IC self-view (aggregates, priorities, mentors)

**Blocked** · effort L · priority P3 · risk high

> Where permitted, show the member how they compare to team aggregates, team capability priorities, available mentors, and chances to mentor others — without exposing named peer scores. *(TCI §7.3)*

- **What exists today (evidence):** The personal companion is org-of-one; the modeled-norms BenchmarkPanel is deliberately NOT on the self-view (personal-self-view.tsx:668-680, J1); GrowthPage gates team-org member activation on W6-A (growth/page.tsx:36-40). 'Don't expose named peer scores' is already Complete (MIN_PEOPLE floor, pseudonymized private mode). Mentors: no mentor feature exists
- **Why users want it:** An IC in a team could see how they fit and who can mentor them — but this depends on an ungated capability.
- **What has to change:** Do not force. Team-context-on-self-view rides on companion-in-team-orgs (W6-A). Mentor matching is a net-new feature. Design behind the same visibility permissions once W6-A clears.
- **Privacy & permissions:** Must keep peer comparisons aggregate/anonymized; a single-person-vs-modeled-curve comparison is unsupported (J1).
- **Dependencies & migrations:** Blocked by W6-A companion-in-team-orgs (founder dogfood clock since 2026-07-14). Mentor matching Missing.

### TCI-UX-013 — Flow A end-to-end: manager identifies gap → campaign

**Missing** · effort XL · priority P2 · risk high

> Manager opens Team Overview, sees weakest capability, opens capability detail with affected members + confidence, opens Coaching Center, creates a campaign, assigns a mentor, records a baseline, reviews progress. *(TCI §12)*

- **What exists today (evidence):** Only the entry exists: team-overview.tsx renders a 5-card overview + aggregate CapabilityCoverageCard (count-only, no per-capability weakness drill-in with named members). No capability-detail-with-affected-members drawer, no Coaching Center, no campaigns, no mentor assignment, no baseline snapshot anywhere in src/app/(app)
- **Why users want it:** The core manager loop the whole TCI product promises — currently unbuilt past the overview.
- **What has to change:** Build Coaching Center + campaign + mentor + baseline as a program. The capability-detail-showing-affected-members step is the pivotal blocker: it requires exposing per-person capability to managers, which is self-view-only today (a major privacy-model change needing an ADR + founder decision), not a UI task.
- **Data & metric logic:** Needs manager-readable per-person capability, a coaching_campaign entity with baseline snapshot, and mentor matching.
- **Backend/API & UI impact:** Multi-surface manager program.
- **Privacy & permissions:** Per-person capability exposed to managers is a deliberate reversal of the self-view-only model — flag as a top-level privacy decision.
- **Dependencies & migrations:** Blocked-ish on the per-person-visibility privacy decision; Coaching Center + campaigns Missing.

### TCI-UX-014 — Flow B end-to-end: find an internal expert

**Conflicting** · effort XL · priority P3 · risk high

> Manager opens Skills and Experts, searches a capability/tool, sees members ranked by proficiency + confidence, checks mentor availability, and assigns the expert. *(TCI §12)*

- **What exists today (evidence):** No Skills & Experts screen exists. A named expert directory with per-person proficiency (tci.md:1229-1245) contradicts the self-view-only mastery model and the aggregate, MIN_PEOPLE-floored, no-person-id team surface (capability-profile-card.tsx:26-28; capability-glossary.ts:165-174; team-overview.tsx:336-338)
- **Why users want it:** Managers could route learners to internal experts — but the naming-individuals mechanism collides with the privacy model.
- **What has to change:** Do not build as specified without resolving the privacy model. If pursued, an opt-in 'I'm available to mentor' surfaced BY the individual (self-declared) is the honesty-preserving alternative to inferring and publishing named proficiency.
- **Data & metric logic:** Would need per-person proficiency readable by others — currently structurally impossible on the team surface.
- **Backend/API & UI impact:** New screen + directory + mentor availability entity.
- **Privacy & permissions:** Publishing named per-person proficiency reverses self-view-only mastery — major change.
- **Dependencies & migrations:** Blocked on the per-person-visibility privacy decision.

### TCI-UX-015 — Flow C end-to-end: investigate high spend per member

**Partial** · effort L · priority P2 · risk medium

> Manager opens Costs and Efficiency, filters for high spend, compares capability/growth/adoption/cost per member, distinguishes high-value advanced use from inefficiency, and assigns model-selection coaching only when evidence supports it. *(TCI §12)*

- **What exists today (evidence):** Team spend exists as a one-line governance summary + /spend page (team-overview.tsx:268-272) with estimated/reported honesty. Missing: a per-member individual cost table with efficiency CLASSIFICATION (§6.8 explainable buckets, not an opaque score), the admin visibility toggle for individual cost, and the capability-vs-cost comparison per person
- **Why users want it:** Managers could tell 'expensive because advanced' from 'expensive with low growth' — today only team-level spend exists.
- **What has to change:** Add the per-member cost table + explainable efficiency classification (never an opaque efficiency score) gated by an admin 'show individual cost' setting; keep 'never recommend cutting access just because expensive'.
- **Data & metric logic:** CostAllocation per user + capability/growth join; classification is rule-based and must state why it was assigned (§6.8).
- **Backend/API & UI impact:** New cost table + classification lib + admin visibility toggle.
- **Privacy & permissions:** Per-member cost visible to managers must be admin-configurable (§3.3/§10) — the toggle does not exist yet.
- **Dependencies & migrations:** Depends on manager-readable per-person data + cost allocation.
- **Tests & acceptance:** Classification explains itself; no cost enters capability scoring; toggle hides individual cost when off.

### TCI-UX-016 — Flow D end-to-end: individual reviews team-assigned development

**Partial** · effort M · priority P2 · risk medium

> Member opens Individual Overview, sees an assigned development priority, opens the score explanation, reviews recommendations + assigned activities, completes them, and the system tracks later capability change. *(TCI §12)*

- **What exists today (evidence):** Self-driven half works: Individual Overview (personal-self-view.tsx), recommendations + why-line + confidence note (recommendation-card.tsx:42-55), mark-tried/snooze/dismiss (rec-interaction-actions), missions completing on measured activity (mission-progress) and milestones tracking change (growth/page.tsx:172-176). Missing: an 'assigned' (manager-set) development priority + assigned activities — coaching is self-derived, not assignable
- **Why users want it:** A member can already follow self-derived guidance and see grounded progress; they just can't yet receive a manager-assigned priority.
- **What has to change:** Add rendering of manager-assigned coaching items on the IC overview once an assignment entity exists; the completion/tracking machinery (missions/milestones) can be reused.
- **Data & metric logic:** Needs a coaching-assignment record linking manager action → member; completion detection can reuse the measured-crossing pattern (missions).
- **Backend/API & UI impact:** Assigned-items section on the IC overview.
- **Dependencies & migrations:** Depends on the Coaching Center / manager-assignment surface (§6.6), which is Missing.
- **Tests & acceptance:** Assigned items render only when assigned; self-derived path unchanged.

### TCI-UX-017 — Dense controls (radar, matrix density/column toggles, 10+ filters) vs minimal-by-default

**Conflicting** · effort M · priority P1 · risk medium

> TCI team screens introduce radar charts, a capability-matrix density toggle + column selector + saved views, and 8-12 filter panels per screen. *(TCI §6)*

- **What exists today (evidence):** Violates the minimal-by-default / progressive-disclosure product law (CLAUDE.md UX principles) and reverses W5-H, which curated ~18 panels into 5 cards and folded usage detail behind a disclosure (team-overview.tsx:240-368, 310-323); founder D4 ratified fewer/larger cards + one dominant action (product-signoffs.md:15). The spec itself concedes radar is harder to read than aligned bars (tci.md:569)
- **Why users want it:** Managers get a clean, low-cognitive-load surface rather than a dense analytics console.
- **What has to change:** Recommend SIMPLIFY: use aligned horizontal bars (not radar) per the spec's own concession; replace the 10-filter matrix with a small default view + progressive disclosure for advanced controls; drop density toggle / column selector / saved views from MVP. Any TCI team screen must match the 5-card, count-only template.
- **Dependencies & migrations:** Contradicts approved U1/D4 direction if built as specified.

<a id="qa"></a>
## Tests & acceptance criteria

### TCI-QA-001 — Team Overview one-screen acceptance test

**Missing** · effort M · priority P1 · risk medium

> Prove a manager can read the team's strongest capability, weakest capability, growth direction, top coaching action, and total spend without leaving one screen. *(TCI §16 Team Overview)*

- **What exists today (evidence):** No manager capability-overview screen or its test exists. The existing team surface is src/app/(app)/dashboard/team-overview.tsx (count-only, 5 cards) with no capability strongest/weakest/coaching fields; closest render-test patterns are src/components/companion/companion-cards.test.tsx and src/components/maturity/maturity-report.test.tsx.
- **Why users want it:** A manager gets a trustworthy 30-second read of team AI capability and what to do next.
- **What has to change:** Build the manager Team Overview surface, then add a component render test asserting all five facts appear. Recommend deferring behind the same gate as the rest of the manager layer; do not build the acceptance test before the screen exists.
- **Data & metric logic:** Test needs a fixture org with capability-state rows for enough members to clear MIN_PEOPLE, plus a spend fixture; assert strongest/weakest come from real aggregated capability scores, never a fabricated 0.
- **Backend/API & UI impact:** New RSC page + new component test file; reuse the companion-cards.test.tsx render harness.
- **Privacy & permissions:** Screen must stay count-only / aggregate at this level so it does not become a per-person view (see TCI-QA-004).
- **Dependencies & migrations:** Depends on the team aggregation entities (TeamCapabilitySnapshot) and the manager-facing surface, both unbuilt.
- **Tests & acceptance:** New Team Overview render test modeled on companion-cards.test.tsx; assert the five required facts and that each score carries confidence + coverage.

### TCI-QA-002 — Every score shows confidence + member coverage

**Partial** · effort S · priority P1 · risk low · quick win

> Every displayed score must show a confidence level and the represented-member coverage (how many of the team the number is based on). *(TCI §16 Team Overview)*

- **What exists today (evidence):** Confidence tiers and coverage already exist for the individual side: capability-state directional/measured tiers (src/scoring/capability-state.ts), the Data Confidence card, signal-coverage (tests/signal-coverage.test.ts), and honesty-gap tests (tests/dashboard-honesty-gaps.test.ts). No team-score confidence/coverage renderer or test exists yet.
- **Why users want it:** Managers never mistake a thin-data guess for a solid number.
- **What has to change:** Extend the existing data-confidence framework to team-aggregated scores; add a render test that fails if any team score renders without a confidence badge and coverage count.
- **Data & metric logic:** Coverage = representedMemberCount / totalMemberCount from the team snapshot; confidence derived from evidence counts, reusing the existing confidence derivation rather than a new formula (formula DSL is a tripwire).
- **Backend/API & UI impact:** Shared CapabilityScoreCard/ConfidenceBadge components + a new team render test.
- **Privacy & permissions:** Coverage counts must respect MIN_PEOPLE so a small team's coverage number cannot re-identify who is excluded.
- **Dependencies & migrations:** TeamCapabilitySnapshot entity (unbuilt).
- **Tests & acceptance:** Render test asserting no score renders without confidence + coverage; extend the dashboard-honesty-gaps pattern to team scores.

### TCI-QA-003 — Every primary insight deep-links to detail

**Missing** · effort S · priority P2 · risk low

> Every primary insight card must link to the supporting detail screen that explains it. *(TCI §16 Team Overview)*

- **What exists today (evidence):** No manager insight feed or deep-link test exists. The individual coaching card carries a computed why-line (tests/score-insights.test.ts) but no manager-insight deep-link contract is present.
- **Why users want it:** Managers can always trace an insight back to its evidence instead of trusting a headline.
- **What has to change:** Add a test that every ManagerInsight card renders a non-empty deep-link and that the target route exists.
- **Data & metric logic:** Deep-link target derived from affectedCapabilityIds/affectedUserIds on the insight object.
- **Backend/API & UI impact:** Component test over the insight feed.
- **Privacy & permissions:** A deep-link to an individual must be authz-gated (see TCI-QA-008), or it becomes an unauthorized per-person path.
- **Dependencies & migrations:** ManagerInsight entity + Manager Insights screen (unbuilt).
- **Tests & acceptance:** Insight-feed render test asserting each card has a resolvable deep-link.

### TCI-QA-004 — Capability Matrix — manager sees every member's per-capability scores

**Conflicting** · effort XL · priority P0 · risk high

> A manager can compare all members across all enabled capabilities in a people-by-capability grid. *(TCI §16 Capability Matrix)*

- **What exists today (evidence):** This is a manager-facing per-person capability view. Today capability/mastery state is deliberately self-view-only: tests/exposures.test.ts:106 pins forUser to the caller's own rows and returns nothing for another user; the team surface is count-only with a MIN_PEOPLE floor (tests/capability-coverage.test.ts:73-84); tests/dashboard-privacy.test.ts enforces team-only-pseudonymized so real names are hidden in private mode. A per-member matrix would require overturning all three. CLAUDE.md marks companion-in-team-orgs (W6-A) founder-gated on a ~6-week dogfood clock.
- **Why users want it:** Managers want a diagnostic grid, but the approved model protects individuals from per-person exposure.
- **What has to change:** Do NOT build the acceptance test as written. Escalate as a privacy-model reversal needing a founder decision + ADR. If approved, the matrix needs a per-member visibility gate, and dashboard-privacy.test.ts / the exposures self-view test must be explicitly amended (not silently broken).
- **Data & metric logic:** Any per-cell number must still obey never-fabricate-a-number: insufficient-data cells say so, never floor to 0.
- **Backend/API & UI impact:** Reverses the self-view-only privacy model across capability-state, exposures, and the team dashboard — multi-surface.
- **Privacy & permissions:** Major privacy change: exposes each member's per-capability scores to a manager. Requires founder sign-off + ADR, not a UI ticket.
- **Dependencies & migrations:** Blocked by W6-A dogfood clock AND a founder privacy decision; conflicts with the count-only/self-view-only invariants.
- **Tests & acceptance:** Cannot ship an acceptance test until the model is re-decided; the correct QA action is a guard test that FAILS if per-person capability leaks to a non-self reader until an ADR flips it.

### TCI-QA-005 — Low-confidence / insufficient-data cells visually distinct + every cell explainable

**Partial** · effort S · priority P2 · risk medium

> Low-confidence and insufficient-data cells must be visually distinct, and every cell must open an explanation. *(TCI §16 Capability Matrix)*

- **What exists today (evidence):** The honesty/explainability building blocks exist: confidence tiers (src/scoring/capability-state.ts), honesty-gap surfacing (tests/dashboard-honesty-gaps.test.ts), and a data-confidence disclosure framework. No matrix cell renderer or its distinct-state test exists.
- **Why users want it:** Managers can instantly see which numbers to trust and drill into any of them.
- **What has to change:** Add a render test asserting insufficient-data and low-confidence cells get a distinct visual state and that every cell exposes an explanation affordance.
- **Data & metric logic:** Insufficient-data state comes from zero/low evidence counts, reusing existing confidence derivation.
- **Backend/API & UI impact:** Component test over the matrix cell; blocked by the matrix itself (TCI-QA-004).
- **Privacy & permissions:** Same per-person exposure concern as TCI-QA-004.
- **Dependencies & migrations:** Depends on TCI-QA-004 being unblocked.
- **Tests & acceptance:** Cell-state render test modeled on dashboard-honesty-gaps distinctions.

### TCI-QA-006 — Coaching Center — insight→action, tracked to completion, baseline+follow-up stored

**Missing** · effort L · priority P1 · risk high

> A manager can convert an insight into an assigned coaching action, track it through completion, and the system stores baseline and follow-up capability values. *(TCI §16 Coaching Center)*

- **What exists today (evidence):** No coaching-assignment or campaign entity exists. The individual side has self-view rec interaction state (snooze/dismiss, tests/rec-interactions.test.ts) but no manager-assigned action, no CoachingCampaign table, and no baseline-snapshot storage. Spec §6.6 defines new CoachingCampaign/CoachingActivity objects.
- **Why users want it:** Managers turn a diagnosis into a tracked development action with a measurable before/after.
- **What has to change:** New org-scoped coaching_campaigns / coaching_actions tables (self-referential to members) plus baseline-snapshot storage; acceptance test drives an insight→assigned-action→completed lifecycle and asserts baseline+follow-up rows persist.
- **Data & metric logic:** Baseline captured at assignment time from capability-state; follow-up read later. §16 also forbids claiming causal coaching impact without experimental evidence — the test must assert the UI shows observed change, never a causal claim.
- **Backend/API & UI impact:** New tables + new surface + lifecycle test; three registrations each (see TCI-QA-012).
- **Privacy & permissions:** Assigning coaching to a named member is a manager→member action needing the authz gate (TCI-QA-008).
- **Dependencies & migrations:** Depends on the manager layer and the per-member view decision (TCI-QA-004).
- **Tests & acceptance:** New coaching-lifecycle test (assign→track→complete→baseline/follow-up stored); reuse the CAS/idempotency pattern from tests/exposures.test.ts and tests/missions.test.ts.

### TCI-QA-007 — Costs — separate high spend from adoption/capability; cost never in scoring

**Partial** · effort M · priority P1 · risk medium

> Managers can distinguish high spend from low adoption and from high-capability advanced use; cost-allocation confidence is visible; cost is never an input to capability scoring. *(TCI §16 Costs and Efficiency)*

- **What exists today (evidence):** Cost/spend already exists (budgets, spend alerts: tests/budget-alert.test.ts, tests/spend-governance.test.ts) and scoring already excludes cost by design (scoring inputs are metric_records only; tests/scoring-evaluate.test.ts honesty rules floor non-ratio components, never cost). No per-member efficiency classification, no allocation-confidence renderer, and no EXPLICIT guard test asserting cost/spend is absent from scoring inputs.
- **Why users want it:** Managers investigate spend without cost becoming a proxy for capability or a reason to cut access.
- **What has to change:** Add explicit guard test: capability scoring inputs must not include any cost/spend field (assert on the scoring input shape). Build the efficiency-classification view with explainable buckets (§6.8) — never a single opaque efficiency score (tripwire-adjacent, spec-forbidden).
- **Data & metric logic:** Allocation confidence from CostAllocation.confidence; efficiency buckets are rule-labeled and must each carry a why-string, no ML service (tripwire).
- **Backend/API & UI impact:** New guard test in the scoring suite + new cost surface/test.
- **Privacy & permissions:** Per-member cost visibility is admin-configurable (§10) — the test must respect the visibility flag.
- **Dependencies & migrations:** CostAllocation entity for per-member allocation confidence.
- **Tests & acceptance:** New scoring-input-isolation test (no cost field reaches the scorer); efficiency-classification test asserting each bucket has an explanation.

### TCI-QA-008 — Manager-vs-member per-role authorization sweep (NEW test infra)

**Partial** · effort L · priority P0 · risk high

> Users cannot access unauthorized individual data; each role (individual contributor, manager, admin, observer) sees only what its permissions allow. *(TCI §16 Privacy)*

- **What exists today (evidence):** Route tests today cover only signed-out (401), non-admin (403), and cross-org: tests/api-routes.test.ts:120-288 and the org-level sweep in tests/tenant-isolation.test.ts. roles/role_assignments exist (tests/roles.test.ts) but no route enforces manager-vs-member, and no per-role authz matrix test exists. Every TCI screen is role-scoped, so this is the central missing QA surface.
- **Why users want it:** A team member cannot read a peer's scores/costs/notes; an observer cannot see individual evidence.
- **What has to change:** Build a manager-vs-member route authz sweep: for every new team route, assert IC / manager / admin / observer each get the intended 200/403. This is genuinely new test infrastructure the team layer requires.
- **Data & metric logic:** Authz derived from role_assignments + team membership; the sweep must be registry-driven (like SCOPED_READS) so a new route added later cannot skip it.
- **Backend/API & UI impact:** New authz-matrix test harness spanning all team routes.
- **Privacy & permissions:** This IS the privacy enforcement layer for the whole TCI program.
- **Dependencies & migrations:** Depends on a manager-authorization primitive (does not exist; today only platform-admin and org-scope gates exist).
- **Tests & acceptance:** New per-role route authz sweep with a completeness assertion; extend the 401/403 patterns in api-routes.test.ts into a role matrix.

### TCI-QA-010 — Manager notes cannot affect algorithmic scoring

**Missing** · effort L · priority P1 · risk medium

> Manager-entered notes must never alter or feed into calculated capability scores. *(TCI §16 Privacy)*

- **What exists today (evidence):** No manager-notes entity exists anywhere in the repo, so neither the notes nor the guard proving they are excluded from scoring exists. Analogous isolation is already proven for renewal_date being unverifiable/non-scoring (tests/renewal-reminders.test.ts) — same 'user-entered field never touches the score' shape.
- **Why users want it:** Members are protected from a manager quietly biasing their score via a note.
- **What has to change:** New org-scoped manager_notes table (self-view-blocked from members) + a guard test asserting note content is not among capability-scoring inputs.
- **Data & metric logic:** Notes stored as free text with author/timestamp; scoring input set asserted to exclude notes.
- **Backend/API & UI impact:** New table (three registrations) + a scoring-input-isolation test.
- **Privacy & permissions:** Notes are manager-private per §6.12 — must be unreadable by the noted member; needs its own note-privacy test.
- **Dependencies & migrations:** Depends on the manager layer + authz gate (TCI-QA-008).
- **Tests & acceptance:** Note-privacy test (member cannot read notes about them) + scoring-isolation test (notes absent from scorer inputs).

### TCI-QA-011 — Data limitations visible where they materially affect interpretation

**Partial** · effort S · priority P2 · risk low · quick win

> Data limitations / confidence disclosures must be visible wherever incomplete data materially changes how a number should be read. *(TCI §16 Privacy)*

- **What exists today (evidence):** The individual side already has this: the Data Confidence card + framework (src/lib/data-confidence.ts per CLAUDE.md), honesty-gap tests (tests/dashboard-honesty-gaps.test.ts), signal-coverage (tests/signal-coverage.test.ts). No team-surface disclosure renderer/test exists.
- **Why users want it:** Managers are warned when a number rests on thin or stale data.
- **What has to change:** Extend the data-confidence disclosure to every team surface; add render tests asserting a disclosure appears when coverage/confidence is below threshold.
- **Data & metric logic:** Reuse existing confidence/coverage derivations; register each new team disclosure as a definition in the data-confidence framework.
- **Backend/API & UI impact:** Shared disclosure component + team render tests.
- **Privacy & permissions:** Disclosures must stay count-only so they do not leak who is missing.
- **Dependencies & migrations:** TeamCapabilitySnapshot + team surfaces.
- **Tests & acceptance:** Extend dashboard-honesty-gaps pattern to team disclosures.

### TCI-QA-012 — Three-registration discipline for every new team table

**Missing** · effort XL · priority P0 · risk high

> Every new org-scoped TCI table (Team, RolePack extensions, TeamCapabilitySnapshot, CostAllocation, CoachingCampaign, ManagerInsight, ManagerNote, mentor matches) must be registered in the three CI-enforced guards or it reds main. *(TCI §9 Data (TCI-wide QA readiness))*

- **What exists today (evidence):** The three guards exist and are strict: tenant-isolation SCOPED_READS with a non-vacuous B-org seed + completeness assertion (tests/tenant-isolation.test.ts:50-60), the FK-ordered purge with a ≥21-edge anti-vacuity floor (tests/account-deletion.test.ts:287-337), and the frozen-contracts ADR gate in CI (.github/workflows/ci.yml:39-89). Every TCI table is new, so none is registered yet.
- **Why users want it:** Prevents an added team table from silently escaping org-isolation or account-deletion purge (a real leak/GDPR risk).
- **What has to change:** For each new table: add a SCOPED_READS entry with a seeded B-org row, add to PURGE_TABLES (or PURGE_EXEMPT with reason) and bump the ≥21-edge floor as FKs grow, and write an ADR. This is per-table L effort; program-wide it is XL.
- **Data & metric logic:** The purge floor test counts in-purge FK edges — every new composite tenant FK must be counted, and the floor raised to match.
- **Backend/API & UI impact:** Touches frozen paths (schema.ts, drizzle/, org-scope) so each table PR needs its own ADR.
- **Privacy & permissions:** Missing a purge registration means a deleted account's team data survives — a direct privacy failure.
- **Dependencies & migrations:** Each table change trips the frozen-contracts CI guard and needs an ADR in the same PR.
- **Tests & acceptance:** tenant-isolation completeness sweep + account-deletion purge-order/floor test — both already CI-enforced and will red main if a table is unregistered.

### TCI-QA-013 — MIN_PEOPLE floor tests for every new team aggregate

**Partial** · effort M · priority P1 · risk medium

> Every count-only team aggregate (capability distribution, maturity movement counts, coverage, concentration risk, benchmarks) must suppress any group below the MIN_PEOPLE floor entirely, with a test proving it. *(TCI §6 (TCI-wide QA readiness))*

- **What exists today (evidence):** The pattern exists and is proven for one aggregate: tests/capability-coverage.test.ts:73-84 asserts a capability below SEGMENT_MIN_PEOPLE_TO_NAME is dropped entirely (never suppressed-but-implied). Every NEW team aggregate needs its own such test; none exist yet.
- **Why users want it:** A small subgroup's numbers can never be used to re-identify or single out an individual.
- **What has to change:** Add a MIN_PEOPLE floor test per new aggregate; assert a below-floor group is absent from the output shape, not merely blanked in the UI.
- **Data & metric logic:** Reuse SEGMENT_MIN_PEOPLE_TO_NAME; the row/prop type must carry no person id so a per-person leak is structurally impossible (the W7-6 pattern).
- **Backend/API & UI impact:** One test per aggregate; cheap individually, broad across the program.
- **Privacy & permissions:** This is the core individual-protection guarantee for aggregates.
- **Dependencies & migrations:** Each depends on its aggregate being built.
- **Tests & acceptance:** Clone the capability-coverage floor test per aggregate.

### TCI-QA-014 — Anti-gamification / banned-phrasing sweeps for all new team copy

**Partial** · effort S · priority P1 · risk medium · quick win

> New team/coaching/insight/benchmark/report copy must pass anti-gamification and no-leaderboard/no-ranking sweeps; benchmark screens must not become employee rankings. *(TCI §2.2 / §6.10 (TCI-wide QA readiness))*

- **What exists today (evidence):** Two banned-phrasing patterns exist and are enforced: the missions schema+copy sweep (tests/missions.test.ts:73-78,159-173 — no xp/streak/league/points/badge/level-up) and the LMS/curriculum sweep (tests/capability-curriculum.test.ts:55-110). The TCI Benchmarks screen (§6.10) and 'ready for next level' framing are gamification-risk copy with no sweep yet.
- **Why users want it:** Keeps the product coaching-first and non-competitive, honoring the founder-signed anti-gamification stance.
- **What has to change:** Add banned-phrasing tests over all new team copy, extending the banned list to leaderboard/ranking/'top performer' framing for benchmarks.
- **Data & metric logic:** Static copy sweep, no runtime data.
- **Backend/API & UI impact:** One or more copy-sweep test files.
- **Privacy & permissions:** Rankings that name individuals would also be a privacy exposure.
- **Dependencies & migrations:** Depends on the new copy existing.
- **Tests & acceptance:** Extend the missions/curriculum banned-substring sweep to team copy.

### TCI-QA-015 — Shared-source parity + migration-equivalence guards for team reuse

**Partial** · effort M · priority P2 · risk medium

> Where team aggregation, reports, notifications, and the dashboard reuse the same scoring/rec engine, tests must pin identical output (no silent divergence between surfaces). *(TCI §9 / §6.11 (TCI-wide QA readiness))*

- **What exists today (evidence):** The parity patterns exist: digest↔dashboard share the SAME coaching source with identical selection+order (tests/digest-content.test.ts:261-268), and migration-equivalence/output-equivalence guards pin byte-identical behavior (tests/recommendation-catalog.test.ts:225-255, tests/utility-ranker.test.ts). TCI adds weekly/monthly/quarterly reports + manager notifications that must not drift from the on-screen numbers — no such parity test exists yet.
- **Why users want it:** A number in a report or notification always matches what the manager sees on screen.
- **What has to change:** Add shared-source parity tests for report↔dashboard and notification↔insight; add equivalence guards if team aggregation reuses deriveAttention / capability-state.
- **Data & metric logic:** Both paths must call the same pure derivation off the same rows.
- **Backend/API & UI impact:** New parity test files.
- **Privacy & permissions:** n/a
- **Dependencies & migrations:** Depends on reports/notifications being built.
- **Tests & acceptance:** Clone the digest-content shared-source test for report and notification paths.

### TCI-QA-016 — Suite scale + flake tolerance for the expanded team suite

**Partial** · effort M · priority P2 · risk medium

> The test suite must stay reliable as the team layer roughly doubles it, tolerating the repo's known Windows/load-related flakes and keeping per-person query cost independent of team size. *(TCI TCI-wide QA readiness)*

- **What exists today (evidence):** Known flakes are documented (CLAUDE.md: occasional '[vitest-pool]: Worker exited unexpectedly' Windows fork crash, a rare pseudonym-collision in tests/api-impl.test.ts, and 2-5 auth/connector files failing a different set under load — confirm by running named files in isolation). A perf guard already pins read cost independent of person count (tests/perf/capability-state-queries.test.ts:46-62, 20x people → identical query count). New team aggregates must add the same perf guard, and CI must keep the rerun-on-flake strategy.
- **Why users want it:** CI stays trustworthy so real regressions are not lost in flake noise as the suite grows.
- **What has to change:** Add per-aggregate perf guards (query count independent of team size); document a rerun/isolation policy so the larger suite's flake surface does not block merges; keep gh-run-rerun for the Hyperdrive-binding 500.
- **Data & metric logic:** Team aggregation reads must be batched once per org, not per-member, to keep the perf guard green.
- **Backend/API & UI impact:** New perf test files + CI reliability policy.
- **Privacy & permissions:** n/a
- **Dependencies & migrations:** 132 test files today (tests/*.test.ts); a team layer materially increases fork-crash exposure on Windows.
- **Tests & acceptance:** Clone tests/perf/capability-state-queries.test.ts per team aggregate; keep the named-file isolation rerun habit.

<a id="docs"></a>
## Documentation & governance

### TCI-DOC-001 — TCI is an unsigned proposal, not ground truth

**Conflicting** · effort S · priority P0 · risk low · quick win

> The TCI document must be filed and treated as an unratified proposal, with docs/Revealyst_Product_Spec_V4.md remaining product ground truth until the founder signs TCI off. *(TCI § front matter)*

- **What exists today (evidence):** tci.md:5 declares 'Document version: 1.0' with no provenance/author/repo-path; every requirement line is tagged [INFERRED, HIGH|MED] (e.g. tci.md:9, tci.md:33, tci.md:2289) — 100% inferred, zero signed. Repo rule that this collides with: CLAUDE.md 'Ground truth: Product Spec V4'; docs/product-signoffs.md:1-9 (founder judges evidence; human gates never self-certified, rule 4).
- **Why users want it:** Readers and future agents can tell at a glance that TCI is a direction to evaluate, not a contract to build, so no one ships against unsigned scope.
- **What has to change:** Do NOT treat TCI as ground truth. File it under docs/ (e.g. docs/proposals/Revealyst_TCI_Proposal.md) with a header stating: version 1.0, source = external product proposal, status = unratified, superseded-by/ground-truth = Spec V4. Simplify/defer: keep the [INFERRED] tags in place as the honest provenance marker.
- **Backend/API & UI impact:** No backend/API impact; docs-only. Prevents an invariant-(b)-style overclaim where an inferred doc is cited as decided product.
- **Dependencies & migrations:** Founder ratification is the gate before any TCI requirement is promoted from proposal to spec.
- **Tests & acceptance:** N/A (doc). Acceptance: the doc's own header names it a proposal and points to Spec V4 as ground truth.

### TCI-DOC-002 — Gap analysis must follow the docs/product/ house style

**Partial** · effort M · priority P1 · risk low

> The TCI gap analysis and any requirements registry must be authored in the established docs/product/ four-file house style, not as a free-form memo. *(TCI whole-document)*

- **What exists today (evidence):** House style exists and is proven: docs/legacy/product/revealyst-gap-analysis.md:1-11 (narrative + 'Companion artifacts' list), docs/product/requirements.csv (header id,spec_section,tier,domain,requirement), docs/legacy/product/traceability.csv (id,spec_section,tier,domain,status,evidence), docs/legacy/product/implementation-roadmap.md. The TCI-specific instance of these does not yet exist.
- **Why users want it:** Managers and agents get a TCI analysis in the same shape they already read, with stable requirement IDs and code-cited evidence rather than prose opinion.
- **What has to change:** Produce the TCI analysis as: a narrative gap-analysis.md + requirements.csv (stable TCI-* IDs) + traceability.csv (status + file:line evidence) + a roadmap. Reuse the status vocabulary from docs/legacy/product/revealyst-gap-analysis.md:37. Recommend a docs/product/tci/ subfolder so it does not overwrite the Spec-V4 registry.
- **Backend/API & UI impact:** Docs-only.
- **Dependencies & migrations:** Depends on the per-domain specialist outputs feeding one reconciled registry (this multi-agent run).
- **Tests & acceptance:** N/A. Acceptance: four artifacts present, CSV headers match the existing files, every status cites code.

### TCI-DOC-003 — Superseded-banner + single-source-of-truth discipline

**Partial** · effort S · priority P1 · risk low · quick win

> Any TCI plan/analysis doc must carry the repo's superseded-banner + single-source-of-truth convention so it can never silently outlive the code or duplicate ground truth. *(TCI whole-document)*

- **What exists today (evidence):** Pattern exists: docs/legacy/ai-capability-implementation-gap-analysis.md:1-16 (a '> Superseded.' banner pointing to CLAUDE.md wave banners as current truth); docs/Revealyst_Execution_Plan_V4.md §7 'Documentation state & the single-source-of-truth rule'. No TCI doc carries it yet.
- **Why users want it:** Prevents the exact drift the repo keeps hitting — a point-in-time doc read as current after the code moved past it.
- **What has to change:** Add the standard banner to any TCI doc and cross-link CLAUDE.md/Spec V4 as the live source. When TCI (or parts) ship or are rejected, banner the proposal accordingly rather than editing it into a false 'current' state.
- **Backend/API & UI impact:** Docs-only.
- **Tests & acceptance:** N/A. Acceptance: banner present + points to a live source.

### TCI-DOC-004 — Each new TCI entity needs an ADR + 3 registrations

**Missing** · effort XL · priority P1 · risk high

> Every net-new org-scoped table TCI implies (Team, RolePack, CapabilityDefinition, TeamCapabilitySnapshot, CostAllocation, CoachingCampaign, ManagerInsight, manager notes, etc.) must land via the repo's ADR + three-registration governance, with ADR and migration numbers claimed independently at build time. *(TCI §9 Data and Backend Requirements)*

- **What exists today (evidence):** Governance rules: docs/decisions/README.md:1-15 (ADR required before a frozen-contract change; unique 4-digit prefixes CI-enforced; ADR vs migration numbers independent); CLAUDE.md 'A new org-scoped table needs THREE registrations' (tenant-isolation SCOPED_READS + ADR + account-deletion purge). TCI proposes ~8 new entities (tci.md:1843-1935) with zero ADRs drafted.
- **Why users want it:** Keeps tenant isolation and account-deletion completeness intact as the team layer grows, so a new table can't silently leak across orgs or survive an account purge.
- **What has to change:** For each TCI table: draft an ADR (next free number — latest is 0043, NOT 0042; check ls docs/decisions and ls drizzle/*.sql separately), add a tenant-isolation SCOPED_READS entry with a non-vacuous B-org seed, and register in account-deletion PURGE_TABLES/PURGE_EXEMPT. Serialize the builds (repeat of the W4/W6 parallel-append lesson in CLAUDE.md).
- **Backend/API & UI impact:** Each entity is an L-effort change (table + ADR + 3 registrations); the set is XL.
- **Privacy & permissions:** Several of these tables (per-person scores, cost, notes) carry the privacy conflicts flagged in TCI-DOC-006/008 — the ADR is where that gets adjudicated.
- **Dependencies & migrations:** Blocked behind founder sign-off of the conflicting scope (TCI-DOC-006/007/008/009).
- **Tests & acceptance:** tenant-isolation completeness tripwire + account-deletion purge tripwire must stay green. Acceptance: no new table without all three registrations.

### TCI-DOC-005 — Every conflicting TCI ask needs a product-signoffs row first

**Missing** · effort S · priority P0 · risk low · quick win

> Each TCI requirement that crosses a founder-signed decision or named gate must get a docs/product-signoffs.md row (pending → ratified/overridden) before it is built. *(TCI whole-document)*

- **What exists today (evidence):** Ledger exists and is the required home: docs/product-signoffs.md:1-9 + the D4/D5/D7/D8/D9/D10/OQ-00x rows. No TCI rows exist. CLAUDE.md rule 4: gates are human-reviewed, never self-certified by the authoring agent.
- **Why users want it:** The founder has one citable place to accept or reject each TCI trade-off, and agents never build unsigned scope by accident.
- **What has to change:** Add one ledger row per conflict below (TCI-DOC-006..014), each 'Pending' until the founder rules. Record the orchestrator resolution rule (TCI-DOC-016) as a note in the same file.
- **Backend/API & UI impact:** Docs-only.
- **Tests & acceptance:** N/A. Acceptance: a signoffs row exists for every Conflicting requirement before its build PR opens.

### TCI-DOC-006 — Manager-facing per-person capability view crosses self-view-only

**Conflicting** · effort XL · priority P1 · risk high

> TCI's Capability Matrix and manager-facing individual profile expose each named member's per-capability scores to their manager. *(TCI §6.2 / §6.4)*

- **What exists today (evidence):** TCI wants it: tci.md:651-711 (Capability Matrix rows = named team members with per-capability cells) and tci.md:845-995 (manager-facing individual profile with capability breakdown). Founder-signed opposite: mastery is deliberately self-view-only — docs/decisions/0036-user-capability-state.md; CLAUDE.md P2 'org-scoped, self-view-only mastery table' and P7 'self-view-only — no manager/admin read route; never on the team view'.
- **Why users want it:** Intended value (manager can target coaching) is real, but the repo deliberately withholds named per-person capability from managers to protect individuals — a value the founder has signed.
- **What has to change:** Flag as a MAJOR privacy-model change, not a UI task. Resolution per the orchestrator rule = do NOT adopt as written; it crosses a signed decision. If pursued, it needs its own founder-signed ADR reversing self-view-only (the P7 exposure-log ADR 0038 is the template for a founder-signed reversal), plus manager read routes that today intentionally do not exist.
- **Data & metric logic:** Would require a manager-scoped read over user_capability_state that the current org-scope API does not expose.
- **Backend/API & UI impact:** New manager read routes + a reversal of the self-view-only guard; large backend + UI surface.
- **Privacy & permissions:** Direct reversal of the self-view-only privacy commitment — highest-sensitivity conflict in the document.
- **Dependencies & migrations:** Founder-signed ADR reversing ADR 0036's self-view-only stance; product-signoffs row.
- **Tests & acceptance:** tenant-isolation + any new visibility predicate must be updated (not left vacuous). Acceptance: no manager per-person route ships without the reversing ADR.

### TCI-DOC-007 — Named per-person team scores cross count-only + MIN_PEOPLE

**Conflicting** · effort L · priority P1 · risk high

> TCI shows named members in a matrix/table with individual scores and small-segment breakdowns, without a minimum-people floor. *(TCI §6.1 / §6.2 / §6.3)*

- **What exists today (evidence):** TCI: tci.md:771-843 (Team Members table, per-member rows) and tci.md:651-769 (matrix, optional grouped rows by squad/location). Founder-signed opposite: team view is count-only with a MIN_PEOPLE champion floor and pseudonymized private mode — CLAUDE.md W5 'segments count-only-everywhere + MIN_PEOPLE champion floor'; P6 'count-only, MIN_PEOPLE-floored ... a capability below the floor is dropped entirely (never a suppressed-but-implied number)'; src/lib/nav-items.ts + team-overview is 5 count-only card sections.
- **Why users want it:** Managers get diagnostic depth, but the signed design refuses to name or imply small-group individuals to prevent re-identification and surveillance framing.
- **What has to change:** Do NOT adopt named/unfloored per-person tables as written. Where TCI overlaps the existing team surface, prefer the count-only + MIN_PEOPLE approach already shipped (this is Obsolete-by-better-approach for the aggregate cards). Any named view inherits the TCI-DOC-006 privacy reversal.
- **Data & metric logic:** Count-only rollups already exist (mastery.coverageCounts, SEGMENT_MIN_PEOPLE_TO_NAME); the leak-proof row types carry no person id.
- **Backend/API & UI impact:** Adopting TCI as written would remove a shipped privacy guard; recommend keeping the guard.
- **Privacy & permissions:** Crosses the MIN_PEOPLE + pseudonymized-private-mode protections.
- **Dependencies & migrations:** Same founder-signed reversal as TCI-DOC-006.
- **Tests & acceptance:** Existing count-only shape tests must not regress. Acceptance: no per-person row type gains a name/id below the floor.

### TCI-DOC-008 — Manager-visible individual cost crosses privacy model

**Conflicting** · effort L · priority P2 · risk high

> TCI lets managers see each member's individual spend, model mix, and token volume. *(TCI §3.2 / §6.4 / §6.8)*

- **What exists today (evidence):** TCI: tci.md:99-119 (managers see 'individual-level cost analytics'), tci.md:963-981 (per-member Cost and Usage tab), tci.md:1309-1329 (Individual Cost Table with per-member monthly spend). It does add an admin toggle (tci.md:1997) and 'never reduce access solely because expensive' (tci.md:1361). Tension with: the count-only/pseudonymized team model (CLAUDE.md W5) and spend surfaced today at team grain (src/lib/nav-items.ts:88 '/spend').
- **Why users want it:** Cost transparency for managers is legitimate, but naming per-person spend re-introduces the individual-identification the team model avoids.
- **What has to change:** Adopt the admin-gated visibility framing (TCI already scopes it behind a workspace-admin toggle, which is compatible with the privacy-first default). Recommend default OFF + a signoffs row; do NOT expose per-person cost by default.
- **Data & metric logic:** Spend data exists at org/team grain; per-person allocation confidence is itself a TCI concept (CostAllocation.confidence, tci.md:1915-1935).
- **Backend/API & UI impact:** New per-person cost read + admin visibility setting.
- **Privacy & permissions:** Per-person cost is individual-identifying; must default to hidden and be admin-configurable.
- **Dependencies & migrations:** Founder sign-off; coupled to TCI-DOC-006 privacy reversal.
- **Tests & acceptance:** Acceptance: individual cost hidden unless the admin visibility flag is on.

### TCI-DOC-009 — Prompt-level evidence crosses the no-prompt-content tripwire

**Conflicting** · effort S · priority P0 · risk high · quick win

> TCI implies prompt-level evidence can be made available (hidden 'by default', configurable on). *(TCI §2.4 / §6.12 / §10)*

- **What exists today (evidence):** TCI: tci.md:63 'Sensitive prompt content should not be exposed by default', tci.md:1601 'whether prompt-level evidence is available', tci.md:1981 'behavioral summaries, not raw private conversations by default'. The 'by default' framing implies it can be enabled. Hard ban: CLAUDE.md Tripwires 'no prompt-content ingestion in Team mode'; docs/Revealyst_Product_Spec_V4 NOT-list; the founder-signed desktop-collector direction is content-free events only.
- **Why users want it:** Richer evidence would help scoring, but ingesting prompt content in Team mode is a hard, founder-level product boundary.
- **What has to change:** Do NOT adopt any pathway that makes prompt content available in Team mode, even opt-in — it is a tripwire, not a toggle. Rewrite the TCI language to 'behavioral summaries only; no prompt content is ever ingested in Team mode.' This is a straight Conflicting → reject-as-written.
- **Data & metric logic:** Evidence must stay content-free (markers/aggregate signals), per the OTel measured tier and agent allowlist.
- **Backend/API & UI impact:** Constrains every 'evidence' surface in TCI (matrix hovers, drawers, insight evidenceSummary) to content-free summaries.
- **Privacy & permissions:** Crosses the strongest privacy tripwire in the product.
- **Dependencies & migrations:** None — the ban is non-negotiable without a founder tripwire reversal, which is out of scope for a proposal.
- **Tests & acceptance:** Acceptance: no team-mode code path stores or renders prompt text.

### TCI-DOC-010 — Eight non-engineering role packs cross NOT-015 + role-expansion gate

**Blocked** · effort S · priority P2 · risk low

> TCI ships Product, Marketing, Sales, Customer Success, HR, Finance, Operations role packs alongside Engineering. *(TCI §4.2 / §14)*

- **What exists today (evidence):** TCI: tci.md:291-409 (seven non-eng packs) — though §14 (tci.md:2167) sensibly recommends Engineering-first. Named gate: docs/product/requirements.csv:110 NOT-015 'No non-engineering role libraries in MVP or V1'; docs/Revealyst_Execution_Plan_V4.md Future ledger 'Role expansion beyond Engineering — Evidence-gated: the §16(3) research question (M365 Copilot / Google Workspace admin APIs as honest telemetry) answered affirmatively'; OQ-003 (requirements.csv:155) + OQ-004 (:156).
- **Why users want it:** Cross-function reach is the long-term bet, but there is no honest telemetry source for non-eng roles yet, so scores would be fabricated (invariant b).
- **What has to change:** Adopt the role-AGNOSTIC architecture TCI asks for (tci.md:2169) but keep Engineering as the only shipped pack. Defer the other seven behind the existing Future-ledger gate; each needs OQ-003 answered (a real admin-API telemetry source) before a date.
- **Data & metric logic:** No non-eng data-acquisition strategy exists; the roles seed is engineering-only (ADR 0030).
- **Backend/API & UI impact:** Architecture stays role-agnostic (already true in the capability graph); only the seed data is gated.
- **Dependencies & migrations:** OQ-003/OQ-004 research answered affirmatively (external gate).
- **Tests & acceptance:** Acceptance: only the Engineering pack is seeded/enabled until the gate clears.

### TCI-DOC-011 — Whole team product assumed live — blocked on W6-A dogfood clock

**Blocked** · effort S · priority P0 · risk medium

> TCI assumes a manager-facing team product exists and can be built now. *(TCI §1 / §13 MVP)*

- **What exists today (evidence):** TCI: tci.md:9 'extends the existing Individual AI Growth Companion into a manager-facing capability development platform'; entire §13 MVP (tci.md:2101-2133). Named gate: CLAUDE.md 'W6-A (Companion-in-Team-orgs + dual-source dedup) on the §14 ~6-week dogfood outcome'; docs/legacy/product/revealyst-gap-analysis.md:22 (the #1 structural gap is deliberately gated, clock since 2026-07-14).
- **Why users want it:** The team layer is the monetization bet, but the founder gated it on evidence that individuals voluntarily return first — building the team product before that clock resolves risks inverting the pivot.
- **What has to change:** Do NOT force W6-A. Record TCI as the candidate design FOR when the dogfood gate clears; note that two of three ADR prerequisites already exist in code (visibility predicate, dual-source dedup per gap-analysis.md:22). Sequence any TCI build behind the clock.
- **Backend/API & UI impact:** Gates the whole program's start, not individual features.
- **Dependencies & migrations:** §14 dogfood outcome (founder-gated, ~6-week clock from 2026-07-14).
- **Tests & acceptance:** N/A. Acceptance: no team-product build merges before the gate is signed.

### TCI-DOC-012 — 11-item nav tree crosses minimal-nav U0 IA + D4

**Conflicting** · effort M · priority P1 · risk medium

> TCI adds a top-level 'Team Intelligence' area with eleven sub-items (Overview, Capability Matrix, Team Members, Growth, Coaching, Skills & Experts, Costs & Efficiency, Insights, Benchmarks, Reports, Team Settings). *(TCI §5 Navigation Architecture)*

- **What exists today (evidence):** TCI: tci.md:447-475. Founder-signed opposite: the shipped team nav is four primary items — src/lib/nav-items.ts:72-75 (Team, AI maturity, Connections, Account) + a small admin group (:86-88); CLAUDE.md W5 'Team Intelligence folded ~18 panels → 5 cards'; product-signoffs D4 'fewer/larger cards, progressive disclosure, one dominant action per screen'; CLAUDE.md UX principle 'minimal by default'.
- **Why users want it:** Managers need depth, but the product's signed direction is fewer surfaces with progressive disclosure — an 11-item tree is the pre-consolidation panel sprawl the founder already reversed.
- **What has to change:** Do NOT adopt the 11-item tree. Map TCI's eleven areas onto the existing 5-card team surface + progressive-disclosure drawers (Capability Matrix/Coaching/Skills become drill-downs, not top-level tabs). Consolidate before adding nav.
- **Backend/API & UI impact:** Keeps the shipped IA; TCI content becomes cards/drawers, not routes.
- **Dependencies & migrations:** Aligns with product-signoffs D4 (already ratified).
- **Tests & acceptance:** nav-items.test.ts must stay green (team org = 4 primary items). Acceptance: no net new top-level nav group.

### TCI-DOC-013 — New inactive→expert ladder + 0–100 score cross 'no competing ladder'

**Conflicting** · effort M · priority P1 · risk medium

> TCI introduces a numeric 0–100 capability score plus a five-level 'inactive|beginner|intermediate|advanced|expert' ladder as the hero metric. *(TCI §4.3 / §6.1)*

- **What exists today (evidence):** TCI: tci.md:415-445 (CapabilityScore.score:number, level enum) and tci.md:503-531 (large score as the primary card). Founder-signed opposite: the raw 0–100 is deliberately demoted behind a diagnostic expander and the maturity ladder is a separate 0–4 MODELED model — CLAUDE.md W5 'raw 0–100 demoted behind a diagnostic-details expander ... never a 4th ladder'; src/lib/maturity-glossary.ts:34-53 (levels 0–4, distinct copy); product-signoffs OQ-008 'capability profile = breakdown of the existing band, NOT a new/third scoring system'.
- **Why users want it:** A single legible score is appealing, but the founder specifically rejected score-first framing and forbids a competing ladder; TCI would re-introduce both.
- **What has to change:** Do NOT adopt a new hero score or a fourth level ladder. Reuse the existing maturity levels (maturity-glossary) and render capability as a breakdown of the one band (per OQ-008). Reconcile TCI's inactive→expert names to the shipped level copy rather than adding a parallel scale.
- **Data & metric logic:** Existing engine produces directional/measured mastery + a modeled maturity level; no separate 0–100 capability score should be minted.
- **Backend/API & UI impact:** Shared UI components (CapabilityScoreCard) must map to existing levels, not a new enum.
- **Dependencies & migrations:** product-signoffs OQ-008 (ratified).
- **Tests & acceptance:** Acceptance: no fourth level enum introduced; capability copy sourced from maturity-glossary/capability-glossary.

### TCI-DOC-014 — Repositioning to a manager-first platform crosses individual-first VIS-001

**Conflicting** · effort S · priority P2 · risk medium

> TCI repositions Revealyst as an 'AI Capability Intelligence and Growth Platform' with a manager-facing pitch. *(TCI §1 / §17)*

- **What exists today (evidence):** TCI: tci.md:2289 'positioned as an AI Capability Intelligence and Growth Platform', tci.md:5 'Primary users: Team managers ...'. Founder-signed opposite: docs/product/requirements.csv:VIS-001 'individual-first Personal AI Companion; team/exec intelligence is a by-product surface, never the individual pitch'; CLAUDE.md 'bottom-up Personal AI Companion whose individual signal compounds into ... intelligence CTOs pay for'; onboarding is companion-pitch-first.
- **Why users want it:** The manager buyer funds the product, but the signed thesis is that individual value must lead or the compounding bottom-up signal never forms.
- **What has to change:** Partially adopt: TCI's §17 hierarchy (individual → team → operational) actually agrees that 'individual growth remains the foundation' (tci.md:2319) — keep that. Reject the front-matter framing that makes managers the primary pitch. Positioning changes require a founder signoffs row.
- **Backend/API & UI impact:** Copy/positioning only, but load-bearing for the whole product narrative.
- **Dependencies & migrations:** Founder decision (VIS-001 is signed direction).
- **Tests & acceptance:** Acceptance: individual companion remains the primary onboarding pitch.

### TCI-DOC-015 — Record the orchestrator conflict-resolution rule

**Missing** · effort S · priority P0 · risk low · quick win

> The rule that conflicts resolve toward TCI only where TCI does not cross a founder-signed decision or named gate must be written down as the governing resolution rule for this analysis. *(TCI whole-document)*

- **What exists today (evidence):** The rule is stated only in this task's orchestration prompt; it has no repo home. It must sit beside the analysis (docs/product/tci/ narrative + a note in docs/product-signoffs.md) so future readers apply it consistently. Precedent: docs/product-signoffs.md 'Notes' section already documents how default/pending/ratified rows behave.
- **Why users want it:** Anyone reading the TCI analysis later knows the tie-break: founder-signed decisions win, TCI wins only in the open space.
- **What has to change:** Add a short 'Resolution rule' paragraph to the TCI gap-analysis narrative and a note in product-signoffs.md. Enumerate the signed decisions that override TCI (self-view-only, count-only/MIN_PEOPLE, no prompt-content, W6-A gate, OQ-003/004 role gate, minimal-nav/D4, no-competing-ladder/OQ-008, VIS-001).
- **Backend/API & UI impact:** Docs-only.
- **Tests & acceptance:** N/A. Acceptance: the rule appears in the analysis doc and the ledger.
