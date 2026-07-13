# Revealyst — Product Direction (V4)

**Version:** 4.0 · **Date:** 2026-07-13 · **Owner:** founder (product strategist: fleet orchestration)
**Status:** proposed — source of truth for **Product Spec v4**
**Supersedes (as direction):** the VNext Overview brief. It does **not** supersede
[Product Spec V3](Revealyst_Product_Spec_V3.md) (shipped V1.5 scope) — Spec v4 will.
**Basis:** the VNext direction brief + a coordinated fan-out of seven domain strategy
analyses (product, UX, telemetry, metrics, AI-workflows, research, architecture/feasibility),
each grounded in the repo at `main` (`74d21ca`), the four research docs under
[docs/research/](research/), the [AI Intelligence Implementation Plan](ai-intelligence-implementation-plan.md),
[Manual Sync plan](manual-sync-plan.md), and [connector-facts.md](connector-facts.md).
**Prior architecture verdict (carried as constraint):** EVOLVE, not rewrite. Three of the
six VNext entities already exist (People, AI Platforms, AI Behaviors); Roles, a
data-backed Recommendation catalog, and Outcomes are net-new. See the Architecture Review
synthesis for evidence.
**Reading contract:** this document states **what** the product should do and **why**, and
separates **Findings** (grounded in code/docs), **Assumptions** (inferred), and
**Recommendations** (decisions this document proposes). Every product claim inherits the
review invariants (§ CLAUDE.md): every query org-scoped · never fabricate per-user numbers ·
frozen contracts need an ADR · no tripwire tech. Copy claims are a claim surface too (W3-N).

---

## 0. The one bet (read this first)

Revealyst is pivoting from a **top-down CTO analytics dashboard** ("Score 74; are we getting
our money's worth?") to a **bottom-up Personal AI Companion** whose individual signal compounds,
as a by-product, into team and executive intelligence. The entire strategy rests on a single
load-bearing assumption:

> **An individual knowledge worker, with zero organizational pressure, will voluntarily return
> to Revealyst — because the guidance it gives is grounded in their own measured, cross-vendor
> behavior and is better than the free AI tips they can get from a newsletter or ChatGPT itself.**

If that is false, the flywheel never starts and this is the old dashboard with a coaching skin.
Every prioritization decision below is judged against that bar. **The MVP exists to test that
one sentence** — nothing more, nothing that doesn't serve it.

A second finding reshapes how we frame everything: METR's 2025 RCT found experienced developers
were **~19% slower** with AI while believing they were **~20% faster** (research
[ai-intelligence-system §0](research/2026-07-11-ai-intelligence-system.md)). The target user
already feels good about their AI use. A product that opens with *"get better"* contradicts their
lived experience and is dismissed. **We lead with discovery and levels ("here's what you haven't
tried yet"), never deficiency ("here's what you're doing wrong").**

---

## 1. Product Vision & Positioning

**Vision.** Revealyst is the **AI Growth Platform** — it turns every knowledge worker's real AI
usage into a personal coach, and lets that individual signal compound into the team and
executive intelligence leaders pay for, *as a by-product, never as the pitch*.

**Positioning (one sentence).** *"Revealyst helps you get better at using AI every week — using
nothing but the AI you already use — and turns that into the fleet intelligence your company
needs, as a by-product."*

**Why the category shifts.** Every vendor now ships a free single-tool usage dashboard (Copilot
metrics GA, Cursor team analytics, Anthropic Console, OpenAI usage — Spec V3 §2). "Another
dashboard" is commoditized and free. **"A neutral coach that changes what you do next" is not** —
and no vendor can build it, because their incentive is to keep you on their surface, not to tell
you to route a task to a competitor's model.

**The wedge stays Engineering.** Claude Code, Cursor, Copilot. This is the one part of the pivot
that must **not** change: the telemetry pipeline, identity resolution, and connector contracts are
all engineering-tool-shaped, and the founder-led/non-enterprise lens argues against widening the
target before the narrow bet is proven.

**The flywheel (mechanism, not slogan).** An engineer gets a specific, data-grounded next step →
delivered on a cadence they don't have to remember (weekly digest) → builds a habit → and because
the signals are already org-scoped, the manager's Team AI Health and the CTO's Executive
Intelligence populate *for free*. One engine, three read-lenses (personal / team / exec).

**Findings:** connector/market commoditization (Spec V3 §2); the one-engine-three-audiences shape
is already how the code is factored (Architecture Review). **Assumption:** that the voluntary
return loop actually forms — the pivot's central, currently-untested bet.

---

## 2. Target Users & Jobs-To-Be-Done

The IC is **not one JTBD**. Measurable AI-skill gains live in the *novice→proficient* transition
(15% → 28–33%), not proficient→expert (research §8). This bifurcates the audience:

| Segment | Functional job | Emotional job | What earns a return |
|---|---|---|---|
| **P1 · New-to-AI / junior engineer** | "Am I using this well, and what's the next specific thing to try?" | Reduce FOMO; feel competent | A concrete, personalized next step (the biggest unmet functional job today — research §3.3 "score→action void") |
| **P1 · Senior / already-fluent engineer** | "Confirm/display my mastery; show me what's genuinely new" | Status, early-access, being the champion | Status + the *champion motion* (their good score is the artifact they choose to show their CTO) — **not** more coaching |
| **P2 · Manager (Eng first)** | "Is my team's adoption broad or fragile, and where's the bottleneck?" | Credit for improvement without being "the surveillance manager" | Something to **act on** (concentration/champion-dependence, plateau early-warning) — not read-only charts |
| **P3 · Executive / CTO** | "Are we the 5% capturing value or the 95% failing (MIT NANDA)? What do I do?" | A board-safe, *honest* number that won't embarrass them later | A self-serve, no-sales-call board artifact (the 8-number org report) |

**Load-bearing finding:** the self-view-only privacy architecture is not a footnote — it is *the
mechanism* that makes voluntary daily use possible in a Team org. Feedback that targets the person
(not the task) backfires ~1/3 of the time (Kluger & DeNisi, research §9); an engineer only engages
honestly if they believe their manager can never see the raw number.

**Skeptical finding (high impact):** every non-engineering-role JTBD in the VNext brief
(Marketing/Sales/Finance examples) is an **unsourced hypothesis with no telemetry source** — there
is no admin API or OTel export for those tools, and the only org-wide cross-role capture mechanism
found anywhere is a browser extension (a permanent tripwire). **Phase 3 has no honest
data-acquisition strategy today.** See §16 and §19.

**Recommendation:** treat P1-junior and P1-senior as distinct hooks in Spec v4. Gate role
expansion on *measured* Engineering retention, never a calendar.

---

## 3. Core User Journeys

**#1 structural gap, load-bearing for everything below:** the only individual self-view today
(`PersonalSelfView`) fires **exclusively for an org-of-one** (`ctx.org.kind === "personal"`). A
member of a multi-person Team org lands on the same aggregate everyone sees — so today an engineer
who *joins a team* gets **less** personal value, directly contradicting "every employee receives
their own AI companion." Closing this is the highest-priority journey fix. It is gated on the
desktop-collector **sub-case-C ADR** (self-view-only, dual-source dedup, surfaced-not-billed) —
a hard prerequisite (§9).

**(a) Individual engineer — connect → first insight → habit → weekly progress.**
- *Onboarding inverts:* sell the companion first ("meet your AI growth companion"), connect second
  — today's flow sells integrations first. Say the hook out loud: "without this, you're invisible
  to every admin dashboard; this is how *you* get seen — by yourself."
- *Aha moment:* first sync completes and the Growth Journey says **"You're at Trial — here's the
  one thing to try next,"** not "Score 74."
- *Daily value must be decoupled from daily data.* Manual Sync is a ~bi-weekly action, not daily
  (§10). Daily = fresh *content/discovery* drawn from the last sync; **never** a daily
  data-freshness requirement or a streak nag.
- *Weekly progress:* the existing digest (personal-best detection, gated recs, staleness honesty)
  is ~80% of this pillar already — extend, don't rebuild.

**(b) Manager onboarding a team.** Invite-by-link; each member runs journey (a) independently —
*that is* the bottom-up flywheel. The manager's aha is **action-shaped** ("these 2 things move your
team fastest"), not chart-shaped. Cold-start honesty: render "not enough data yet, invite N more"
rather than a falsely-low chart.

**(c) Executive reviewing org health.** The VNext exec questions map almost 1:1 onto the existing
maturity model's "eight board numbers" + template-composed narrative — this is near exec-ready
today. Aha = a monthly one-pager that reads like a memo, not a chart wall. Sell it as a
"give-it-a-quarter" artifact (trajectory needs ≥8 comparable prior weeks).

---

## 4. AI Telemetry & Data Collection

The telemetry model is the **right shape but not the right breadth**. All 9 VNext behavioral
categories map onto an existing `metric_records` / `subject_day_signals` shape or a scoped gap.
The job is to finish wiring what's collected-but-unused and build the one channel that's
structurally required for the categories nothing else can see.

**Three complementary channels (by population, not redundant):**
1. **Vendor API connectors** — the only source for Team-org, manager-visible, *billable* data.
   `connector-facts.md` is the authoritative honesty ceiling per vendor.
2. **Claude Code local logs / Manual Sync** — the only source for Individual/Pro/Max users who are
   *structurally invisible* to every admin API.
3. **Claude Code OTel receiver (UNBUILT, load-bearing)** — the only honest source for true
   accept/reject, real active time, and retries; and the only path to *planning behaviour* and
   *context usage* at measured (not directional) confidence.

**Signal coverage (VNext's 9 categories):**

| Category | Status | Action / Tier |
|---|---|---|
| Sessions, models, AI features used, agent usage, active usage | Captured (some fields polled-but-unused) | Wire existing fields **[MVP]** — cheapest possible win, zero new privacy surface |
| Acceptance patterns | Real for Cursor/Copilot; **proxy-only** for Claude Code | Wire native fields **[MVP]**; true accept/reject via OTel **[V1]** |
| Workflow diversity | Derivable from `feature_used` breadth, not yet first-class | Make it a first-class signal **[MVP]** (cheap, high-visibility) |
| Context usage | Vendor exposes it (`context_window`) but it's **dropped in normalize** | **[V1, OTel-gated]** as directional; ≥2-signal rule before it drives a rec |
| Planning behaviour | No honest signal today (local proxies are weak) | **[Future, OTel-gated]** — do not ship a claim on the weak proxy alone |
| Conversation structure | Session-shape stats only; scope ambiguous | **[Future]** — needs a design pass (see §19 open question) |

**Kills:** any "true accept/reject" claim from local-log proxies (overclaim risk — label as proxy
or omit); the always-on resident desktop collector as a near-term lever (superseded by Manual Sync,
2026-07-11 — ~95% of the signal at 1/10 the cost); any "time saved" telemetry category (METR dead
end). **New bet:** a per-person **signal-coverage indicator** — two `person`-level rows are
indistinguishable even when one has 3 sources and another has 1; a rec engine that silently
recommends *less* to under-instrumented people is a quiet honesty violation.

---

## 5. Metrics, Scores & Benchmarks

The problem was never that Revealyst *measures* — it's that it stopped at the number and handed
the user a naked "Score 74." **Keep the engine, change the surface.** The versioned, weighted,
closed-vocabulary scoring engine with honesty rules baked into the evaluator is good infrastructure
— do not rewrite it.

**Two measurement layers, two presentation contracts:**
- **Individual:** the raw 0–100 is **demoted from headline to expandable diagnostic**. The person
  sees **band + narrative + next skill** — a marker-level breakdown (which of ~11 proficiency
  markers are strong/weak) as the primary UI, with a composite level (L0 Dormant → L4
  Orchestrator) as a *secondary, shareable* label. A single blended individual "AI Health" number
  is **killed** — that's "Score 74" in a mascot costume.
- **Team / Exec:** numbers stay. CTOs and boards want numbers and have a vocabulary for them. The
  already-built **AI Maturity Model** (Breadth/Depth/Consistency axes, L0–L4, QoQ trajectory,
  plateau detection, 8 board numbers, each with a `measured/modeled/directional/not_measured`
  confidence tier) *is* the Team + Executive Intelligence pillar — it needs a page, not a redesign.

**Benchmarks are three different claims — never blur them:** (1) **your own past self** (lead with
this everywhere — cheapest, most motivating, least risky per behavior-change evidence); (2)
**peers in your org** (aggregate-only percentile/concentration, math exists); (3) **the outside
world** (today a `draft` modeled fixture, honestly labeled unverified — the real cross-org
k-anonymous version is gated on consent volume, not code).

**Honesty rules (inherited, non-negotiable):** a ratio needs both sides or it's *omitted*, never
zeroed; no signal → no row, never a fabricated zero; directional claims need ≥2 corroborating
signals before influencing a level. Reuse the `MATURITY_NOT_SCORED` "what we don't measure and why"
pattern verbatim for the individual proficiency surface's refusal list.

**Kill:** showing an individual a fixed personality label ("you are a Skeptic") — a person-focused
verdict that backfires ~1/3 of the time; it may survive only as an *aggregate cohort* lens for
managers.

---

## 6. Insights & Coaching

The coaching loop already works and is honest: recommendations are gated centrally on a measured,
weak, sufficiently-weighted component, carry a guidance-not-measurement disclaimer, and dedupe by
signal group. The gaps are **scale**, **evidence**, and an **unnamed taxonomy**.

**Reconciling "growing catalog" with tripwire G6 ("static content over engines") — the central
design decision of this pivot:**
- **Catalog = data.** Recommendation rows (title, body, `applicableRoles`, `applicableTools` as
  generic capability nouns, `requiredSignals`, benefit, difficulty, confidence, learning resources,
  related workflows, `signalGroup`) live in a **seeded, versioned reference table** — the exact
  precedent of the metric catalog (mig 0007) and score presets (mig 0009). Growing it is a reviewed
  PR that inserts rows with human-written, fact-checked copy.
- **Evaluator = code, frozen-adjacent.** The matcher stays what `deriveAttention` already does — a
  small, named, **closed vocabulary** of comparators over measured facts, capped and deduped
  deterministically. `requiredSignals` is *structured data drawn from that closed vocabulary*, never
  arbitrary or LLM-authored logic.
- **No LLM in selection or generation.** The only legitimate *future* (V2) LLM use is a
  non-authoritative *restatement* layer that rephrases an already-selected, human-authored entry for
  reading level/role — never one that decides *which* entry applies or invents guidance.

This preserves G6's actual intent (no per-user generation, no unreviewable formula) while honoring
VNext's "growing catalog." **Name the insight taxonomy** (data-hygiene, adoption,
effectiveness/verification, spend, agentic-transition, early-warning, narrative,
**milestone/positive** [new]) so prioritization and UI treat kinds consistently.

**Consolidation:** the "Personal Recommendation Engine" and the "AI Optimization Engine" are the
**same mechanism at different altitudes** — one engine, tiered outputs (personal/team/org). Do not
spec three engines.

---

## 7. AI Skill Progression (the AI Growth Journey)

**"Duolingo for AI proficiency" is a values analogy to honor selectively, not clone.** Duolingo's
loop is *doing the lesson in the app* with instant right/wrong feedback; Revealyst's loop is *doing
the real work in Claude Code/Cursor* and *reflecting it back* — there is no exercise substrate and
no instant-correctness signal. Keep the **structure** (clear current level, one obvious next step,
visible progress, milestone recognition, spaced return); **drop the extrinsic chrome** (streak
flames, XP currency, leagues, hearts). Several of those mechanics both fail the behavior-change
evidence *and* are structurally impossible under self-view-only privacy (leagues need visible peer
rank).

**The Growth Journey is a composition, not a new engine:** it assembles existing lib outputs
(maturity, proficiency markers, milestones, agentic-adoption trend, digest) into one coherent
self-view surface — cheaper than the sum of its parts. It must **not** become a third ladder: the
**org matures** (maturity model), the **person progresses** (proficiency band) — those are the only
two scales; no "AI Coach XP."

| Capability | Tier | Why |
|---|---|---|
| Milestone catalog (first agent session, breadth threshold, N-week cadence) surfaced *immediately*, not digest-only | **MVP-adjacent** | Cheap positive reinforcement; extends existing `isNewBest` plumbing |
| "No daily streak" as a *decision* (weekly consistency with forgiveness, or none) | **MVP decision** | Prevents a later gimmick regression; streaks-without-forgiveness are a documented trust risk |
| "Next best thing to learn" as ONE persistent card (not regenerated daily) tied to catalog + learning path | **V1** | Literally VNext's definition of the primary IP |
| Marker-level proficiency breakdown (self-view), composite as secondary label | **V1** (rides F3.1–F3.3) | Avoids recreating "one number to hate" |
| Learning-path content (static curricula keyed to band) — merged with "learning goals," one system | **V1** | Sequences the catalog into a journey; avoid two parallel content models |

---

## 8. Individual, Team & Shared-Account Capabilities

**Individual.** Extend the *existing* self-view machinery to every person (inside or outside a team),
not a parallel system. Default tone is self-coaching, never surveillance.

**Manager.** Aggregate-only is already a hard architectural invariant, not a policy:
`assertTeamOnlyPseudonymized` throws if any surfaced score carries a real name, any segment lists
members, or any shared-account flag exposes an account identifier. VNext's "managers never inspect
individual recommendations" is therefore *already the codebase's default posture* — the rec engine
must inherit it. Treat "Private" as the permanent default; never assume a manager can see individual
recs even when visibility mode is loosened for names.

**Shared accounts.** Handled honestly and guidance-first today (per-user keys → migrate shared
logins → reconcile identities); detection surfaces flags aggregate-only. Shared accounts count
**resolved identities only** and unresolved subjects are surfaced **but not billed** (frozen
`tracked_user` contract).

**Hard prerequisite (findings, not suggestion):** desktop/local data from an opted-in Team-org
member must feed **only that person's private self-view** — never team rollups, never any
manager-readable surface, never billing — until an ADR lands (a) a provable exclusion audit
predicate, (b) dual-source dedup (a person visible via both an admin API and the local agent must
not double-count), and (c) surfaced-not-billed treatment. **The Personal Companion cannot ship
inside Team orgs until this ADR exists**, or the flywheel breaks at exactly its conversion moment.

---

## 9. Manual Sync Workflow

Manual Sync is the shipped, approved, low-cost data path for Claude Code local data (two-command
copy-paste, staleness-aware badge, score-recompute-on-ingest). It is the MVP data path — keep it.
But it has a real tension with the "daily companion" promise that Spec v4 must resolve, not paper
over:

- **Cadence math fights the daily promise.** The user must remember to run a command roughly every
  ~15 days or lose history permanently. A product built on "run a CLI command every two weeks" is
  not literally a daily-streak product. **Resolution:** decouple the daily companion *content*
  cadence from *data* freshness (daily nudges draw on the last sync) — this is the real answer, not
  a UX trick.
- **Same-day reward is structurally impossible** (recompute anchors on the previous day). The
  immediate, same-click reward must be something other than the score: e.g., "this sync captured
  340 sessions across 12 days — here's one thing you did well," from data already computed.
- **Transparency:** surface an inline "here's what this sync sent" summary (event/day counts,
  allowlisted field names) after every sync — the same instinct as the Team-org opt-in transparency
  panel, at lower cost.
- **Two "sync" mental models** live on one page (one-click connector poll vs. run-a-CLI-command) —
  separate them in copy so users don't expect the CLI path to behave like a connector.

**Hard guardrails (reaffirm as UX, not just architecture):** never a drag-and-drop "upload your
logs" flow, never a browser-persistent-grant sync — both are categorically rejected (content has
already left the device by the time server-side stripping happens).

**Future, demand-gated:** a resident/cadence-aware agent is *demoted, not dead* — the go/no-go
rides on the `last_success_at` cadence telemetry the plan already commits to collecting. The pivot's
daily framing raises the bar on "enough cadence" and should *accelerate the discussion*, not
silently assume always-on collection.

---

## 10. Dashboards & Reports

The current product is **already dashboard-itis** by VNext's own definition (11+ pages, a 13-panel
team overview, a "flagship" Custom Index Builder that makes *more* metrics). VNext says explicitly:
not more dashboards, not more charts, not more metrics. **Resolve by consolidation onto exactly
three audience-scoped surfaces**, treating every existing panel as a candidate *card*, not a page:

- **Personal Companion (daily/weekly):** one home per person (fixes the #1 gap) — Growth Journey
  card (level + next skill + why + benefit) + a person-scoped coaching card + the weekly digest
  content reused in-app. Daily = a single nudge card, not a dashboard.
- **Team Intelligence:** one screen curated to VNext's named set (Team AI Health, maturity, training
  opportunities, benchmarks, champions, blockers) — the 13 panels fold into ~5 cards.
- **Executive:** a monthly narrative one-pager = the maturity "eight numbers" + composed narrative,
  with Spend Governance folded in as a line, not its own page.

**Reports/exports:** the weekly digest exists (extend). A **monthly Executive narrative
export/email does not exist** — a real gap; weekly cadence can't serve exec honestly. **Add
board-ready CSV/export** (neither Revealyst nor Larridin serves the CTO's actual deliverable — a
board slide — today; open ground).

**Kill / consolidate:** demote **Custom Index Builder** from "V1.5 flagship" to a shipped-but-not-
headline feature (it serves the old CTO persona, not the pivot thesis); fold the thin `/people` and
`/teams` roster pages into Team Intelligence + Settings; kill standalone correlation/anomaly panels
(keep the *synthesis* in the narrative, drop the standalone charts).

---

## 11. Recommendations & Automation

Pull apart two things VNext's "Phase 4 — Automation" conflates:
1. **Automating Revealyst's own notifications about Revealyst's own data** — safe, in-thesis, mostly
   shipped. Build: budget-threshold email alerts **[MVP]** (Larridin has *zero* budgets — a marketed
   governance moat at near-zero cost), recommendation snooze/dismiss + digest opt-out **[MVP]**,
   renewal reminders **[V1]** (needs a manually-entered contract-date field — no vendor reports it).
2. **Revealyst taking action inside third-party tools** — a *different, riskier product*. VNext's own
   examples ("Response automation," "Automate content generation," "Spreadsheet automation," "Org AI
   assistant") quietly cross this line. **Reframe every such catalog entry** as "try doing X using
   capability Y in tool Z" (a suggested workflow + deep-link — in thesis), never "Revealyst does X
   for you." Write access to a customer's seats/tools multiplies breach blast-radius, duplicates the
   vendor's product, and becomes a second product line no solo maintainer can carry.

**Optimization categories map onto existing modules, not new engines:** Personal = workflow/feature
recs (shipped catalog); Team = training-opportunity surfacing via the aggregate-only lane
(plateau/concentration, shipped); Org = reduce-spend/consolidate-vendors via cost-per-unit +
dark-seat findings (spend-governance, shipped). This is assembly/labeling, not new engineering.

**Define one "suggested action" taxonomy** (link-out doc · in-product Revealyst setting ·
deep-link to vendor settings) centrally, so the catalog doesn't grow inconsistent action types.
**"AI champions" / adoption-blocker surfacing** needs a `MIN_PEOPLE`-style floor before naming an
implicit champion in a small team (de-anonymization risk) even at manager level.

**Kill:** an "Ask AI" NL-query surface (a chat box is how coaching proposals accidentally
re-introduce free-text/LLM/prompt-content adjacency) — superseded by the read-only MCP-server bet
(§17). Third-party write automation and an open-ended "Organization AI assistant" stay
**Future / never-as-stated**, each requiring its own named customer trigger + ADR + DPA review.

---

## 12. Privacy & Trust

**Privacy is the moat *and* is functionally required for the loop to work at all.** The bottom-up
thesis depends on someone opting in *voluntarily*, and voluntariness is only real — not just
marketing — when the data literally cannot reach a manager.

- **"No prompt content. Ever." is a hard architectural guarantee, not a policy** — enforced at three
  independent points: on-device allowlist reader (denylisted content is *never read*, not
  filtered), a server-side bound on the free-text `dim` field, and content-flags-off-by-default +
  scrubbing in the planned OTel receiver. Three enforcement points for one guarantee is what a
  "privacy as a settings slider" competitor cannot retrofit. Market it — lead with it in Companion
  onboarding, not buried on a security page.
- **Team-mode ≠ Personal-mode privacy math.** Employee consent is *not* a valid GDPR basis for
  workplace monitoring (EDPB 05/2020); Germany's BetrVG §87(1)(6) triggers on monitoring
  *capability*, not intent. The only sub-case that is both legally clean and product-honest is
  **self-view-only**: when no manager-readable surface exists, "objectively capable of performance
  monitoring" has nothing to attach to.
- **Self-view-only is enforced by an audit predicate, not just UI**, for both Personal-plan and
  Team-opted-in individuals. Team/Exec surfaces are aggregate/pseudonymized-only; named reveal is
  gated behind explicit, logged admin action.
- **Retention/deletion discipline:** raw payloads purged ~90d; account deletion purges via the
  CI-enforced purge tripwire — every new person-scoped table (Roles, Recommendations, Outcomes) must
  register into that sweep on day one.

**Kills:** any Team-org design where person-level desktop/OTel data reaches a manager-visible
surface, however "opt-in" framed (the sub-case-B trap — legal *and* product); org-deployed endpoint
agents / MDM binaries; raw log/folder upload of any kind.

**New bets:** publish a **public, inspectable "what we collect" schema page** generated from the
actual device allowlist (not a paraphrase) — competitors with server-side-opaque collection can't
copy it; instrument **opt-in rate as a leading indicator** ("privacy enables adoption" as a measured
hypothesis, not a slogan). **Open item:** narrative team copy ("your champions are 3 people") may
leak identity more easily than a pseudonymized number — run the copy through the adversarial content
fact-check (W3-N) before Team Intelligence ships.

---

## 13. Product Differentiation

The moat is **not** the recommendation *content* (generic "try Agent mode" is free everywhere and an
LLM will write plausible tips for nothing). The moat is three structural facts a competitor cannot
retrofit:

1. **Grounded in the person's own measured, cross-vendor behavior** — cross-vendor identity
   resolution + the attribution honesty ladder is genuinely hard and compounds with every connector.
2. **Privacy enforced at the data layer** — prompt content is structurally impossible to ingest,
   which is exactly what makes daily voluntary use plausible where a monitored employee would never
   open a "coaching" app.
3. **Vendor neutrality** — Revealyst can honestly say "route this to Claude Sonnet" or "you're
   underusing Cursor Agent mode vs peers"; a vendor's own admin panel structurally cannot.

**Vs Larridin (the funded competitor doing this via the forbidden mechanisms):** Larridin ships
fluency scoring, percentiles, and workshop recs — proving the market — but via prompt-content
ingestion, a browser extension + desktop agent, a UI-only privacy threshold *contradicted by its own
API*, and unpublished headline metrics (CAV, "AI Slop Index", `estimatedTimeSaved`, null `aiRoi`).
**The individual / self-serve / privacy-first version of this space is genuinely open** — Larridin
has no self-serve motion, no free individual tier, enterprise-sales-only. That is the wedge Larridin
*structurally cannot copy* without abandoning its strategy. Counter-position writes itself: *published
formulas vs unpublished CAV/Slop · data-layer privacy vs a UI slider · $0/$2 self-serve vs $50K+/yr
sales · a coach you'd open vs a dashboard your manager checks.*

**Double down on the defensible asymmetries:** published/versioned score formulas + attribution
ladder + honesty gaps; the **telemetry-derived AI Maturity Model** (every incumbent's is
survey-based — this is a market-first artifact deserving flagship treatment); shipped spend
governance (Larridin has none); shared-account detection as an honesty feature; minutes-not-MDM
onboarding.

---

## 14. Features to Exclude (the NOT-list)

Every item is grounded in a standing tripwire, an implementation-plan guardrail (G1–G10), or the
Larridin "Never" tier — none inferred. The VNext brief is aspirational; read literally, several
bullets re-introduce a tripwire the fleet already paid to learn. Spec v4 should cite this list
*against* those bullets, not silently drop them.

- **No per-user LLM-generated coaching text** (G6). The "engine" is a curated, versioned, data-backed
  catalog matched to measured gaps — never an LLM writing bespoke copy per person.
- **No browser extension, desktop proxy, or any capture beyond sanctioned connectors/agent/OTel.**
- **No prompt-content ingestion in Team mode, ever.**
- **No time-saved / ROI-% / "AI Helps-Hurts" verdicts.** "Expected impact" renders qualitative /
  adoption-based ("X% of similar users who tried this raised agentic share"), never hours/dollars.
- **No per-person quality, velocity, or AI-vs-human authorship scores.**
- **No shadow-AI *estimation*** — state the gap, never model it.
- **No manager visibility into any individual recommendation or coaching content** (hard, code-enforced).
- **No formula DSL / per-tenant custom scoring expressions** (Custom Index Builder stays a closed
  vocabulary; never person-level).
- **No enterprise procurement machinery** (SSO/SAML/SCIM, MDM, HRIS/org-chart sync) — trigger-gated on
  a first Enterprise customer, never speculative.
- **No full DORA/dev-intelligence suite; no GitHub outcome layer** without its own ADR + DPA review —
  this bounds the "Outcomes" entity to "did the person engage/act on the rec," never "did shipped
  code quality improve."
- **No "AI news" editorial/curated content feed** — unbounded solo-founder content-ops treadmill; if
  ever built, derived/automated (syndicated changelog diffs), never editorial.
- **No third-party write automation** ("response/content/spreadsheet automation *performed by*
  Revealyst") — a different product.
- **No second B2C funnel for Personal mode** (delivered on the existing org-of-one architecture).
- **No non-engineering role libraries in MVP or V1.**
- **No Slack/Teams channel in MVP/V1** (email first).
- **No literal Duolingo mechanics** (streak flames without forgiveness, XP currency, leagues, hearts).
- **No Kafka/ClickHouse/separate ML service.**

---

## 15. Roadmap — MVP / V1 / Future (feasibility-graded)

Effort grades: **S** = lib/UI PR · **M** = new surface/connector harvest (maybe 1 ADR) · **L** = new
table + fetch layer + ADR + migration + tenant-isolation + purge registration · **XL** = multi-table,
multi-surface. **The MVP boundary is a product boundary, not an engineering-phase boundary** — its job
is to test the §0 bet, which means coaching content *and* its delivery channel must land together.

| Capability | Grade | Tier | Note |
|---|---|---|---|
| Personal daily coaching card (recs from measured gaps) | S | **MVP** | `deriveAttention` + catalog seed exist |
| **Weekly progress digest** (pulled forward from plan Phase 2) | M–L | **MVP** | The habit mechanism; a dashboard nobody revisits doesn't prove the bet |
| AI Growth Journey UI (level replaces raw score) | M | **MVP** | Composition over the existing maturity model; no new storage for v0 |
| Wire polled-but-unused signals + workflow-diversity-as-first-class | S | **MVP** | Cheapest wins, zero new privacy surface |
| Optimization metadata (impact/difficulty/confidence/action) on a rec | S | **MVP** | Type extension; stays G6-compliant |
| Team Intelligence (aggregates, benchmarks, champions) + Exec 8-number report | S–M | **MVP** | Mostly built; org report is the remaining piece |
| Budget-threshold email alerts; within-org percentiles; board-ready CSV export | S | **MVP** | Cheap Larridin-neutralizing wins |
| **Recommendation catalog as data** (reverses G6, by ADR) | L–XL | **V1** | Batched read design *stated up front* (perf floor) |
| **Roles entity** | L | **V1** | Before any role-specific content; real FK target for `applicable_roles` |
| Per-individual self-view companion inside Team orgs | M–L | **V1** | Gated on the sub-case-C ADR (§8) + audit-predicate generalization |
| Claude Code **OTel receiver** | L | **V1** (gates Future) | Load-bearing for 3 of 4 missing signal families |
| Proficiency band + learning paths (self-view) | M–L | **V1** directional → **Future** measured | Capped at *directional* until OTel lands |
| Weekly digest as Growth-Journey delivery vehicle | M | **V1** | Rides existing SES sender |
| **Outcomes entity** | XL | **Future**, demand-gated | Only concrete signal is the deferred GitHub layer (ADR+DPA); don't ship a hollow table |
| Role expansion beyond Engineering | L–XL | **Future**, evidence-gated | **No honest telemetry source exists today** (§19) |
| Context usage / planning / conversation-structure signals | L each | **Future**, OTel-gated | |
| Real cross-org k-anon benchmarks; read-only MCP server; pulse survey | — | **Future** | Sequenced behind personal-value proof |
| Enterprise connectors / SSO / directory sync | — | **Future**, trigger-gated | First Enterprise customer only |

**MVP exit gate (new — nothing defines one today):** a sustained N-week weekly-digest open/return
rate on the founder's own dogfooding org before any Team-tier or role-expansion investment. Without
it, "prove voluntary daily use" is a slogan, not a checkpoint.

---

## 16. Sequence-These-First (load-bearing infra — not features)

1. **Modularize `org-scope.ts` (1,901 lines) / `schema.ts` before Roles, Recommendation-catalog, and
   Outcomes land.** Three new org-scoped tables each bolt onto already-frozen monoliths; the W4
   fan-out lesson is that this gets worse, not better, under parallel work.
2. **Generalize the `assertTeamOnlyPseudonymized` audit predicate before the first self-view surface.**
   It's a hand-written check over exactly 3 surfaces; a 4th that isn't added passes *vacuously* — a
   failure mode already recorded once. Make completeness test-enforced.
3. **Fire the OTel receiver spike now, in parallel** — it doesn't block on Roles/catalog and gates 3
   of 4 promised behavioral signal families and all *measured* (vs directional) proficiency.
4. **Roles before any role-specific recommendation content.**
5. **Recommendation-catalog-as-data ships with the batching design in the ADR** — one per-org read,
   in-memory per-person eval, never N per-person round trips (the ~500–670ms per-round-trip floor
   turns a naive per-person lookup into a multi-second page).
6. **Outcomes stays Future, explicitly, until a real outcome signal exists** — a table that's always
   empty reads as "no outcome," not "not measured" (an invariant-(b) trap).

---

## 17. New High-Impact Bets (research-grounded, ranked by impact × confidence)

1. **Outcomes loop (rec shown → acted/dismissed → did the signal move next period).** *The single
   highest-leverage new primitive.* It turns "we think the engine works" into "we measured it works"
   — a claim Larridin structurally cannot make (their headline metrics have no published methodology).
   A lightweight self-view-only "mark as tried" + a passive before/after check reuses existing delta
   plumbing. Confidence: high on value.
2. **Perceived-vs-measured pulse panel** — a 2-question "how much faster do you feel?" paired against
   the telemetry-derived proficiency signal, shown back to the individual. The most direct
   productization of Revealyst's strongest external evidence (METR) — a panel *only an honesty-first
   product can ship*. Confidence: med-high (mechanism evidenced; user reaction to being told they're
   miscalibrated is untested).
3. **Concentration / champion-dependence index** as a first-class Team AI Health metric — "is adoption
   broad or fragile?" (operationalizes MIT's learning-gap finding). Cheap, data in hand, nobody
   surfaces it. Confidence: high.
4. **Plateau / abandonment early-warning** as a proactive alert — answers "are we the 5% or 95%"
   before it's too late. Confidence: med (threshold tuning needs fleet data).
5. **Telemetry-derived AI Maturity Model as a marketed, market-first artifact** (its own page, board
   export, launch) — every incumbent's maturity model is survey-based. Confidence: high on
   derivability, med on calibrated thresholds.
6. **Read-only MCP server over org analytics** ("ask your own Claude about your AI adoption") instead
   of building an in-app NL-query clone — fits an AI-native buyer, cheap on Workers, and structurally
   can't leak individual data the way Larridin's REST API does. Confidence: med.
7. **Honesty-gap trend as a visible progress metric** ("92% of usage person-attributed, up from
   71%") — turns an internal discipline into visible product value only an honesty-first product can
   show. Confidence: high (trivial to compute).

---

## 18. Consolidations & Kills (cross-cutting summary)

- **One engine, tiered outputs** — collapse "Personal Recommendation Engine" + "AI Optimization
  Engine" into a single system; do not spec or build two.
- **AI Growth Journey = presentation over the Maturity Model + Behavior Intelligence**, not a new
  build; and not a third scoring ladder.
- **Coaching recommendations and the "Recommendation Library" are one system at two maturity stages**
  — extend, never fork.
- **Merge cost-optimization suggestions into the existing spend-governance family**; merge
  "learning goals" and "learning paths" into one content model.
- **Kill list (headline):** "Score 74" as the individual headline · individual personality labels ·
  AI news feed · literal Duolingo chrome · third-party write automation · "Ask AI" chat surface ·
  standalone correlation/anomaly panels · Custom Index Builder as *flagship*.

---

## 19. Open Questions & Decisions Needed (founder sign-off)

1. **Digest into MVP vs V1.** This document moves the weekly digest into MVP (the plan sequences it
   into Phase 2). Rationale: the bet isn't testable without a delivery channel. *Needs sign-off.*
2. **Custom Index Builder demotion** from "V1.5 flagship" to shipped-not-headline. *Needs sign-off.*
3. **Phase 3 (all knowledge workers) has no honest telemetry source.** The only org-wide cross-role
   capture is a browser extension (permanent tripwire). Before any Phase-3 date, a dedicated research
   pass: can M365 Copilot / Google Workspace admin APIs fill this the way GitHub Copilot does for
   engineering? *Do not schedule role expansion until answered.*
4. **"Conversation structure" scope** — does it mean more than turn-count/session-length? Anything
   richer likely collides with the no-prompt-content stance. *Clarify before a V1 design.*
5. **Daily cadence mechanic.** The evidence says weekly-with-forgiveness or no streak at all; VNext's
   "Daily" bucket implies more. Resolve explicitly (this document recommends: daily *content*, no
   daily *nag/streak*).
6. **Resident-agent go/no-go** — the pivot's daily framing should *accelerate* this discussion; the
   decision rides on `last_success_at` cadence telemetry.

---

## 20. Evidence vs Assumptions (appendix)

**Grounded in code/docs:** the market/connector commoditization (Spec V3 §2); the individual
self-view gating on `org.kind === "personal"`; the static 7-entry coaching map; the built maturity
model with confidence tiers; `assertTeamOnlyPseudonymized` as a hard invariant; the three-point
privacy enforcement (device allowlist, server `dim` bound, OTel scrub); Manual Sync's cadence math
and previous-day recompute anchor; the sub-case-C desktop-collector decision + its four build gates;
the OTel receiver being unbuilt; the perf floor; the Larridin capability map and its four documented
weaknesses; METR / MIT-NANDA / Kluger-DeNisi / expert-vs-novice findings (research docs, cited
inline).

**Assumptions / recommendations (this document's judgment, not settled):** that the voluntary-return
loop forms (the §0 bet, untested); that digest belongs in MVP and Custom Index Builder should be
demoted (§19 items 1–2); that P1 splits into junior/senior hooks; that the Outcomes loop is the
single highest-leverage new bet (research names the entity but doesn't rank it this highly); user
reaction to a perceived-vs-measured panel; the effort grade on Outcomes and role-expansion (XL,
extrapolated). Non-engineering-role JTBD content in the VNext brief is an unsourced hypothesis with
no telemetry source and is treated here as a scope risk to gate, not a validated requirement.

---

*Produced by fleet orchestration: seven parallel domain strategists (product, UX, telemetry,
metrics, AI-workflows, research, architecture/feasibility) synthesized into a single direction.
This is a direction document; Product Spec v4 turns it into committed, contract-level scope — every
new org-scoped table (Roles, Recommendation catalog, Outcomes) requires an ADR, a migration, a
tenant-isolation registration, and a purge registration before it merges.*
