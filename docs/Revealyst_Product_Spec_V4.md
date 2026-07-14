# Revealyst — Product Specification (V4)

**Version:** 4.0 · **Date:** 2026-07-13
**Supersedes:** [Revealyst Product Specification V3](legacy/Revealyst_Product_Spec_V3.md) (retained as
the V1.5 reference, exactly as V2 is retained as the V1 reference). Everything in Spec V2 §2–§7
and Spec V3 §§3–12 (market, architecture, data honesty, shared accounts, Personal mode, privacy,
pricing, tech stack) remains in force except where this document says otherwise.
**Direction source:** [Product Direction V4](Revealyst_Product_Direction_V4.md) (founder-approved
strategy synthesis, 2026-07-13). Where this spec and the Direction disagree on an *implementation
fact*, this spec wins — it is grounded in the repo at `4c11be5`; where they disagree on *intent*,
the Direction wins.
**Basis:** Product Direction V4 · a six-domain repo verification fan-out (product scope,
architecture, UX surfaces, telemetry, metrics/scoring, docs landscape) against `main` at
`4c11be5` · the frozen [connector-facts.md](connector-facts.md) · the
[AI Intelligence Implementation Plan](ai-intelligence-implementation-plan.md) (guardrails G1–G10
carry forward verbatim) · the [Manual Sync plan](manual-sync-plan.md) · the four research docs
under [docs/research/](research/).
**Execution model:** unchanged — parallel AI coding agents against frozen contracts
([Execution Plan](Revealyst_Execution_Plan.md) rules 1–7 and all seven scope tripwires carry
forward verbatim).
**Scope-tier vocabulary (new):** this spec uses **MVP / V1 / Future** for the *V4 ladder* (the
pivot's phases). These are distinct from the shipped **V1 (W0–W3)** and **V1.5 (W4)** waves,
which are complete and form the baseline this spec builds on. When this document says "shipped,"
it means merged to `main` as of `4c11be5`.
**Changelog:**
- v4.0 — the pivot spec. Repositions Revealyst from a top-down CTO analytics dashboard to a
  bottom-up **Personal AI Companion** whose individual signal compounds into team and executive
  intelligence. Kills "Score 74" as the individual headline; consolidates 11+ pages onto three
  audience-scoped surfaces; specs the recommendation catalog as seeded data (one engine, tiered
  outputs); commits the Roles / recommendation-catalog / Outcomes entity sequence with their
  full registration burden; carries the Direction's NOT-list as normative scope law.
- v4.1 — the **AI Capability Layer** program (Wave 7–8). Adds a relational capability graph
  (`domains`/`capabilities`/`capability_signals`/`capability_dependencies`), a parallel per-person
  capability/mastery-state engine (`user_capability_state`, capped *directional* until OTel), a
  recommendation utility ranker that consumes the catalog's existing metadata, missions, and
  privacy-safe team capability rollups. Evolves the shipped substrate; does **not** add a graph DB,
  an ML service, fixed persona labels, XP/streaks/leagues, or an LMS. Plan:
  [AI Capability Execution Plan](Revealyst_AI_Capability_Execution_Plan.md); source:
  [gap analysis](ai-capability-implementation-gap-analysis.md).

---

## 1. What changed from V3 (and why)

| V3 position | V4 position | Reason |
|---|---|---|
| Product = CTO analytics: "who's using AI, how well, are we getting our money's worth" | Product = **Personal AI Companion first**; team/exec intelligence is the by-product of individual signal | Single-tool dashboards are commoditized and free (every vendor ships one); "a neutral coach that changes what you do next" is not — and no vendor can build it (Direction §0–§1) |
| "Score 74" is the individual's headline artifact | **Raw 0–100 demoted to expandable diagnostic**; the person sees band + narrative + next step | METR 2025: developers were ~19% slower with AI while believing they were ~20% faster — a product that opens with "get better" contradicts lived experience. Lead with discovery ("what you haven't tried"), never deficiency |
| Custom Index Builder = V1.5 flagship | **Shipped-but-not-headline** (kept, demoted) | It serves the old CTO persona, not the pivot thesis (Direction §10, founder sign-off item) |
| 11+ pages, a ~17-panel team overview, more metrics per release | **Three audience-scoped surfaces** (Personal Companion / Team Intelligence / Executive one-pager); existing panels become candidate *cards* | The current product is dashboard-itis by the pivot's own definition; VNext explicitly says: not more dashboards, not more charts, not more metrics |
| Coaching = 7 static entries keyed to preset components (`src/lib/coaching-recommendations.ts`) | **Recommendation catalog as seeded, versioned reference data** (metric-catalog precedent, mig 0007); evaluator stays closed-vocabulary code | Reconciles the "growing catalog" ambition with guardrail G6 (static content over engines): catalog = data, evaluator = code, no LLM in selection or generation |
| Roadmap-V2 (org-wide expansion) parked as the next tier | **Role expansion beyond Engineering is Future and evidence-gated** — no honest telemetry source exists for non-engineering tools today | The only org-wide cross-role capture mechanism found anywhere is a browser extension — a permanent tripwire (Direction §2, §19) |
| Weekly digest = Intelligence Plan Phase 2 item | **Shipped** (PR #169) and promoted to the pivot's habit mechanism — MVP work is extending it, not building it | The §0 bet isn't testable without a delivery channel; a dashboard nobody revisits proves nothing |

Everything W0–W4 shipped **stays shipped**. This is an EVOLVE, not a rewrite (prior architecture
verdict, carried as a constraint): three of the six VNext entities already exist in the schema
(People, AI Platforms/connections, AI Behaviors/metric_records); Roles, the data-backed
recommendation catalog, and Outcomes are net-new.

---

## 2. Vision & Positioning

**Vision.** Revealyst is the **AI Growth Platform** — it turns every knowledge worker's real AI
usage into a personal coach, and lets that individual signal compound into the team and executive
intelligence leaders pay for, *as a by-product, never as the pitch*.

**Positioning (one sentence).** *"Revealyst helps you get better at using AI every week — using
nothing but the AI you already use — and turns that into the fleet intelligence your company
needs, as a by-product."*

**The wedge stays Engineering** (Claude Code, Cursor, Copilot). The telemetry pipeline, identity
resolution, and connector contracts are all engineering-tool-shaped; the founder-led,
non-enterprise lens argues against widening the target before the narrow bet is proven.

**The one bet (from Direction §0, restated as this spec's acceptance test).** An individual
knowledge worker, with zero organizational pressure, will voluntarily return to Revealyst —
because the guidance is grounded in their own measured, cross-vendor behavior and is better than
free AI tips from a newsletter or ChatGPT itself. **The MVP tier below exists to test that one
sentence.** Nothing enters MVP that doesn't serve it.

**The flywheel (mechanism).** An engineer gets a specific, data-grounded next step → delivered on
a cadence they don't have to remember (the shipped weekly digest, `src/poller/digest.ts`) →
builds a habit → and because every signal is already org-scoped, the manager's Team AI Health and
the CTO's Executive Intelligence populate *for free*. **One engine, three read-lenses**
(personal / team / exec) — this is already how the code is factored.

**Differentiation (three structural facts a competitor cannot retrofit):**
1. **Grounded in the person's own measured, cross-vendor behavior** — identity resolution
   (`src/lib/identity/`) + the frozen attribution ladder compound with every connector.
2. **Privacy enforced at the data layer** — prompt content is structurally impossible to ingest
   (§13), which is exactly what makes voluntary use plausible where a monitored employee would
   never open a "coaching" app.
3. **Vendor neutrality** — Revealyst can honestly say "route this task elsewhere"; a vendor's own
   admin panel structurally cannot.

Against Larridin (funded competitor, enterprise-sales-only, prompt-content ingestion + browser
extension + unpublished headline metrics — see
[research/2026-07-11-larridin-competitive-analysis.md](research/2026-07-11-larridin-competitive-analysis.md)):
the individual / self-serve / privacy-first version of this space is open, and Larridin cannot
copy it without abandoning its strategy. Counter-position: *published formulas vs unpublished
CAV/"Slop Index" · data-layer privacy vs a UI slider · $0/$2 self-serve vs $50K+/yr sales · a
coach you'd open vs a dashboard your manager checks.*

---

## 3. Target Users & Jobs-To-Be-Done

The IC is not one JTBD — measurable AI-skill gains live in the novice→proficient transition, not
proficient→expert. The audience bifurcates:

| Segment | Functional job | Emotional job | What earns a return |
|---|---|---|---|
| **P1a · New-to-AI / junior engineer** | "Am I using this well, and what's the next specific thing to try?" | Reduce FOMO; feel competent | A concrete, personalized next step (the "score→action void" is today's biggest unmet job) |
| **P1b · Senior / already-fluent engineer** | "Confirm my mastery; show me what's genuinely new" | Status; being the champion | Status + the *champion motion* — their good result is the artifact they choose to show their CTO. **Not** more coaching |
| **P2 · Engineering manager** | "Is my team's adoption broad or fragile, and where's the bottleneck?" | Credit for improvement without being "the surveillance manager" | Something to **act on** (concentration / champion-dependence, plateau early-warning) — not read-only charts |
| **P3 · Executive / CTO** | "Are we the 5% capturing value or the 95% failing? What do I do?" | A board-safe, honest number that won't embarrass them later | A self-serve, no-sales-call board artifact (the maturity model's 8 numbers, `src/lib/maturity.ts`) |

**Load-bearing:** self-view-only privacy is not a footnote — it is *the mechanism* that makes
voluntary use possible in a Team org. Feedback that targets the person rather than the task
backfires ~1/3 of the time (Kluger & DeNisi); an engineer engages honestly only if they believe
their manager can never see the raw number. The codebase already enforces this posture
(`assertTeamOnlyPseudonymized`, `src/lib/visibility.ts`) — V4 extends it, never weakens it.

**Scope discipline:** every non-engineering-role JTBD in the VNext brief is an unsourced
hypothesis with no telemetry source (no admin API exists for those tools; the only org-wide
cross-role capture is a browser extension — a permanent tripwire). Role expansion is **Future,
evidence-gated** (§11), never calendar-gated.

---

## 4. Product Principles

1. **Lead with discovery, never deficiency.** "Here's what you haven't tried yet," not "here's
   what you're doing wrong." The target user already feels good about their AI use (METR).
2. **The number is the diagnostic, not the headline** — for individuals. Band + narrative + next
   step first; the 0–100 behind an expander. For teams and execs, numbers stay: boards have a
   vocabulary for them.
3. **Honesty over completeness** (inherited, non-negotiable). A ratio needs both sides or the
   component is omitted — never floored to a fabricated 0 (`src/scoring/evaluate.ts`); no signal →
   no row; directional claims need ≥2 corroborating signals before influencing a level; every
   inferred number carries a `measured/modeled/directional/not_measured` confidence tier.
4. **Privacy is the product mechanism, not a compliance checkbox.** Voluntariness is only real
   when the data literally cannot reach a manager (§13).
5. **One engine, tiered outputs.** Personal coaching, team training-opportunities, and org
   optimization are the same recommendation mechanism read at three altitudes — never three
   engines.
6. **Content is data; logic is code.** The catalog grows by reviewed PRs inserting rows with
   human-written, fact-checked copy; the evaluator stays a closed vocabulary of comparators over
   measured facts. No LLM selects or generates guidance (G6).
7. **Daily value is decoupled from daily data.** Fresh content and discovery can be daily; data
   freshness is whatever the sync channel honestly provides. Never a streak nag, never a
   same-day-score promise (recompute anchors on the previous UTC day).
8. **Prose is a claim surface** (W3-N/W3-P). Every product claim in copy, legal text, and this
   spec is fact-checked against the code by a non-author reviewer before shipping.
9. **Evolve, don't rewrite.** Every V4 capability is specified as an extension of a named,
   existing module wherever one exists.

---

## 5. Core Workflows

### 5.1 The #1 structural gap (load-bearing for everything below)

The only individual self-view today fires **exclusively for an org-of-one**: the dashboard
branches on `ctx.org.kind === "personal"` (`src/app/(app)/dashboard/page.tsx:174`) between
`PersonalSelfView` and the aggregate `TeamOverview`. A member of a multi-person Team org gets
**less** personal value by joining a team — directly contradicting "every employee receives their
own AI companion." Closing this is the highest-priority journey fix, and it is **gated on the
sub-case-C ADR** (§9.4): self-view-only enforcement, dual-source dedup, surfaced-not-billed.

### 5.2 Individual engineer: connect → first insight → habit → weekly progress

- **Onboarding inverts.** Sell the companion first ("meet your AI growth companion"), connect
  second — today's `OnboardingWizard` (`src/app/onboarding/page.tsx`) sells integrations first.
  Say the hook out loud: "this is how *you* get seen — by yourself."
- **Aha moment:** first sync completes and the Growth Journey says "You're at **Trial** — here's
  the one thing to try next" (maturity level copy already exists: Dormant / Trial / Adopted /
  Embedded / Amplified, `src/lib/maturity-glossary.ts`) — not "Score 74."
- **Habit:** the weekly digest (shipped: personal-best detection with strict `isNewBest`, gated
  recommendations, staleness honesty, RFC-8058 one-click unsubscribe) is the delivery channel.
  Daily value = a single fresh nudge card drawn from the last sync — never a data-freshness
  requirement.
- **Weekly progress:** digest + in-app Growth Journey card reuse the same content assembly
  (`src/lib/digest-content.ts`).

### 5.3 Manager onboarding a team

Invite-by-link (shipped: `src/app/invite/[token]/`); each member runs journey 5.2 independently —
*that is* the bottom-up flywheel. The manager's aha is **action-shaped** ("these 2 things move
your team fastest"), not chart-shaped. Cold-start honesty: render "not enough data yet — invite N
more" (reuse `EmptyState`), never a falsely-low chart.

### 5.4 Executive reviewing org health

The exec questions map ~1:1 onto the shipped maturity model: 8 board numbers with confidence
tiers, QoQ trajectory (needs ≥8 comparable prior weeks — sell it as a "give it a quarter"
artifact), plateau detection, and the `MATURITY_NOT_SCORED` refusal list (`/maturity` page,
shipped in PR #169). V4 work: a **monthly narrative one-pager** (memo, not chart wall) as
export/email — the weekly digest cadence can't serve execs honestly.

---

## 6. Telemetry & Data Model

### 6.1 What exists (frozen, verified)

- **Fact table:** `metric_records` — natural upsert key `(org_id, subject_id, metric_key, day,
  dim)`; every vendor restates recent days, so writes are always `ON CONFLICT DO UPDATE`.
  `org_id` in the PK makes cross-org conflicts unrepresentable.
- **Sub-daily:** `subject_day_signals` — 24-slot UTC-hour histogram (`hours smallint[]`,
  cardinality-checked) + `peak_concurrency`; NULL when the vendor has no intra-day grain —
  absence is never fabricated.
- **Canonical metrics:** 26 frozen keys across 10 families (`src/contracts/metrics.ts`),
  mirrored by the seeded `metric_catalog` table — including the V1.5 agentic family
  (`agent_sessions`, `agent_requests`, `agent_active`) and native Copilot `ai_credits`.
- **Attribution ladder (frozen):** `person > key_project > account`; any derived value inherits
  the **lowest** attribution of its inputs (`lowestAttribution`), never redistributed upward.
- **Honesty gaps (frozen, 7 kinds):** `oauth_actors_missing`, `telemetry_only_users_in_totals`,
  `shared_key_not_person_level`, `service_accounts_unresolved`, `sub_daily_unavailable`,
  `sync_window_incomplete`, `other` — first-class connector output, collected in
  `connector_runs.gaps` and surfaced in-product.
- **Identity:** `subjects` (vendor actors) ↔ `people` (pseudonymous persons) via `identities`;
  auto-resolution only for `kind: "person"` subjects with unambiguous email; everything else goes
  to manual reconciliation (`/reconcile`). **tracked_user** (billing primitive, frozen): an
  identity-resolved person with ≥1 metric_record in the period; unresolved subjects surfaced,
  never billed.

### 6.2 Three complementary channels (by population, not redundancy)

1. **Vendor API connectors** (shipped: Anthropic Console, OpenAI, Cursor, GitHub Copilot —
   `src/connectors/registry.ts`) — the only source for Team-org, manager-visible, *billable*
   data. [connector-facts.md](connector-facts.md) is the authoritative honesty ceiling per vendor.
2. **Claude Code local logs / Manual Sync** (shipped: `packages/revealyst-agent` +
   `src/lib/agent-ingest.ts`) — the only source for Individual/Pro/Max users who are structurally
   invisible to every admin API.
3. **Claude Code OTel receiver** (**unbuilt** — verified: zero application references) — the only
   honest source for true accept/reject, real active time, and retries; gates all *measured*
   (vs directional) proficiency claims. V1, and its spike starts immediately (§15.3).

### 6.3 Signal coverage plan (VNext's 9 behavioral categories → tiers)

| Category | Repo status (verified) | Action / Tier |
|---|---|---|
| Sessions, models, features, agent usage, active usage | Captured | Wire remaining polled-but-unused fields **[MVP]** — zero new privacy surface |
| Acceptance patterns | Real for Cursor/Copilot (`suggestions_*`, `edit_actions_*`); proxy-only for Claude Code | Keep native fields **[MVP]**; true accept/reject via OTel **[V1]**. Never label a local-log proxy as "accept rate" |
| Workflow diversity | Derivable from `feature_used` dim breadth; not first-class | Promote to a first-class signal **[MVP]** |
| Context usage | Vendor exposes `context_window` (with `service_tier`, `inference_geo`, `speed` — connector-facts §3); **confirmed never requested**: the Anthropic client's `group_by` (`src/connectors/anthropic/client.ts`) omits these dimensions entirely | **[V1, OTel-gated]**, directional; ≥2-signal rule before it drives a rec |
| Planning behaviour | No honest signal today | **[Future, OTel-gated]** |
| Conversation structure | Session-shape stats only; scope ambiguous | **[Future]** — needs the §16 design answer first |

Known deliberate drops that stay dropped without their own ADR: Copilot's `ai_adoption_phase`
(would pollute `feature_used` breadth), Cursor's `acceptedLinesAdded/Deleted`, `totalApplies`,
and plan-mix fields (documented double-count/misattribution risks).

### 6.4 New entities (net-new tables; every one carries the full three-registration burden, §15.2)

- **Roles** [V1] — a real FK target for the catalog's `applicable_roles`. Ships before any
  role-specific content. Engineering-only values at launch.
- **Recommendation catalog** [V1] — seeded, versioned reference table (§8.2).
- **Rec interaction state** [MVP] — snooze/dismiss + "mark as tried" per (org, person, rec);
  verified absent today (zero matches for snooze/dismiss in `src/`). Small table, self-view-only.
- **Outcomes** [Future, demand-gated] — bounded to "did the person engage/act on the rec and did
  the signal move next period," never "did shipped code quality improve." An always-empty table
  reads as "no outcome," not "not measured" — an invariant-(b) trap; do not ship it hollow.
- **Capability graph** [V1] — `domains` / `capabilities` / `capability_signals` /
  `capability_dependencies`: seeded **global reference** tables (no `org_id`, like `roles`), a
  relational graph of ~30–40 outcome-named engineering capabilities bound to existing
  `metric_catalog` / score components. Not a graph database (§11.5). `recommendation_catalog` gains
  an additive `target_capabilities` column (ADR).
- **User capability state** [V1] — `user_capability_state` per (org, person, capability): mastery,
  confidence, staleness, next-capability; self-view-only; a parallel incremental reducer over the
  existing readers (the Maturity Model precedent), **capped `directional`** until the OTel receiver
  provides ≥2 corroborating markers. Priors = person-level scores + maturity axes; never mutates the
  frozen score contract. Verified absent today.
- **Missions** [Future→V1 per sign-off] — `missions` / `mission_steps` (seeded) + `mission_progress`
  (self-view): bounded challenges bundling existing catalog recs, completion detected from **measured
  signal crossings**, never self-asserted; inside the §8.4 anti-gamification boundary (no XP/streaks/
  leagues).

**New cross-cutting requirement [MVP]:** a per-person **signal-coverage indicator** — two
`person` rows are indistinguishable today even when one has 3 sources and another has 1. A rec
engine that silently recommends *less* to under-instrumented people is a quiet honesty violation.

**Kills (telemetry):** any "true accept/reject" claim from local-log proxies; the always-on
resident collector as a near-term lever (superseded by Manual Sync — ~95% of the signal at 1/10
the cost); any "time saved" telemetry category (METR dead end).

---

## 7. Metrics, Scoring & Insights

### 7.1 Keep the engine, change the surface

The versioned, weighted, closed-vocabulary scoring engine stays (frozen `ScoreDefinition`;
evaluator honesty rules verified in `src/scoring/evaluate.ts`: ratio-side missing → component
omitted; nothing consumed → `null`, no row written). The three global presets (adoption /
fluency / efficiency, published in [score-definitions.md](score-definitions.md)) stay. What
changes is presentation:

- **Individual:** the raw 0–100 is demoted from headline to expandable diagnostic. The person
  sees **band + narrative + next step**. A single blended individual "AI Health" number is
  **killed** — that's "Score 74" in a mascot costume. The marker-level proficiency breakdown
  (~11 markers, strong/weak per marker) is **V1 and does not exist yet** — it rides the
  Intelligence Plan's Phase-3 proficiency work and is capped at *directional* until the OTel
  receiver lands. Until then, the individual surface composes what's shipped: maturity level +
  component-level score insight + coaching card.
- **Team / Exec:** numbers stay. The shipped **AI Maturity Model** (Breadth/Depth/Consistency
  axes; L0–L4 with demotion rules; 84-day window; QoQ trajectory with honest `notComparable`
  states; plateau detection; 8 board numbers each carrying a confidence tier;
  `MATURITY_NOT_SCORED` refusal list) *is* the Team + Executive Intelligence pillar. It needs
  distribution (export, email, marketing), not a redesign. It is also a **market-first artifact**
  — every incumbent's maturity model is survey-based; Revealyst's is telemetry-derived. Flagship
  treatment (§14 bet 5).

### 7.2 Benchmarks are three different claims — never blur them

1. **Your own past self** — lead with this everywhere (cheapest, most motivating, least risky).
   Shipped: score trends, `isNewBest`, movement panels.
2. **Peers in your org** — aggregate-only percentile/concentration
   (`src/lib/usage-distribution.ts`, concentration in the maturity numbers). Never a named
   ranking.
3. **The outside world** — today a `draft` modeled fixture explicitly labeled
   "Revealyst modeled estimate (unverified)" (`src/lib/benchmarks/norms.ts`,
   `BENCHMARK_NORMS_VERSION = 0`). The real cross-org k-anonymous version is gated on consent
   volume (`benchmark_consent` exists), not on code. No benchmark reaches a customer-facing
   panel as *verified* until the founder verifies its source.

### 7.3 Insight taxonomy (named, so UI and prioritization treat kinds consistently)

`data-hygiene · adoption · effectiveness/verification · spend · agentic-transition ·
early-warning · narrative · milestone/positive (new)`. The shipped `deriveAttention`
(`src/lib/score-insights.ts`) already emits most kinds (connection errors, unresolved usage,
anomaly spikes, plateau, score drops with driver diagnosis, honesty gaps, shared accounts,
coaching recommendations) with deterministic impact ordering and caps — V4 names the taxonomy and
adds the missing **milestone/positive** kind (§8.4).

**Kill:** showing an individual a fixed personality label ("you are a Skeptic" — the
`segmentFor` vocabulary in `src/scoring/segment.ts`). Person-focused verdicts backfire; the
segment survives only as an *aggregate cohort lens* for managers (already how
`SegmentBreakdown` renders it).

---

## 8. AI Coaching

### 8.1 What's shipped (the seed of the engine)

`COACHING_RECOMMENDATIONS` (`src/lib/coaching-recommendations.ts`): 7 static entries keyed
`slug::componentKey`, deduped by `signalGroup`, gated centrally in `deriveAttention` on a
*measured, weak* (normalized < 40), *sufficiently weighted* (≥ 0.2) component, capped at 2,
weakest-first, with the guidance disclaimer appended centrally so it can't be forgotten. The same
engine feeds the digest (cap 3). This is the honesty pattern the catalog scales up.

### 8.2 Catalog = data; evaluator = code (the central design decision, reconciling "growing catalog" with G6)

- **Catalog rows** (title, body, `applicableRoles`, `applicableTools` as generic capability
  nouns, `requiredSignals`, benefit, difficulty, confidence, learning resources, related
  workflows, `signalGroup`, insight-taxonomy kind, suggested-action type) live in a **seeded,
  versioned reference table** — the exact precedent of `metric_catalog` (mig 0007) and score
  presets (mig 0009). Growing the catalog is a reviewed PR inserting rows of human-written,
  fact-checked copy. [V1, by ADR]
- **Evaluator** stays what `deriveAttention` already is: a small, named, closed vocabulary of
  comparators over measured facts, capped and deduped deterministically. `requiredSignals` is
  structured data drawn from that closed vocabulary — never arbitrary or LLM-authored logic.
- **No LLM in selection or generation.** The only legitimate *future* (V2+) LLM use is a
  non-authoritative restatement layer rephrasing an already-selected, human-authored entry —
  never deciding which entry applies, never inventing guidance.
- **Perf floor stated up front (ADR requirement):** one per-org catalog read + in-memory
  per-person evaluation — never N per-person round trips (each Neon round trip costs
  ~500–670ms; a naive per-person lookup is a multi-second page).
- **Suggested-action taxonomy (one, central):** `link-out doc · in-product Revealyst setting ·
  deep-link to vendor settings`. Catalog entries that read "Revealyst does X for you" are
  rewritten as "try doing X using capability Y in tool Z" — third-party write automation is a
  different product (§11 NOT-list).

**One engine, tiered outputs.** The "Personal Recommendation Engine" and the "AI Optimization
Engine" are the same mechanism at different altitudes: Personal = workflow/feature recs (this
catalog); Team = training-opportunity surfacing via the aggregate-only lane (plateau /
concentration — shipped); Org = reduce-spend / consolidate-vendors via cost-per-unit + tool-sprawl
findings (`src/lib/spend-governance.ts` — shipped). Assembly and labeling, not new engines.

**Capability catalog + utility ranker [V1, Wave 7].** Catalog rows gain a `target_capabilities`
link into a small **relational** capability graph (`domains → capabilities → capability_signals →
capability_dependencies`, ~30–40 nodes — not a graph database). The evaluator upgrades from the fixed
`impact: 1` to a **deterministic utility score** that finally reads the metadata the catalog already
stores (`benefit` / `difficulty` / `confidence` / `applicableRoles` / `applicableTools`): `utility =
0.35·capabilityGap + 0.20·benefit + 0.15·confidence + 0.10·roleToolFit + 0.10·novelty −
0.05·difficulty − fatigue`, with role/tool + capability-prerequisite eligibility gating before
ranking. Still **no LLM and no ML in selection** (G6) — every weight is a named code constant; the
`MAX_RECOMMENDATIONS` cap and signal-group dedupe are unchanged. An output-equivalence guard pins the
existing weakest-first order as a strict subset until the weights turn on.

### 8.3 Interaction state [MVP]

Snooze / dismiss / "mark as tried" per person (verified absent today). Self-view-only rows;
managers never see individual interaction state. "Mark as tried" is the cheap forerunner of the
Outcomes loop (§14 bet 1): tried + next-period signal delta reuses existing delta plumbing.

### 8.4 The AI Growth Journey (composition, not a new engine)

Assembles existing outputs — maturity level (L0 Dormant → L4 Amplified), score-component
insights, coaching card, digest content — into one coherent self-view surface. It must **not**
become a third ladder: the **org matures** (maturity model), the **person progresses**
(proficiency band, V1) — those are the only two scales. No "AI Coach XP."

| Capability | Tier | Ground truth |
|---|---|---|
| Growth Journey card (level + one next step + why + benefit) | **MVP** | Composition over shipped maturity + coaching; no new storage for v0 |
| Milestone catalog (first agent session, breadth threshold, N-week cadence) surfaced immediately, not digest-only | **MVP-adjacent** | *Not implemented today* (verified); extends the `isNewBest` plumbing pattern |
| "No daily streak" as a decision: weekly consistency with forgiveness, or none | **MVP decision** | Prevents a later gimmick regression; streaks-without-forgiveness are a documented trust risk |
| "Next best thing to learn" as ONE persistent card (not regenerated daily) | **V1** | Rides the catalog + rec interaction state |
| Marker-level proficiency breakdown (self-view); composite band as secondary label — **backed by `user_capability_state`** | **V1** | Rides Intelligence Plan F3.1–F3.3; directional until OTel |
| Capability profile card — a **decomposition of the one proficiency band** (never a third ladder), self-view | **V1** | Reads `user_capability_state`; personal-org only until measured |
| Missions — bounded, finish-lined challenges (start/progress/complete); completion from **measured signal crossings**, not self-asserted; no XP/streaks/leagues | **Future→V1 per sign-off** | Bundles catalog recs; `mission_progress` self-view; §11.5 NOT-list applies |
| Learning-path content (static curricula keyed to band) — merged with "learning goals": one content model | **V1** | Sequences the catalog into a journey |

**Duolingo is a values analogy, not a blueprint.** Keep the structure (clear current level, one
obvious next step, visible progress, milestone recognition, spaced return); drop the extrinsic
chrome (streak flames, XP, leagues, hearts) — several fail behavior-change evidence *and* are
structurally impossible under self-view-only privacy (leagues need visible peer rank).

---

## 9. Individual, Team & Shared-Account Capabilities

> **Terminology note:** "Capabilities" in this section means *population scope* (individual / team /
> shared-account) — who receives which surface. It is distinct from the **skill/capability catalog**
> (the `domains → capabilities` graph of §8.2/§8.4). See the
> [AI Capability Execution Plan](Revealyst_AI_Capability_Execution_Plan.md).

### 9.1 Individual

Extend the *existing* self-view machinery (`PersonalSelfView` + digest personal lane) to every
person, inside or outside a team — not a parallel system. Default tone: self-coaching, never
surveillance.

### 9.2 Team (manager)

Aggregate-only is already a hard architectural invariant, not a policy:
`assertTeamOnlyPseudonymized` (`src/lib/visibility.ts`) **throws** if any surfaced score carries
a real name, any segment lists members, or any shared-account flag exposes an account identifier.
"Managers never inspect individual recommendations" is therefore the codebase's default posture —
the rec engine inherits it. "Private" (`orgs.visibilityMode`) stays the permanent default;
individual recs stay invisible to managers even when visibility is loosened for names.
Champion/blocker surfacing gets a `MIN_PEOPLE`-style floor before naming an implicit champion in
a small team (de-anonymization risk) — even at manager level, even in aggregate copy.

### 9.3 Shared accounts

Unchanged and reaffirmed: guidance-first migration path (per-user keys → migrate shared logins →
reconcile identities); detection surfaces flags aggregate-only; shared accounts count **resolved
identities only**; unresolved subjects surfaced, never billed (frozen `tracked_user` contract).

### 9.4 Hard prerequisite: the sub-case-C ADR (blocks Companion-in-Team-orgs)

Desktop/local data from an opted-in Team-org member must feed **only that person's private
self-view** — never team rollups, never any manager-readable surface, never billing — until an
ADR lands all three of: **(a)** a provable exclusion audit predicate (generalize
`assertTeamOnlyPseudonymized`; today it is a hand-written check over exactly 3 surfaces and a 4th
surface that isn't added passes *vacuously* — make completeness test-enforced), **(b)**
dual-source dedup (a person visible via both an admin API and the local agent must not
double-count), and **(c)** surfaced-not-billed treatment. **The Personal Companion cannot ship
inside Team orgs until this ADR exists** — otherwise the flywheel breaks at exactly its
conversion moment.

---

## 10. Manual Sync

Manual Sync is the shipped, approved data path for Claude Code local data
(`packages/revealyst-agent` published as `@revealyst/agent`; two-command copy-paste; streaming
parser; window pinning; post-commit recompute enqueue; `SyncStatusBadge` + `SyncStalenessBanner`
at the 14-day threshold = ½ of Claude Code's 30-day local retention; `sync_window_incomplete`
honesty gap). It is the MVP data path — keep it. V4 resolves its real tensions instead of
papering over them:

- **Cadence math vs the daily promise.** The user must sync roughly every ~15 days or lose
  history permanently. **Resolution (principle 7):** daily companion *content* draws on the last
  sync; data freshness is honestly badged. Never a daily sync nag.
- **Same-day reward is structurally impossible** (recompute anchors on the previous UTC day —
  `previousDay(todayUTC)`). The same-click reward must come from data already computed: "this
  sync captured 340 sessions across 12 days — here's one thing you did well." [MVP]
- **Transparency:** an inline "here's what this sync sent" summary (event/day counts,
  allowlisted field names) after every sync — the on-device allowlist made visible. [MVP]
- **Two "sync" mental models** (one-click connector poll vs run-a-CLI-command) live on one
  `/connections` page — separate them in copy. [MVP]

**Hard guardrails (reaffirmed as UX law, not just architecture):** never a drag-and-drop "upload
your logs" flow; never a browser-persistent-grant sync — both categorically rejected (content has
already left the device by the time server-side stripping could run).

**Future, demand-gated:** the resident/cadence-aware agent is demoted, not dead — go/no-go rides
on the `last_success_at` cadence telemetry the Manual Sync plan already collects. The pivot's
daily framing should *accelerate that decision*, not silently assume always-on collection.

---

## 11. Feature Scope — MVP / V1 / Future

Effort grades: **S** = lib/UI PR · **M** = new surface/connector harvest (maybe 1 ADR) · **L** =
new table + fetch layer + ADR + migration + tenant-isolation + purge registration · **XL** =
multi-table, multi-surface. **The MVP boundary is a product boundary:** its job is to test the §2
bet, which means coaching content *and* its delivery channel land together.

### 11.1 Shipped baseline (not re-specified; V4 builds on it)

Connectors (Anthropic Console, OpenAI, Cursor, GitHub Copilot) · scoring engine + 3 presets ·
identity resolution + reconcile UI · shared-account detection · Paddle billing + free band
(≤5 tracked users, `FREE_TRACKED_USER_LIMIT`) · Spend Governance (budgets, in-app threshold
alerts, drill-down) · Custom Index Builder (demoted from flagship) · Settings + audited
visibility modes · platform admin · Manual Sync Phases 1–2 · Intelligence Phase 1 (coaching recs,
score-drop attribution, agentic-adoption rate, honesty-gap trend) · Intelligence Phase 2
(maturity model + `/maturity` page, weekly digest + preferences, anomaly/plateau, period
narrative, correlations) · marketing site + share cards.

### 11.2 MVP (test the bet)

| Capability | Grade | Ground truth |
|---|---|---|
| Personal Companion surface: Growth Journey card + persistent coaching card + daily nudge card (one card, not a dashboard) | M | Composition of shipped maturity/coaching/digest content; replaces score-first `PersonalSelfView` layout |
| Onboarding inversion (companion pitch before connect) | S | Rework `OnboardingWizard` copy/order |
| Rec interaction state: snooze / dismiss / mark-as-tried | L | New self-view-only table (three registrations, §15.2) |
| Milestone surfacing (immediate, not digest-only) | S–M | New detection on existing signals; `isNewBest` pattern |
| Wire polled-but-unused vendor fields + workflow-diversity as first-class signal | S | §6.3; zero new privacy surface |
| Optimization metadata on recs (impact / difficulty / confidence / action type) | S | Type extension of the static 7-entry map; G6-compliant |
| Signal-coverage indicator (per person) | S–M | §6.4; honesty requirement |
| Sync same-click reward + "what this sync sent" transparency panel + copy split | S | §10 |
| Team Intelligence consolidation (~17 panels → ~5 cards) + Exec 8-number report distribution | S–M | Maturity model shipped; this is curation + export |
| Budget-threshold **email** alerts (in-app shipped; email is the gap) | S | Rides SES sender (`src/lib/email.ts`); Larridin has zero budgets — marketed moat |
| Within-org percentile lens + board-ready CSV export | S | Within-org percentile math exists (`percentile()`, `src/lib/usage-distribution.ts` — not the external-benchmark `percentileFor`, a different claim lane per §7.2); export is new |
| Digest as Growth-Journey delivery vehicle (content extension) | S–M | Digest shipped; extend `digest-content.ts` |
| "No daily streak" decision recorded (weekly-with-forgiveness or none) | — | Spec decision, §8.4 |

### 11.3 V1

| Capability | Grade | Gate |
|---|---|---|
| Recommendation catalog as seeded data (+ named insight taxonomy, suggested-action taxonomy) | L–XL | ADR (supersedes the G6 "static map" letter, preserves its intent); batching design in the ADR |
| Roles entity (engineering-only values) | L | ADR; before any role-specific content |
| Per-individual self-view companion **inside Team orgs** | M–L | **Sub-case-C ADR (§9.4)** + audit-predicate generalization |
| Claude Code OTel receiver | L | Spike fires immediately (§15.3); gates 3 of 4 missing signal families |
| Proficiency band + marker breakdown + learning paths (self-view) | M–L | Directional until OTel lands; then measured |
| Monthly Executive narrative export/email | M | Reuses `narrative.ts` + SES |
| Renewal reminders (manually-entered contract dates — no vendor reports them) | M | New field, honest labeling |
| Context-usage signal (directional) | M | OTel-gated; ≥2-signal rule |
| Capability graph (`domains`/`capabilities`/`capability_signals`/`capability_dependencies`) + `target_capabilities` link | L | ADR; relational, not a graph DB; ties recs to named capabilities |
| Per-person capability state (`user_capability_state`) + utility ranker | L | ADR; capped *directional* until OTel; parallel reducer, never mutates the score contract |

### 11.4 Future (each with its named gate)

Outcomes entity (demand-gated; only after a real outcome signal exists) · role expansion beyond
Engineering (**evidence-gated:** requires an honest telemetry source — the M365 Copilot / Google
Workspace admin-API research question in §16 must be answered first) · planning-behaviour +
conversation-structure signals (OTel-gated + §16 design answer) · real cross-org k-anonymous
benchmarks (consent-volume-gated) · read-only MCP server over org analytics (sequenced behind
personal-value proof) · perceived-vs-measured pulse panel · resident desktop agent (cadence-
telemetry-gated) · Enterprise connectors / SSO / SCIM / directory sync (trigger-gated on a first
Enterprise customer) · ChatGPT-export upload (parked from V1.5 cut order) · **missions + progression** (gated on V1
capability state landing + real rec-interaction volume to sequence against) · **recommendation
exposure logging + experimentation** (gated on an ADR reversing today's deliberate "don't log
rec-shown-to-X" stance + founder sign-off, §16 — a *distinct* gate from Outcomes; never merge the two).

### 11.5 The NOT-list (normative; every item grounded in a standing tripwire, guardrail, or research finding)

- No per-user LLM-generated coaching text (G6) — the engine is a curated, versioned catalog
  matched to measured gaps.
- No browser extension, desktop proxy, or any capture beyond sanctioned connectors/agent/OTel.
- No prompt-content ingestion in Team mode, ever.
- No time-saved / ROI-% / "AI helps-hurts" verdicts. "Expected impact" renders qualitative or
  adoption-based, never hours/dollars.
- No per-person quality, velocity, or AI-vs-human authorship scores.
- No shadow-AI *estimation* — state the gap, never model it (the `darkSeat: not_measured`
  pattern is the template).
- No manager visibility into any individual recommendation, coaching content, or interaction
  state (code-enforced).
- No formula DSL / per-tenant custom scoring expressions (Custom Index Builder stays a closed
  vocabulary; never person-level).
- No enterprise procurement machinery (SSO/SAML/SCIM, MDM, HRIS/org-chart sync) without a first
  Enterprise customer.
- No full DORA/dev-intelligence suite; no GitHub outcome layer without its own ADR + DPA review —
  Outcomes stays bounded to rec engagement, never shipped-code quality.
- No "AI news" editorial feed (unbounded solo-founder content-ops treadmill).
- No third-party write automation ("Revealyst does X for you" in someone else's tool).
- No "Ask AI" NL-query chat surface (superseded by the read-only MCP-server bet).
- No second B2C funnel for Personal mode (org-of-one architecture stands).
- No non-engineering role libraries in MVP or V1.
- No Slack/Teams channel in MVP/V1 (email first).
- No literal Duolingo mechanics (streaks without forgiveness, XP, leagues, hearts).
- No Kafka / ClickHouse / separate ML service / Chinese-vendor connectors (standing tripwires).
- **No capability-program over-build:** the capability/mastery layer (§8.2/§8.4, Wave 7–8) uses a
  **relational** graph (not a graph database), a **deterministic** utility ranker (no ML / bandits /
  BKT until real feedback volume + its own gate), **no fixed per-person persona labels** (personas
  survive only as an aggregate cohort lens), **no XP / streaks / leagues**, and **no LMS / course /
  certification layer**. See [gap analysis](ai-capability-implementation-gap-analysis.md) §3/§13 for
  the decided-not-built list.

**Pricing: unchanged from V3** ($0 Personal forever · $2/tracked-user/mo Team · free band ≤5 ·
Paddle MoR). The pivot changes what the individual *gets*, not what they pay.

---

## 12. UX Principles & Surface Consolidation

1. **Three audience-scoped surfaces; everything else is a card, a settings page, or gone.**
   - **Personal Companion** (daily/weekly): one home per person — Growth Journey card + coaching
     card + weekly-progress content. Daily = one nudge card, never a dashboard.
   - **Team Intelligence:** one screen — Team AI Health, maturity, training opportunities,
     benchmarks, champions (floored), blockers. The ~17 shipped Team-Overview panels fold into
     ~5 cards.
   - **Executive:** the monthly narrative one-pager (8 numbers + composed narrative), with Spend
     Governance folded in as a line, not a page.
2. **Consolidations:** fold the thin `/people` and `/teams` rosters into Team Intelligence +
   Settings; kill standalone correlation/anomaly panels (keep the synthesis inside the narrative);
   demote `/indexes` (Custom Index Builder) out of navigation prominence.
3. **Honest empty and degraded states everywhere** — reuse `EmptyState`, staleness banners, and
   `notComparable` patterns; a cold-start team sees "invite N more," never a falsely-low chart.
4. **Positive-first framing** (principle 1) in every headline string; deficiency language only
   inside expandable diagnostics.
5. **Design system unchanged:** Tailwind v4 + shadcn `base-nova` on Base UI primitives; shared
   components in `src/components` (`PageHeader`, `EmptyState`, `SyncStatusBadge`, sidebar shell);
   pages get session + org scope only via `src/lib/api-context.ts`.
6. **Copy discipline (G7):** user-facing prose lives in glossary-style constant modules
   (`*-glossary.ts`, `*-copy.ts`); every new surface gets an adversarial content fact-check by a
   non-author reviewer; connector claims derive from `src/connectors/registry.ts`, never
   hard-coded.

---

## 13. Privacy & Security

Privacy is the moat *and* functionally required: the bottom-up thesis depends on voluntary
opt-in, and voluntariness is only real when the data literally cannot reach a manager.

- **"No prompt content. Ever." is architecture, enforced at three independent points** (all
  verified in-repo): (1) the on-device allowlist parser
  (`packages/revealyst-agent/src/parse.ts`) — denylisted fields (`message.content`,
  `toolUseResult`, `lastPrompt`, titles, slugs, attachments) are *never read*, not filtered
  post-hoc; (2) the server-side bound on the free-text `dim` field
  (`MAX_DIM_LENGTH = 128`, control-character rejection, `src/lib/agent-ingest.ts`); (3)
  content-flags-off-by-default + scrubbing specified for the planned OTel receiver. Lead with
  this in Companion onboarding — a "privacy as a settings slider" competitor cannot retrofit it.
- **Team-mode ≠ Personal-mode privacy math.** Employee consent is not a valid GDPR basis for
  workplace monitoring (EDPB 05/2020); Germany's BetrVG §87(1)(6) triggers on monitoring
  *capability*. The only sub-case that is both legally clean and product-honest is
  **self-view-only**: when no manager-readable surface exists, "objectively capable of
  performance monitoring" has nothing to attach to.
- **Self-view-only is enforced by an audit predicate, not UI** — `assertTeamOnlyPseudonymized`
  today; generalized + completeness-test-enforced before the first Team-org self-view surface
  (§9.4, §15.2). Named reveal stays gated behind explicit, logged admin action
  (`orgs.visibilityMode`, audit_log).
- **Credentials:** AES-256-GCM envelope, versioned Worker-secret KEK, AAD binds
  `orgId:connectionId:kind` (frozen row format, `src/lib/credentials.ts`). No plaintext
  credential column exists anywhere. (It is a Worker-secret KEK — never claim "KMS" in any copy;
  that overclaim already happened once.)
- **Retention/deletion:** raw payloads purged ~90d; account deletion purges via the CI-enforced
  completeness tripwire (`src/db/account-deletion.ts` + `tests/account-deletion.test.ts`).
  **Every new person-scoped table in this spec (rec interaction state, Roles, catalog, Outcomes)
  registers into that sweep on day one.**
- **New commitments [MVP/V1]:** publish a public, inspectable **"what we collect" schema page**
  generated from the actual device allowlist (not a paraphrase); instrument **opt-in rate** as a
  leading indicator ("privacy enables adoption" as a measured hypothesis). Run all narrative team
  copy ("your champions are 3 people") through the adversarial fact-check for de-anonymization
  risk before Team Intelligence ships.

**Kills:** any Team-org design where person-level desktop/OTel data reaches a manager-visible
surface, however "opt-in" framed; org-deployed endpoint agents / MDM binaries; raw log/folder
upload of any kind.

---

## 14. Success Metrics

**MVP exit gate (new — nothing defined one before):** a sustained N-week weekly-digest
open/return rate on the founder's own dogfooding org before any Team-tier or role-expansion
investment. Without it, "prove voluntary use" is a slogan, not a checkpoint. (N and the rate
threshold are a founder sign-off item, §16.)

**Leading indicators (instrumented, not aspirational):**
- Voluntary return: weekly digest open → in-app session rate; Companion-surface revisit rate.
- Habit formation: manual-sync cadence distribution, derived from the append-only
  `connector_runs` history (successful `agent_ingest` runs' `finished_at`), with
  `connections.last_success_at` as the latest-sync timestamp — already the committed telemetry
  for the resident-agent go/no-go.
- Opt-in rate for the self-view companion in Team orgs (the "privacy enables adoption"
  hypothesis, measured).
- Rec engagement: shown → tried/dismissed ratio (needs §8.3 interaction state); then the
  Outcomes question — did the underlying signal move next period?
- Honesty-gap trend: % of usage person-attributed, per org, over time (shipped as an
  Intelligence Phase 1 surface — now also a marketing artifact: "92%, up from 71%").
- Flywheel conversion: individual orgs → team invites sent → team orgs created (the champion
  motion, observable in existing invite tables).

**Ranked new bets this spec commits to measuring (Direction §17):** (1) the Outcomes loop —
"we measured that the engine works," a claim Larridin structurally cannot make; (2)
perceived-vs-measured pulse panel [Future]; (3) concentration / champion-dependence as a
first-class Team metric (shipped in maturity numbers — now marketed); (4) plateau early-warning
as a proactive alert; (5) the telemetry-derived Maturity Model as a marketed, market-first
artifact; (6) read-only MCP server [Future]; (7) honesty-gap trend as visible progress.

**Business guardrails (unchanged from V3):** free→paid conversion at the 5-tracked-user band;
seat metering correctness (compare-and-set before Paddle PATCH — never double-charge).

---

## 15. High-Level Architecture

### 15.1 Topology (unchanged — EVOLVE, not rewrite)

One Cloudflare Worker (Next.js via OpenNext; custom entry `src/worker.ts`) · two custom domains
(`app.revealyst.com` = app + auth; `revealyst.com` = marketing + share cards; host split enforced
from `src/lib/domains.ts`) · Neon Postgres via Hyperdrive, Drizzle migrations (latest: 0023) ·
Cron Triggers → Queues (batched fan-out; poll queue + DLQ; consumers self-heal) · Better Auth
(cookie cache off; admin plugin allowlisted) · Paddle MoR · SES for email · single database,
`org_id` on every row; **Personal mode = an org of one** (identical machinery to Team; the
Companion ships on it, no second funnel).

**Perf model (verified, binding):** per-round-trip DB cost (~500–670ms) dominates authenticated
TTFB. Every new read surface threads onto an existing single flat `Promise.all` (the
`readDashboardView` pattern) — never a new sequential query stage (G10). The catalog read is
one-per-org, evaluated in memory per person (§8.2). Smart Placement stays OFF (prior auth-hang
incident).

### 15.2 What any new table in this spec must do (the three-registration law + ADR)

Every net-new org-scoped table (rec interaction state [MVP], Roles [V1], recommendation catalog
[V1], Outcomes [Future], `user_capability_state` [V1], `mission_progress` [per sign-off],
`recommendation_exposure` [Future, gated]) requires, in the same PR: **(1)** a `docs/decisions/` ADR (next free
number — check `ls docs/decisions/` immediately before claiming; the sequence is independent of
migration numbers, and a 0014 duplicate already exists as a cautionary tale), **(2)** a
`tests/tenant-isolation.test.ts` `SCOPED_READS` entry with a non-vacuous B-org seed row, **(3)** a
`src/db/account-deletion.ts` registration (`PURGE_TABLES` or `PURGE_EXEMPT_TABLES`). All access
via `forOrg` (`src/db/org-scope.ts`); cross-org reads only in `src/db/system.ts` from
cron/queue paths. New API routes are typed in `src/contracts/api.ts` (frozen, ADR-gated) and
served through `handleApi`/`appContext` — the 402 free-band gate applies by default.

### 15.3 Sequence-these-first (load-bearing infra, before the feature waves)

1. **Modularize `org-scope.ts` (1,901 lines) and `schema.ts`** before Roles, catalog, and
   Outcomes bolt three more namespaces onto already-frozen monoliths (ADR for the public-API
   split; W4's parallel-fan-out numbering collisions are the cautionary precedent).
2. **Generalize `assertTeamOnlyPseudonymized`** with test-enforced surface completeness before
   the first Team-org self-view surface (§9.4a).
3. **Fire the OTel receiver spike now, in parallel** — it blocks on nothing and gates 3 of 4
   missing signal families plus all *measured* proficiency.
4. **Roles before any role-specific catalog content.**
5. **Catalog ADR includes the batched-read design** (perf floor, §8.2).
6. **Outcomes stays Future explicitly** until a real outcome signal exists — an always-empty
   table is an invariant-(b) trap.

### 15.4 Frozen contracts (unchanged list, one planned amendment)

`src/contracts/**` · `src/db/schema.ts` + `drizzle/**` · `src/db/org-scope.ts` public API ·
`src/lib/credentials.ts` row format · `docs/connector-facts.md` · `fixtures/**` shapes. This
spec plans frozen-contract changes at these named points, each with its own ADR: the rec
interaction-state table [MVP], the Roles entity [V1], the recommendation catalog [V1], Outcomes
[Future], and the **AI Capability Layer** tables (`domains`/`capabilities`/`capability_signals`/
`capability_dependencies` + the additive `recommendation_catalog.target_capabilities` column [V1],
`user_capability_state` [V1], missions tables [per sign-off], `recommendation_exposure` [Future,
gated]) — every new table (or additive column) edits the frozen `schema.ts` + `drizzle/**` and trips
the CI guard even when additive. Everything else in MVP composes existing surfaces.

---

## 16. Assumptions & Open Questions

**Assumptions this spec knowingly rides on:**
1. **The §2 bet** — the voluntary-return loop forms. Untested; the MVP exists to test it.
2. P1 splits into junior/senior hooks (inferred from skill-gain research, not user interviews).
3. The Outcomes loop is the highest-leverage new primitive (this spec's ranking judgment).
4. Users tolerate — or value — being shown perceived-vs-measured gaps (mechanism evidenced;
   reaction untested; why the pulse panel is Future).
5. Effort grades on Outcomes and role expansion (XL) are extrapolated, not estimated from design.

**Open questions needing founder sign-off (carried from Direction §19, with spec-level defaults):**
1. **MVP exit-gate numbers** — N weeks and the open/return threshold (§14). *Default: 6 weeks,
   founder-org dogfood, before Team-tier investment.*
2. **Custom Index Builder demotion** to shipped-not-headline. *Spec default: demoted (§1); needs
   explicit sign-off.*
3. **Phase-3 role expansion telemetry** — can M365 Copilot / Google Workspace admin APIs fill the
   non-engineering gap the way GitHub's API does for engineering? *Research pass required before
   any role-expansion date; until answered, role expansion has no honest data-acquisition
   strategy.*
4. **"Conversation structure" scope** — anything richer than turn-count/session-length likely
   collides with the no-prompt-content stance. *Clarify before any V1 design.*
5. **Daily cadence mechanic** — this spec's decision: daily *content*, no daily *nag/streak*;
   weekly consistency with forgiveness if any streak mechanic ships at all (§8.4).
6. **Resident-agent go/no-go** — decided by measured `last_success_at` cadence, accelerated (not
   pre-empted) by the pivot's daily framing.
7. **Digest-in-MVP** — this spec resolves Direction §19.1: the digest is *already shipped*; the
   MVP question is only how much Growth-Journey content it carries. No sequencing decision
   remains.
8. **Third-ladder line (AI Capability Layer).** Confirm the capability profile card is a
   *decomposition of the one proficiency band*, not a competing third scale (§8.4). Default if
   unconfirmed: block the Wave-7 capability-profile UI. Also confirm the ~30–40 capability seed list +
   prerequisite DAG (product-owned content, not agent-invented) and persona-as-aggregate-lens-only.
9. **Exposure-logging reversal.** Confirm an ADR reversing today's deliberate "don't log
   rec-shown-to-X" stance (`src/app/api/recommendations/interaction/route.ts:16-19`) before any
   recommendation-exposure / experimentation work (Wave 8). Default if unconfirmed: exposure logging
   stays permanently in §11.4 Future, never promoted.

---

## 17. Document map & supersession

- **This document** is the product ground truth. [Spec V3](legacy/Revealyst_Product_Spec_V3.md) remains
  the V1.5 reference; [Spec V2](legacy/Revealyst_Product_Spec_V2.md) the V1 reference.
- [Product Direction V4](Revealyst_Product_Direction_V4.md) is the strategy source this spec
  operationalizes; it remains the richer record of *why*.
- [ai-intelligence-implementation-plan.md](ai-intelligence-implementation-plan.md): Phases 1–2
  shipped; its Phase 3 (OTel, proficiency) is absorbed into this spec's V1 tier; its guardrails
  G1–G10 remain binding verbatim. [manual-sync-plan.md](manual-sync-plan.md) remains the Manual
  Sync implementation reference (§10 here is the product contract).
- [connector-facts.md](connector-facts.md) stays frozen and authoritative for vendor claims;
  [score-definitions.md](score-definitions.md) / [scoring-explained.md](scoring-explained.md)
  stay the published formula record.
- The Execution Plan's rules 1–7, the seven tripwires, and the CLAUDE.md review invariants
  (a)–(d) bind every workstream this spec spawns.

*Produced by fleet orchestration: a six-domain repo-verification fan-out (product scope,
architecture, UX surfaces, telemetry, metrics/scoring, docs landscape) synthesized against
Product Direction V4. Every implementation-status claim above was verified against `main` at
`4c11be5` on 2026-07-13.*
