# Revealyst — UI/UX Execution Plan (post-W9 screen architecture)

**Status:** Draft for founder review — this plan proposes IA changes that need §6 decisions
before build starts. **Date:** 2026-07-16. **No migration, no ADR expected** — every task in
this plan is UI, copy, navigation, or read-path composition; no schema, `org-scope.ts`,
contract, or fixture change. (If any task drifts into a frozen path, it stops and files an ADR
per rule 1.)

**Status (2026-07-16, docs-sync pass):** U0–U3 shipped and merged (PRs #244–#247); U4 (team
narrative hero + workspace-setup stepper) is built on `ui-u4-main` with PR #248 open for
review, not yet merged; U5 (responsive/a11y hardening) has not started. One exception to the
"no ADR expected" line above: U0.3's RecommendationCard undo needed **ADR 0043** (a `cleared`
API action on the closed-enum `rec_interaction_state` seam) — no schema/migration change, so
the frozen-contracts guard still fired correctly. §8 deferred/gated ledger is unchanged.

> Sources of truth, in order: (1) [Product Spec V4](Revealyst_Product_Spec_V4.md) — hard
> constraints (NOT-list, privacy invariants, gates) always win; (2) the founder's UI/UX
> research report ("Revealyst vNext Product Specification for an AI Growth Companion",
> 2026-07-16 deep-research, on file outside the repo) — the UX direction this plan implements;
> (3) current code — the factual baseline. Where (1) and (2) conflict, §1 records the
> resolution and the assumption. UX analysis was cross-checked against WCAG 2.2 / HIG /
> Material guidance (ui-ux-pro rulebook).

---

## 0. Plan-on-a-page

The research report specifies an eight-screen architecture. Mapped against the shipped app:

| Proposed screen | Current counterpart | Verdict | Plan |
|---|---|---|---|
| Today | `personal-self-view.tsx` card stack inside `/dashboard` | Exists as a fragment | **U1** — split into a habit-first Today surface |
| Growth | Same card stack (capability/mission/milestone cluster) | Exists as a fragment | **U1** — own route `/growth` |
| Team | `team-overview.tsx` (5-card fold) | Close match | **U4** — narrative-first polish only |
| Playbooks | `/playbook` (one static page, orphaned from nav) | No backend, concept unspecced | **§1-R2** — not built; fold/relink the orphan |
| Connections | `/connections` | Direct match | **U2** — trust/coverage upgrades |
| Match accounts | `/reconcile` (already labeled "Match accounts") | Direct match | **U2** — impact-forward framing |
| Settings + Billing | `/settings` + `/account` + `/billing` (three routes) | Split three ways | **U3** — consolidate under `/settings/*` |
| Workspace setup | `/onboarding` (pitch → connect) | Partial | **U4** — stepper, scope explainer, invites |

Overlay surfaces the report proposes — command palette, in-app AI assistant, notification
center — are **not** in this plan (§1 records why; §8 holds the deferred ledger).

Phases: **U0** shared primitives + nav IA → **U1** Today/Growth split → **U2** Connections +
Match accounts → **U3** Settings consolidation → **U4** Team + Workspace setup polish →
**U5** responsive/a11y hardening. U2 and U3 parallelize after U0; U1 is the critical path.

---

## 1. Conflict resolutions and recorded assumptions

Each resolution follows the priority order above. "R" items are binding for every task below.

**R1 — In-app AI assistant: rejected.** The report proposes a global "Ask Revealyst"
assistant on every screen. Spec V4 §11.5 explicitly bans an "Ask AI" NL-query chat surface
(superseded by the read-only MCP-server bet, Future/gated) and §8.2 bans LLM-generated
coaching text (G6). The report itself says the assistant must not become "a generic 'ask
anything' analytics clone" — the intent behind its assistant rows (explain this page, explain
this score, explain what's missing) is already served by deterministic, template-based
affordances: `InfoTip`, the Data Confidence card + drawer, the coaching "why this" line
(`dominantUtilityTerm`), and the curriculum drawer. **Resolution:** every "AI experience" row
in the report maps to extending those explainability affordances, never to a chat/composer
surface. No `assistant` component, route, or endpoint appears in this plan.

**R2 — Playbooks screen: not built.** The report wants a top-level workflow library. V4 has
no playbooks entity (§6.4's only structured-challenge primitive is Missions; the capability
rows carry inert `playbook`/`learningPath` prose columns; NOT-019 bans an LMS/course layer,
and the LMS-vocabulary banned-phrasing sweep is CI-enforced). The shipped `/playbook` route is
a single static shared-account-remediation guide, orphaned from nav. **Resolution:** no
Playbooks nav item. The sanctioned equivalents — Missions and the static capability
curriculum — get first-class placement on the Growth screen (U1.3). `/playbook` is relinked
where it is contextually useful (Match accounts, Connections shared-account warnings) and
retitled to say what it is (a guide, not a library). A config-driven playbook library goes to
the §8 Future ledger, gated on founder sign-off + real authoring demand.

**R3 — Notification center: not built.** Spec is silent on an in-app inbox; no notification
store exists; the shipped delivery channels are the four email lanes plus computed-at-render
attention items. Adding a persisted inbox is net-new scope with a new org-scoped table (three
registrations + ADR). **Resolution:** deferred to §8. The report's underlying needs are met
in place: sync failures badge on Connections (U2.1), budget/staleness/attention banners stay
inline, and the digest remains the canonical "what changed" channel.

**R4 — Command palette: deferred.** Spec is silent; `cmdk` is deliberately not a dependency
(documentation-plan.md). With six nav items the palette's value is marginal; keyboard
shortcuts without it would be bespoke. **Resolution:** §8 Future ledger, revisit if nav depth
grows. The report's per-screen `g x` shortcuts are deferred with it.

**R5 — Role model: current enum wins.** The report assumes six roles (Personal, Member,
Manager, Admin, Billing admin, Owner). The schema has org roles `admin | member` plus a
global platform admin, and a *separate* skill-targeting `roles`/`role_assignments` entity
(never a permission). **Resolution:** the report's "Manager/Admin/Owner/Billing admin" all
map to org `admin`; "Member" maps to `member`; Personal mode is an org of one. No new
permission roles are introduced. Screen specs below use only `admin`/`member`/personal.

**R6 — Today/Growth split vs §12.1 consolidation.** V4 §12.1 consolidates the product to
three surfaces + Settings; the report splits the personal surface into Today (habit) and
Growth (improvement). These are compatible — the split is a decomposition of the one
Personal Companion surface, not a new product surface — but it reverses some of the W5
"one card, not a dashboard" instinct, so it is **founder decision D-U1 (§6)** before build.
The plan is written so U1 is skippable without orphaning any other phase.

**R7 — Companion-in-team-orgs stays gated.** The report's "Today for everyone" assumes team
members get a self view. That is exactly W6-A/T5.1, gated on the §14 dogfood outcome (clock
since 2026-07-14). **Resolution:** Today/Growth ship for personal orgs now; the nav is
structured so the same routes activate for team members when T5.1 clears its gate. Nothing in
this plan builds ahead of that gate.

**R8 — Identity merge/split: not supported by the backend.** The report's Match accounts spec
includes person-to-person merge, split, and 7-day undo. The shipped machinery is subject↔person
`link / create_and_link / unlink / assign_team` only. **Resolution:** U2.4 reframes the
existing queue (impact summary, evidence lines, suggested matches from `proposeEmailMatches`)
without inventing merge. Merge/undo goes to §8 (needs its own design + likely ADR).

**R9 — Benchmarks: shipped three-tier honesty stands.** The report's benchmark overlays map
to the existing own-history panel + within-org distribution (floored) + the `draft` modeled
fixture. No new benchmark UI beyond placement polish; nothing may label a modeled norm
"verified" (§7.2).

**R10 — Routes: keep `/dashboard`, relabel nav.** The report proposes `/today`. The simplest
solution meeting the requirement is relabeling the nav item ("Today") while `/dashboard`
remains the route (bookmarks, digest CTAs, tests, and the §14 `companion_revisit` metric all
point at it). `/growth` is genuinely new so it gets a real route. Recorded as an assumption;
a rename-with-redirect can ride any later wave if the founder prefers the URL to match.

**R11 — Web-Vitals targets are budgets, not gates.** The report's LCP ≤2.5s / INP ≤200ms /
CLS ≤0.1 (p75) are adopted as budgets. Honestly: authenticated TTFB is dominated by the
~500–670ms per-round-trip DB floor (W4 measurement); LCP compliance on authenticated pages is
not achievable by UI work alone and stays coupled to the founder-infra Neon-replica item. CLS
and INP are actionable now (skeletons reserve space; drawers/actions are already
transform/opacity).

**R12 — No streaks, no gamification, ever.** Several report rows ("momentum", "progress
ring", "recent wins timeline") could drift into streak/points territory. Every U1 task
inherits the anti-gamification sign-off: no XP/streak/league/points column *or copy*
(schema-shape + banned-phrasing tests stay green), progress is capability/mission-grounded
only, and the "weekly-with-forgiveness narrative only" decision stands.

---

## 2. Migrate / Deprecate / Remove / Retain

| Action | Item | Where it goes |
|---|---|---|
| Migrate | Growth card cluster (capability profile, missions, milestones, curriculum drawer) | `/growth` (U1.3) |
| Migrate | `/account` + `/billing` pages | `/settings/profile`, `/settings/billing` tabs (U3) |
| Migrate | `/members` page | `/settings/people` tab, with the existing roster cards (U3.3) |
| Deprecate | `/teams`, `/people` (already retired from nav) | Redirect to `/settings/people` once U3.3 lands; delete pages |
| Deprecate | `/playbook` as a pseudo-library | Retitle + relink contextually (R2); content unchanged |
| Remove | Duplicate `ConfidenceBadge` implementations (maturity + analytics variants as separate visual components) | Superseded by the unified `ConfidencePill` (U0.2) |
| Remove | Inline dashed-box empty-state idiom in companion cards | Superseded by `EmptyState` inline variant (U0.5) |
| Retain | `/maturity` report, `/spend`, `/indexes` (demoted, OQ-002 default), `/compliance`, `/methodology` | Unchanged; linked contextually |
| Retain | Five-card team fold, Data Confidence system, SyncTransparencyPanel, share cards, digest/email lanes | Unchanged surfaces this plan builds around |

---

## 3. Phased milestones & exit criteria

| Phase | Contents | Exit criteria |
|---|---|---|
| **U0** | Nav IA + shared primitives (ConfidencePill, RecommendationCard, Banner, ConnectorCard shell, EmptyState inline, theme toggle, bottom-sheet drawers on mobile) | All existing pages render byte-equivalent data with the new primitives; axe smokes green; no visual regression on the five team cards |
| **U1** | Today/Growth split (personal orgs) | `/dashboard` (Today) ≤7 blocks above the diagnostic expander; `/growth` live; combined query count across both routes ≤ current single-page count + 4, depth 1 (perf test); digest/dashboard rec parity test still green |
| **U2** | Connections trust upgrades + Match accounts framing | Every connector card states measures/can't-measure from registry-derived copy; reconcile shows impact summary + evidence; zero hard-coded vendor claims (sweep test) |
| **U3** | Settings consolidation | One `/settings/*` shell; old routes 308; paywall-exempt semantics preserved (existing prefixes still exempt); member vs admin tab gating tested |
| **U4** | Team polish + Workspace setup | Team page opens with narrative hero; onboarding has stepper + scope explainer + team invite step; time-to-first-insight flow unchanged or shorter |
| **U5** | Responsive + a11y hardening | 44px targets on all rec/mission/connector actions; axe smokes on every new route; focus-on-route-change; dark-mode contrast pass on semantic badges |

---

## 4. Critical path, parallelization, and implementation order

```
U0.1 nav IA decision (D-U1, D-U3 signed)  ──►  U1 Today/Growth  ──►  U5 hardening
        │
        ├──►  U0.2–U0.7 primitives (parallel, independently mergeable)
        │
        ├──►  U2 Connections + Match accounts   (parallel with U1)
        └──►  U3 Settings consolidation          (parallel with U1, after D-U3)
U4 Team + onboarding polish — after U0, anytime; lowest coupling
```

- **Critical path:** D-U1/D-U3 founder decisions → U0.1 → U1 → U5. Everything else hangs off
  U0 and parallelizes (rule 3: one workstream per agent, one PR chain per phase).
- **Serialize the builds** of U1 and U3 only where they touch the same files
  (`app-sidebar.tsx`, `(app)/layout.tsx`) — the W6 parallel-merge lesson applies even without
  migrations: land U0.1's nav shell first, then U1/U3 consume it.
- **Quick wins** (shippable this week, no decisions needed): U0.2 ConfidencePill, U0.4
  Banner, U0.5 EmptyState inline, U2.2 scope-explainer copy, U4.2 onboarding scope panel.
- **Blockers:** none external. D-U1/D-U3 are founder calls; W6-A gate only affects the
  team-member activation of U1's routes, not the build.

Recommended order: **U0 → (U1 ∥ U2 ∥ U3) → U4 → U5**, one PR chain per phase, review-then-PR
per the merge-race rule.

---

## 5. Screen specifications

Conventions for every screen: copy lives in a `src/lib/*-copy.ts` or glossary module and is
swept by `tests/helpers/banned-phrasing.ts` (+ the LMS-vocabulary sweep where relevant);
every card states why it is empty and what fills it (never a fabricated number — invariant
b); loading is skeleton-first via route `loading.tsx` (spinners only inside buttons); all
interactive targets ≥44×44px; drawers are `Sheet` (right on desktop, `side="bottom"` on
mobile after U0.7); dark mode via existing token system; reduced-motion already global.

### 5.1 Today — `/dashboard`, personal self-view (U1.1–U1.2)

**Purpose & target user.** The daily habit surface for an individual (personal org today;
team members post-T5.1). Answers *what changed, what matters, what should I do next* in one
screen-height. Success: the §14 pair (`digest_return` + `companion_revisit`) keeps
measuring returns to this route; first action reachable without scrolling on desktop.

**Current state & gaps.** `personal-self-view.tsx` renders ~16 blocks in one scroll:
attention, confidence, growth journey, milestone, nudge, coaching, capability profile,
mission, interim, diagnostic expander, agentic, spend line, benchmarks. Dashboard-itis is
re-forming inside the companion; the growth cluster (slow-moving) dilutes the daily cluster
(fresh); there is no single dominant action; the nav label is "Overview".

**Information hierarchy (top → bottom).**
1. Inline system banners (impersonation, budget alert, sync staleness) — only when true.
2. `AttentionSection` — alerts/early warnings only (unchanged).
3. **Hero:** `GrowthJourneyCard` — band/level + the one next step. The page's dominant action
   is this card's next-step CTA.
4. **Next best actions:** `CoachingCard` (max 2, weakest-first, "why this" + "Based on N
   connected sources" — all shipped) with snooze/dismiss/tried + a 10s undo toast (U1.2).
5. **Active mission strip:** `MissionCard` filtered to in-progress missions only; the full
   catalog moves to Growth. Link: "All missions →  /growth".
6. `DailyNudgeCard` (one fresh fact) + `DataConfidenceCard` side by side on desktop.
7. `DiagnosticDetails` expander — absorbs the raw score grid, `AgenticAdoptionCard`,
   `SpendGovernanceLine`, and the benchmarks/consent card (all currently top-level).

**Layout & component changes.** 12-col desktop: hero full-width; actions (col 1–7) +
mission/nudge/confidence rail (col 8–12); single column mobile with hero first. Component
changes: extract `RecommendationCard` (U0.3) for coaching items; move capability profile,
milestones, mission catalog, curriculum trigger to `/growth`; fold agentic/spend/benchmarks
into the expander. No new data-bearing component.

**User flows & interactions.** Entry: post-login redirect, digest CTA (unchanged — the
lane-aware CTA already lands here and fires both §14 metrics), direct nav. Primary: act on a
coaching rec (accept = follow its suggested action; snooze/dismiss/tried persist via
`POST /api/recommendations/interaction`), continue mission, expand diagnostics. Secondary:
open Data Confidence drawer, share score (`ShareScoreButton` stays in the header), jump to
Growth/Connections. Undo: after snooze/dismiss, a toast offers one-click revert (re-`set`
of `rec_interaction_state` — API already supports overwrite).

**States.** *Loading:* skeletons for hero + two action cards (reserve heights; CLS budget).
*Empty:* no usable connection → redirect `/onboarding` (unchanged); connected-but-no-scores →
`OnboardingInterim` (unchanged); no eligible recs → the shipped honest fallback ("nothing
needs attention") plus one measurement-improving suggestion when coverage < 2 sources.
*Error:* per-card `Alert`; route `error.tsx` added (none exists today). *Stale:*
`SyncStalenessBanner` + per-card `stale` flags (shipped). *Permissions:* personal/self only;
team members 404 here until T5.1.

**Metric explanations & beginner copy.** Level/band copy stays sourced from
`maturity-glossary`/`capability-glossary` (never a third ladder). Every rec keeps "why this"
+ time-to-value phrasing from the catalog. New copy: expander section intros ("These are the
raw numbers behind your journey — most people never need them"). All plain-English, no
"z-score/coverage weight" vocabulary outside the methodology page.

**Responsive & accessibility.** Single column ≤768px; rail stacks under actions; hero CTA
remains above the fold on 375px. Keyboard: cards in DOM order, focus visible, drawer focus
trap (shipped in `Sheet`). Axe smoke extended to the recomposed page. Undo toast is
`aria-live="polite"` and never the only path (rec rows keep their buttons).

**Reusable components.** Reuses: GrowthJourneyCard, CoachingCard→RecommendationCard,
MissionCard, DailyNudgeCard, DataConfidenceCard/Provider, DiagnosticDetails, banners. New:
none beyond U0 primitives.

**Backend/data dependencies.** None new. The page's flat `Promise.all` shrinks (capability
graph/curriculum reads move to `/growth`); exposure logging (`recommendation_exposure`)
stays on this route's render path; fatigue/novelty window semantics untouched (day-granular,
digest parity test must stay green).

**Performance.** Keep round-trip depth 1; extend
`tests/perf/authenticated-page-queries.test.ts` with a Today budget (≤ current count). Less
data per render than today (growth cluster gone).

**Tests & acceptance criteria.** Component tests for the recomposition order; axe smoke;
banned-phrasing on new copy; digest/dashboard shared-source parity green;
perf query-count budget; acceptance: ≤7 top-level blocks above the expander, one primary CTA,
undo works, `companion_revisit` still fires.

**Effort M · Risk medium** (touches the most-tested page; §14 metrics must not blink) ·
**Depends on** U0.1, U0.3, D-U1 · **Priority P1.**

### 5.2 Growth — `/growth` (new route, U1.3)

**Purpose & target user.** The improvement surface: where an individual understands their
capability decomposition and chooses what to get better at. Self-view only (same gating as
Today).

**Current state & gaps.** All content exists but is buried mid-scroll on the dashboard:
capability profile card, curriculum drawer, mission card, milestones. There is no place to
see the mission catalog, completed missions, or the full capability list at once.

**Information hierarchy.**
1. **Hero:** band headline — same `GrowthJourneyCard` data, framed as "where you are and
   what's next" (component reused with a `variant="growth"` that expands the level meaning
   from the glossary). Narrative ladder, not a score chart (report's "Explorer: broad usage,
   inconsistent repeat patterns" framing = exactly the shipped glossary copy).
2. **Capability profile:** `CapabilityProfileCard` promoted to full list (all 9 capabilities,
   not just strongest), each row: mastery band + confidence tier pill + last-evidence
   recency + "See how to grow this" → `CapabilityCurriculumDrawer`. Stays a flat list —
   no node graph (nothing to gain at 9 capabilities; OQ-008 decomposition framing).
3. **Missions:** active first, then available catalog (opt-in start via
   `POST /api/missions/start`), then completed timeline (`mission_progress.completedAt`).
4. **Milestones:** `MilestoneCard` timeline (grounded events only).

**Layout & component changes.** Desktop 7/5 split: capabilities left, missions/milestones
rail right; mobile stacks. Changes: `CapabilityProfileCard` gains a full-list mode;
`MissionCard` gains a catalog/completed grouping (still zero gamification vocabulary — the
existing regex test extends to this page).

**User flows & interactions.** Entry: Today hero CTA, nav, curriculum deep link. Primary:
open a capability drawer, start a mission. Secondary: expand raw mastery numbers (reuses
`DiagnosticDetails` pattern — one expander, not a second system). No share affordance here
(share cards stay score-based, shipped).

**States.** *Loading:* skeleton list + rail. *Empty (low evidence):* capability rows render
only when a state row exists (zero-evidence → no row, engine rule); page-level empty state
explains "not enough evidence yet" + which connector would add evidence (from
signal-coverage), never a fabricated bar. *Error:* route `error.tsx`. *Permissions:*
self-view only; admin sees their own, never anyone else's.

**Metric explanations & copy.** Mastery band + confidence tier vocabulary from
`capability-glossary` (`masteryBand`, `confidenceTierLabel`); `directional` vs `measured`
explained in one sentence with an InfoTip ("directional = early signal from one channel;
measured = confirmed by ≥2 independent markers"). Curriculum copy from
`capability-curriculum.ts` (already LMS-sweep-clean).

**Responsive & accessibility.** Rows are buttons (44px), drawer becomes bottom sheet on
mobile (U0.7); arrow-key row navigation optional, not required (hover never required —
shipped pattern). Axe smoke on the route.

**Reusable components.** GrowthJourneyCard, CapabilityProfileCard, CurriculumDrawer,
MissionCard, MilestoneCard, ConfidencePill (U0.2), EmptyState.

**Backend/data dependencies.** None new: `scope.capabilities`, `user_capability_state`
reads, mission catalog/progress, milestones — all shipped. The route gets its own flat
`Promise.all` (capability graph + states + missions + milestones + coverage), depth 1.

**Performance.** New perf budget entry (~6 queries). Long-cache candidates (capability
definitions) already served from seeded reference tables.

**Tests & acceptance.** Route renders all 9 capabilities for a fully-evidenced fixture and
zero rows + honest empty state for a fresh org; mission start round-trip; anti-gamification
regex over rendered page text; axe; perf budget. Acceptance: a user can explain their band,
pick a next capability, and start a mission without leaving the page.

**Effort M · Risk low-medium** (new route, existing data) · **Depends on** U1.1 (card moves),
U0.2 · **Priority P1** (ships with 5.1 as one phase).

### 5.3 Team — `/dashboard`, team overview (U4.1)

**Purpose & target user.** Org admins ("managers" per R5): where is the team strong/stuck,
what improved, what is one safe enablement action — without surveillance. The five-card fold
(health / maturity / training / distribution / data trust) already implements the report's
"three summary cards + heatmap + table" intent under stricter privacy rules.

**Current state & gaps.** Solid data surface; gaps are editorial: the page opens with score
cards rather than a narrative diagnosis; `PeriodNarrativeCard` (the shipped narrative-insight
card) sits inside section (a) instead of leading; no compare-period control (window is
fixed); below-floor suppressions are silent in places rather than explained.

**Information hierarchy.** 1) banners/attention (unchanged) → 2) **narrative hero**:
`PeriodNarrativeCard` promoted above the fold, with its "suggested next action" line
(existing training-opportunity verdict) rendered as the page's single CTA → 3) the five
cards in current order → 4) setup section (unchanged pending U3.3).

**Layout & component changes.** Promote narrative card; add a floor-explanation banner
pattern: wherever `SEGMENT_MIN_PEOPLE_TO_NAME`/`MIN_PEOPLE_FOR_DISTRIBUTION` drops a
row/panel, the section states "shown only for groups of 4+ people to protect individuals"
(one shared copy string in `team-overview-copy.ts`) instead of the panel silently missing.
Everything else retained.

**User flows & interactions.** Entry: nav, digest (team lane), exec-memo link. Primary: read
diagnosis → follow the one enablement CTA (training section). Secondary: CSV board export
(shipped), maturity report, drill into collapsible usage detail. No new filters in this
phase; team/tool pivots go to §8 (needs derived aggregates with floors — design first).

**States.** *Loading:* card skeletons (shipped). *Empty:* no connectors → `EmptyState`;
connected-no-scores → `OnboardingInterim` (shipped). *Privacy:* floor-explanation copy (new);
`assertTeamOnlyPseudonymized` keeps running at read end. *Error/stale:* unchanged banners.

**Metric explanations & copy.** Already glossary-driven; add the floor explanation and a
one-line intro under each of the five section headers (plain English, e.g. "How consistently
your team uses AI tools, from your connected sources only").

**Responsive & accessibility.** Five sections stack on mobile; heatmap already has the
text-summary fallback; tables convert acceptably (few, small). Axe smoke added for the team
page (currently only companion cards are covered).

**Reusable components.** PeriodNarrativeCard, ScoreCard, ConfidencePill (replaces the two
badge variants here), MaturityExportButton, CapabilityCoverageCard, DataTrustCard.

**Backend/data.** None new — `readDashboardView` already returns everything, including
`capabilityCoverage` and `narrative`.

**Performance.** No query change; hero promotion is reorder-only.

**Tests & acceptance.** Reorder snapshot test; floor-copy renders when a fixture sits below
the floor; pseudonymization predicate still green; axe. Acceptance: an admin reading only the
hero + one CTA can state the team's priority problem and next action.

**Effort S · Risk low · Depends on** U0.2 · **Priority P4.**

### 5.4 Playbooks — resolution, not a screen (R2)

Not built. Deliverables that replace it: (a) Growth's mission catalog + curriculum placement
(5.2); (b) `/playbook` retitled "Shared-account migration guide" with nav orphan resolved by
contextual links from Match accounts and the shared-account warnings on Team/Connections;
(c) §8 Future entry for a config-driven library (needs founder sign-off, authoring demand,
and an anti-LMS design review). Acceptance: no dead orphan route; no nav item; LMS sweep
stays green. **Effort XS · Priority P2 (rides U2).**

### 5.5 Connections — `/connections` (U2.1–U2.3)

**Purpose & target user.** Make data trust visible: what is connected, what each source can
and cannot measure, whether sync is healthy, and what would most improve coverage. Everyone
can view; admins/personal users manage.

**Current state & gaps.** Functional but utilitarian: a connections table + polled/local
sections + transparency panel. Gaps: no coverage summary; "what this source can/can't
measure" lives in docs (`connector-facts.md`) and the legal page, not on the card; status
vocabulary is binary healthy/error (no "limited" state for honesty-gapped sources); available
vendors are a flat list with no "best next" guidance; non-admin members see a table they
cannot act on with no explanation.

**Information hierarchy.** 1) header: title + coverage summary line ("3 sources connected ·
covering N of M people" — both counts from shipped `signal-coverage`/`identities` data, never
a percentage without a denominator) + Connect button → 2) connected cards grid (status-first)
→ 3) available connectors: one "best next" card + accordion of others → 4) sync timeline +
`SyncTransparencyPanel` (shipped) → 5) unresolved issues list (failed runs from
`connector_runs.lastError` + expiring renewal dates).

**Layout & component changes.** New `ConnectorCard` shell (U0.6) unifying the table rows,
`SyncAgentCard`, and `GithubAppConnectCard` presentation: vendor, status badge, "measures /
doesn't measure" two-line summary, last sync, one action. `SyncStatusBadge` gains a `limited`
state (rendered when the latest run carries honesty gaps) — text + icon, never color-only,
and never "green = all good" when gaps exist. Scope drawer per card: full measures/can't
list + link to `/legal/what-we-collect`.

**Registry-derived claims (hard rule).** The measures/can't-measure copy is a new
`scopeClaims` field on each connector's registry entry (`src/connectors/registry.ts`
consumers stay untouched; the field is additive per-vendor module) so cards derive from the
registry like the landing page does — never hard-coded prose (W3-N/W3-P rule). A sweep test
asserts every registered vendor has claims and no page hard-codes vendor capability strings.
"Best next" is deterministic and honest: recommend the agent when absent, else the first
registered-but-unconnected vendor; label gated vendors "Not yet available" exactly as the
landing page does (`NLV_PENDING_VENDORS`).

**User flows & interactions.** Connect (dialog, shipped), reconnect/pause/resume/delete (row
actions, shipped), manual sync (shipped; reward line stays), enter renewal date (shipped),
open scope drawer (new), jump to Match accounts when unresolved subjects exist (count badge
from reconcile view data). Members: read-only cards + "Ask your admin to connect
sources" empty-state copy instead of disabled controls.

**States.** *Loading:* card shimmer (extend `TableSkeleton` to a card variant). *Empty:*
first-run — reuse onboarding connect components inline. *Error:* auth-expired card state with
the real error in a tooltip (shipped) + a "Reconnect" primary action. *Limited:* new badge +
explanation ("This connection works, but can't measure per-person usage on your plan" — from
scope claims + honesty gaps). *Stale:* per-card last-sync + the existing staleness rules
(`SYNC_STALE_AFTER_DAYS` single source).

**Metric explanations & copy.** All jargon translated: "insufficient scopes" never appears;
gap kinds already have `HONESTY_GAP_GLOSSARY` labels — reuse. New `connector-scope` copy per
vendor as above.

**Responsive & accessibility.** Cards stack on mobile; status conveyed by text+icon; sync
timeline rows are readable list items; drawer → bottom sheet on mobile. Axe smoke.

**Reusable components.** ConnectorCard (new shell), SyncStatusBadge (+limited),
SyncTransparencyPanel, AddConnectionDialog, EmptyState, Sheet.

**Backend/data.** None new: `connections`, `connector_runs` (gaps live in its jsonb),
signal-coverage, renewal dates — all shipped. The unresolved-issues list is a render-time
derivation from data the page already loads.

**Performance.** Same reads; the page already batches. Registry claims are static imports.

**Tests & acceptance.** Registry-claims completeness sweep; limited-badge rendering from a
gapped fixture; member read-only rendering; axe. Acceptance: a user can answer "what can
Revealyst see from this tool, and what can't it" without leaving the page.

**Effort M · Risk low · Depends on** U0.6 · **Priority P2.**

### 5.6 Match accounts — `/reconcile` (U2.4)

**Purpose & target user.** Admin-only identity resolution: link vendor subjects to people,
flag shared accounts, and understand what resolving does to data quality. The report's core
insight — "this cannot feel like data janitorial labor; show outcome impact upfront" — is the
whole task.

**Current state & gaps.** Fully backed (`buildReconcileView`, link/create/unlink/assign,
confidence badges, shared-account flags) but framed as a bare table; no impact statement; no
evidence display for why a match is suggested; email-match suggestions
(`proposeEmailMatches`) exist in the backend but surface weakly; first-time admins get no
explanation of person vs account-level attribution.

**Information hierarchy.** 1) header: unresolved count + **impact summary** — "Resolving
these N accounts links data for K more people" and, when computable from the shipped
attribution mix, "person-level coverage rises from A of B people to C of B" (counts, not
invented percentages; derived from subjects-with/without person links already in the view) →
2) first-visit explainer (collapsible after first dismissal): person vs key/project vs
account attribution in three plain sentences (from `ATTRIBUTION_GLOSSARY`) → 3) suggestion
rows: unresolved subjects sorted by activity (shipped), each with candidate person, confidence
word+number ("High 0.92" — words never color-alone), and an evidence line ("email matches
j.doe@…"; "active on the same days as…" only if the heuristic actually uses it — evidence
copy derives from the heuristic's reasons enum, never invented) → 4) resolved list + shared
account flags (shipped) → 5) link to the migration guide (`/playbook`, retitled).

**Layout & component changes.** Extract the row into `IdentityMatchRow` (currently inline
table markup): subject, evidence, confidence, action menu (Link / Create person / Mark
shared via existing flags / Ignore-leave-unresolved). "Leave unresolved" is the explicit
default per the report — no auto-merge, ever. Mobile: rows → stacked cards; evidence in a
bottom sheet.

**User flows & interactions.** Entry: nav, Connections badge, Team data-trust card link.
Primary: accept a suggested link (one click when a suggestion exists), or open the dialog
(shipped) to pick/create. Secondary: unlink (shipped — covers wrong links; there is no
person-merge, R8), assign team. Undo: unlink is the inverse of link and is offered in the
success toast.

**States.** *Empty:* "All accounts are matched" + what would create new work (a new
connector). *Loading:* row skeletons (shipped). *Error:* action failure toast with retry;
concurrent-edit conflicts surface as "this subject was just updated — refresh" (409 from the
action route). *Permissions:* admin-only (shipped); personal orgs: page explains there is
nothing to match with one connector-one person.

**Metric explanations & copy.** Attribution ladder in plain English; confidence words
(high/medium/low) already mapped; impact copy counts-only.

**Responsive & accessibility.** Keyboard: rows reachable, dialog focus-trapped (shipped);
multiselect/bulk deferred (§8). Axe smoke.

**Reusable components.** IdentityMatchRow (new), ConfidencePill (U0.2),
ReconcileSubjectDialog, UnlinkIdentityButton, EmptyState.

**Backend/data.** None new. Impact summary and evidence lines derive from `buildReconcileView`
+ `proposeEmailMatches` (both shipped, pure). If evidence reasons need one more field in the
view model, it is a pure read-path addition.

**Performance.** Unchanged reads; suggestions computed in-memory.

**Tests & acceptance.** Impact-summary arithmetic from fixtures (counts match view data);
evidence line renders only reasons the resolver actually produced; accept-suggestion round
trip; axe. Acceptance: an admin understands *why* to resolve before seeing the first row.

**Effort S–M · Risk low · Depends on** U0.2 · **Priority P2.**

### 5.7 Settings & Billing — `/settings/*` (U3)

**Purpose & target user.** One control surface: profile, workspace, privacy, notifications,
billing, people/roles, help/legal. Members manage self; admins manage workspace; nobody hunts
across three routes.

**Current state & gaps.** Split across `/settings` (admin, one long page), `/account`
(profile/password/delete), `/billing` (plan/usage). Costs: members have a nav item
("Account") disconnected from workspace context; billing lives outside the paywall-exempt
prefixes only by its own route handling; digest/exec-memo prefs (the only notification
controls) are buried mid-page; there is no per-org audit UI (route exists, "No UI in V1" —
retained as-is, §8).

**Information hierarchy / layout.** Nested routes under `/settings` with a left tab rail
(desktop) / top selector list (mobile) — **routes, not client tabs** (deep-linkable, no
`tabs.tsx` primitive needed):

| Tab | Route | Contents (all existing components) | Visible to |
|---|---|---|---|
| Profile | `/settings/profile` | AccountProfileForm, ChangePasswordForm, DeleteAccountDialog (danger zone last, visually separated) | everyone |
| Workspace | `/settings/workspace` | WorkspaceNameForm; org id copy affordance | admin |
| Privacy & visibility | `/settings/privacy` | VisibilityModeControl (+ link to `/compliance`), BenchmarkConsentToggle (moves here from the dashboard benchmarks card) | admin |
| Notifications | `/settings/notifications` | DigestPreferencesForm (self), ExecReportPreferencesForm (admin block) | everyone (admin sees more) |
| People & roles | `/settings/people` | TeamManagementCard, RoleManagementCard, members list + InviteMemberDialog (from `/members`) | admin |
| Billing | `/settings/billing` | Plan summary, tracked-user usage vs `FREE_TRACKED_USER_LIMIT`, UpgradeButton (Paddle overlay), ManageSubscriptionButton (portal = invoices/payment method) | admin |
| Advanced | `/settings/advanced` | Custom-indexes link card (OQ-002 demoted home), legal/DPA links footer | admin |

**User flows & interactions.** Entry: nav (single "Settings" item replaces
Account+Billing+Settings trio), upgrade CTA (`UpgradePaywall` → `/settings/billing`), digest
footer settings link. Old routes 308 to their tabs. Saving stays per-form inline (shipped
pattern — no global save bar); every consequence-bearing control keeps its inline impact note
(visibility control already does this; benchmark consent copy moves with the toggle).

**States.** Tab-level skeletons only (never full-screen block); billing shows honest "billing
unavailable" if Paddle errors, with existing data still readable; permission: member hitting
an admin tab gets an in-place explanation, not a hidden tab with no trace (report + MD
`empty-nav-state` rule) — member rail simply shows fewer tabs, and deep links render the
explanation. Payment failure: banner on the billing tab only (red reserved for
billing/security failures).

**Metric explanations & copy.** Free band, price, and promo all render from
`src/lib/pricing.ts` / `FREE_TRACKED_USER_LIMIT` constants (single-source rule); "tracked
user" gets its one-sentence plain definition next to the usage meter (from the frozen
contract's language: someone with activity in the period; unresolved accounts are never
billed).

**Responsive & accessibility.** Rail → top list on mobile; forms keep visible labels, inline
validation on blur, autofocus first invalid on submit error; redundant-entry avoided (profile
fields prefill). `aria-current` on the active tab; consistent Help/legal placement in the
Advanced tab footer.

**Reusable components.** All existing settings/account/billing components move; new:
`SettingsShell` (rail layout) only.

**Backend/data.** None new — all routes/APIs exist. **Paywall invariant:** the exemption
today is prefix-based (`/account`, `/settings`); consolidation under `/settings/*` keeps
account management and billing reachable over the free band automatically, and the six
`allowOverFreeBand` API routes are untouched. A test pins that `/settings/billing` and
`/settings/profile` render for an over-band org.

**Performance.** Per-tab pages read only their tab's data (smaller than today's single
settings page); depth 1 each.

**Tests & acceptance.** Redirect tests for the three old routes; member/admin tab-gating
tests; over-band reachability test; axe per tab; banned-phrasing on new copy. Acceptance: a
member can find digest settings in ≤2 clicks; an over-band admin can reach billing.

**Effort M–L · Risk medium** (route churn; paywall semantics; many small components move) ·
**Depends on** U0.1, D-U3 · **Priority P3.**

### 5.8 Workspace setup — `/onboarding` (U4.2)

**Purpose & target user.** Remove setup anxiety; first useful insight fast (the <10-minute
target is already the spec's success criterion). Individual (personal) and admin (team) both
land here.

**Current state & gaps.** Two-step (companion pitch → connect wizard) with honest "when
you'll see scores" interim. Gaps: no progress indication; scope explanation lives a click
away (`/legal/what-we-collect`) instead of beside the connect cards; team admins get no
privacy-mode moment or invite step during setup (both live in Settings only); returning users
re-enter at the top rather than at their unresolved step.

**Information hierarchy / flow.** Stepper (3 steps personal, 4 team — minimal header, save
state derivable so it is resumable without new storage):
1. **Meet your companion** (pitch, shipped) — skippable.
2. **Connect a source** (wizard, shipped) + inline **scope explainer** per connector card:
   "what we read / what we never read", derived from `agent-collection-schema.ts` (agent) and
   the U2 registry scope claims (vendors) — the same sources as the transparency panel, so
   copy cannot drift.
3. *(team only)* **Privacy & people:** visibility-mode selector (default private, one
   sentence per mode from `visibility-playbook.ts`) + optional invite emails
   (`POST /api/org/invites`, shipped). Both skippable; both re-enterable from Settings.
4. **What you'll see** → CTA to Today. Resume: entering `/onboarding` with a usable
   connection jumps to the last incomplete step (derived from connection/invite state, no new
   flag column).

**States.** OAuth/key failure inline per card (shipped pattern); gated vendors labeled "not
yet available" (never implied user error); plan-gate honesty ("this source needs a vendor
Enterprise plan") from scope claims; loading: connect-handshake spinners in-button, baseline
"interim" state after first sync (shipped).

**Copy & a11y.** Plain-English throughout ("we read counts and timing, never your prompts");
stepper is a `nav` with `aria-current="step"`; all auth flows remain
password-manager/passkey-friendly (Better Auth, no cognitive puzzles); Enter advances, Esc
closes dialogs.

**Reusable components.** OnboardingCompanionPitch, OnboardingWizard cards, SyncAgentCard,
GithubAppConnectCard, new `SetupStepper` (small), scope-claims snippets shared with U2.

**Backend/data.** None new (invites API exists; resume state derived). **Performance:** the
connect step keeps its current polling behavior; no new reads.

**Tests & acceptance.** Stepper resume derivation from fixtures (no connection → step 2;
connected team org, no invites → step 3); scope copy sourced from schema/registry (sweep);
axe on each step. Acceptance: a new team admin reaches Today with one connector, a chosen
visibility mode, and ≥0 invites in one sitting.

**Effort M · Risk low · Depends on** U2.2 scope claims · **Priority P4.**

---

## 5.9 Shared workstream U0 — navigation & design-system changes

**U0.1 Nav IA (S).** Personal orgs: **Today** (`/dashboard`), **Growth** (`/growth`),
**Connections**, **Settings**. Team orgs add: **Team** (`/dashboard` team view), **Match
accounts**, **Spend**, and keep **AI maturity**; Administration group collapses to Team-
specific items once Settings absorbs Members/Billing (U3). Badges: Connections nav item gets
a count badge for sync failures + expiring renewals (data already loaded by the shell's
layout? — no: badge derives from a single cheap `connections` read the sidebar layout already
has access to via its org context; if it would add a query stage, ship without the badge).
"Team-risk"/"unread" badges from the report are **not** adopted (no inbox, R3). Help stays
where it is (contextual pages + InfoTips); a persistent Help nav entry goes to §6 D-U6.

**U0.2 ConfidencePill (S).** One primitive replacing `maturity/confidence-badge.tsx`,
`analytics/confidence-badge.tsx` visuals, and aligning with `MetricQualifier`: props
`{tier | label, detail?, asOf?}`, text+icon (never color-only), tier vocabularies stay
sourced from their existing glossaries (the two vocabularies are deliberate — this unifies
the *component*, not the copy).

**U0.3 RecommendationCard (S).** Extract `CoachingCard`'s inline `<li>` into a component:
title, "why this", confidence line, suggested action, interaction buttons + undo toast.
Digest HTML rendering is unaffected (separate template) — the shared-source parity test
pins selection, not markup.

**U0.4 Banner (S).** One `Banner` primitive (on `Alert`) consumed by SyncStalenessBanner,
BudgetAlertBanner, ImpersonationBanner, and U4.1's floor-explanation — consistent placement
(top of content), tone mapping, and dismissal rules (system banners not dismissible).

**U0.5 EmptyState inline variant (XS).** Fold the dashed-box idiom in companion cards into
`EmptyState` (`variant="inline"`); keeps the honesty rule in one place.

**U0.6 ConnectorCard shell (M).** Shared presentation for agent/GitHub-App/key vendors
(5.5); the two existing cards become content plugged into the shell.

**U0.7 Mobile drawer = bottom sheet (S).** `Sheet side="bottom"` (variant exists, unused)
for Data Confidence, curriculum, and new drawers below the mobile breakpoint; full-height
with drag-free explicit close (Esc/button — no gesture-only dismissal).

**U0.8 Theme toggle (S).** Dark tokens exist; `next-themes` is wired (sonner reads it) but
there is no user-facing switcher. Add a three-state (system/light/dark) toggle in the sidebar
footer; then a dark-mode contrast pass over semantic badges/status colors (U5 checklist).

**Cross-screen consistency issues this fixes:** three confidence-badge variants; two
empty-state idioms; three bespoke banners; `ring-1` vs `border` on new surfaces (rule: cards
and dialogs use `ring`, everything else `border` — documented in a short
`src/components/README.md`); "Overview" label vs companion identity; spend line rendered
differently on personal vs team (both use `SpendGovernanceLine` after U1).

**Obsolete after this plan:** `/teams` + `/people` pages (redirect then delete, U3.3);
duplicate confidence badges; the orphaned `/playbook` nav status; the benchmarks card's
placement on Today (moves into diagnostics + consent to Settings/privacy).

**Charts:** stay hand-rolled (sparkline, heatmap, meters) — the report's restrained chart
language (line/bar/heatmap/bullet/sparkline + one-sentence takeaway) matches what exists; no
chart library is introduced.

---

## 6. Founder decision ledger (record outcomes in docs/product-signoffs.md)

| # | Decision | Default if unratified |
|---|---|---|
| D-U1 | Approve the Today/Growth split of the personal companion (R6) — it decomposes the §12.1 Personal surface into two routes | Proceed (plan's central bet); skippable without breaking U0/U2–U5 |
| D-U2 | Nav label "Today" for `/dashboard` personal view (route unchanged, R10) | Proceed |
| D-U3 | Settings consolidation incl. folding `/members`, `/account`, `/billing` (U3) | Proceed; old routes redirect |
| D-U4 | Bottom navigation on mobile (report mandates; current sheet-sidebar is compliant) | **Not adopted** — sheet sidebar + `SidebarTrigger` stays; revisit with real mobile-usage data |
| D-U5 | Benchmark consent toggle moves to Settings → Privacy | Proceed |
| D-U6 | Persistent Help entry in the shell (report wants same-place help everywhere) | Not adopted this wave; InfoTips + contextual pages remain |
| D-U7 | Playbooks future direction (R2) | Future ledger only |

**Founder ratifications (2026-07-16, recorded in `docs/product-signoffs.md`)** that bear on
this plan: **D4** — "decide per the deep-research report" → the report's fewer/bigger-cards,
progressive-disclosure, one-dominant-action direction is adopted, which is exactly what **U1**
(Today/Growth consolidation) executes. **OQ-008** confirmed — the capability-profile card is a
**breakdown of the existing band, not a new ladder**, so §5.2's decomposition framing stands
unchanged. **D9** — the spec makes **no** formal mobile / WCAG 2.1 AA promise, so **R11**
(web-vitals + a11y are internal budgets, not a contractual claim) holds; a11y work in **U5**
proceeds as engineering practice, not a published guarantee. **D10** — light-mode text is
darkened (shipped separately), advancing the **U0.8 / U5** contrast pass. None of these change
a task above; they ratify the direction this plan already took.

## 7. Documentation updates riding each phase

Spec V4 §12.1 gains a sentence when U1 ships (Personal Companion = Today + Growth routes);
`docs/product/` requirements registry rows for the touched screens; `AGENTS.md` nav facts
resync; CLAUDE.md wave banner per merged phase (`/revise-claude-md`).

## 8. Deferred / gated ledger (never calendar-scheduled)

| Item | Gate |
|---|---|
| Today/Growth for team-org members | T5.1 / W6-A dogfood outcome (clock since 2026-07-14) |
| Command palette (+ `g x` shortcuts) | Founder demand + nav depth growth (R4) |
| In-app notification inbox | Founder sign-off + new org-scoped table (ADR, 3 registrations) (R3) |
| Playbook library (config-driven) | D-U7 + authoring demand + anti-LMS design review (R2) |
| Person-to-person identity merge + 7-day undo | Design + ADR; current link/unlink covers known cases (R8) |
| Team/tool pivot filters on Team view | Floored-aggregate design first (5.3) |
| Reflections (weekly self-review surface) | Unspecced in V4; digest is the weekly rhythm; founder call |
| Org-admin audit UI in Settings | "No UI in V1" stands; route exists when demand arrives |
| MCP read-only server ("assistant" replacement) | Spec V4 Future gate (unchanged) |
| LCP ≤2.5s p75 on authenticated pages | Neon read replica / region move (founder infra) |
| Read-across of report's SCIM/SSO/directory-sync setup ideas | NOT-016 enterprise gate (first Enterprise customer) |

---

*Per-phase workstreams follow rule 3 (one agent, one PR chain): U0 and each of U1–U5 are
independently mergeable chains; run `/code-review` + apply fixes before opening each PR.*
