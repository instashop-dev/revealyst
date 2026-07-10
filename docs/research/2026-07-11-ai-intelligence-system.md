# Revealyst AI Intelligence System — Product Research Report

**Date:** 2026-07-11 · **Author:** AI Product Research Lead (orchestrated fleet: 10 parallel
research agents — 4 repo-grounded product streams, 6 external web-research streams, 100+ cited
sources) · **Status:** Research → for founder prioritization. Nothing in this document changes
code, contracts, or roadmap by itself.

**Mission:** design the complete intelligence loop —
**Data → Metrics → Insights → Recommendations → Coaching → Behavior Change → Measurable Improvement**
— that takes Revealyst from an honest reporting dashboard to the definitive AI productivity and
intelligence platform for individuals and teams.

**Evidence discipline:** every claim is labeled. **FINDING** = verified in the repo (file:line) or
cited to an external source. **ASSUMPTION** = explicit unverified inference. **RECOMMENDATION** =
our synthesis, for the founder to weigh. Product-state claims were fact-checked against the code by
a reviewer that did not write this prose (invariant-b content rule, per the W3-N/W3-P lessons).

---

## 0. Executive summary

**Where the product is (FINDINGS).** Revealyst today is a *descriptive, honesty-first analytics
dashboard*: 26 canonical metrics across 5 sources, three team score presets (Adoption / Fluency /
Efficiency) built from a deliberately closed 4-aggregation vocabulary, personas, modeled
benchmarks, budgets, and a Custom Index Builder. Its one action surface (`deriveAttention`,
`src/lib/score-insights.ts`) recommends only *data hygiene* (fix a connection, reconcile
identities) — never *adoption improvement*. Spec V3 scoped a Coaching feature (score-gap →
guidance mapping) and it was cut under pressure (second in the cut order, after ChatGPT-export
upload); the shipped "coaching" is band interpretation copy. There is no anomaly detection, no forecasting, no raw-metric
period-over-period, no within-org percentiles, no digest/notification loop, and no maturity model.

**What the evidence says (FINDINGS).** Four load-bearing external results shape everything below:

1. **Perceived productivity is not real productivity.** METR's 2025 RCT: experienced devs were
   19% *slower* with AI while believing they were 20% faster. Any "time saved" number a
   metadata platform shows is fabricated. Revealyst's honesty invariant is not just ethics — it is
   the scientifically correct position, and competitors who claim productivity uplift are
   overclaiming.
2. **Adoption is nearly saturated; effectiveness is the frontier.** 90% of devs use AI (DORA
   2025); 78% of orgs use it somewhere (McKinsey) — yet only ~5–6% convert it to measurable
   P&L impact (MIT NANDA's 95%-pilot-failure stat; McKinsey's 6% high performers). The cause is
   an organizational *learning gap*, not model quality. "Who's using AI" is a dead metric;
   "who's getting *better* at AI, and is it sticking" is the product.
3. **Skill is real, behavioral, and partly visible in metadata.** Anthropic's expert-vs-novice
   telemetry shows hard splits (experts steer planning, delegate execution, drive ~2.4× more
   agent work per prompt, recover troubled sessions 15% vs 4%). Roughly 9 of 11 skill markers
   have metadata-observable proxies; the novice→proficient transition is where most gains live.
4. **Coaching loops work only under specific conditions.** Feedback backfires ~1/3 of the time
   when it targets the person rather than the task (Kluger & DeNisi); learning goals beat
   performance targets for novel skills; past-self and similar-peer comparison motivates while
   leaderboards demoralize; workplace monitoring-for-control destroys trust. The resolution:
   **individual data belongs to the individual; managers coach the system, not the person** —
   which is already Revealyst's architecture.

**The market opening (FINDINGS).** Competitors split into single-vendor native consoles (free,
siloed, commoditizing fast) and git/PR-inference enterprise platforms (attribution "stops at the
PR level", manager/ROI-framed, $50K+ ARR). Nobody serves: (1) cross-vendor identity-resolved
per-person normalization from admin APIs, (2) individual proficiency coaching from measured real
usage, (3) privacy-first pseudonymized team analytics, (4) the individual/org-of-one buyer. All
existing AI maturity models (Gartner, BCG, DORA, DX, Deloitte) are survey-based — **a
telemetry-derived maturity model does not exist in the market**.

**The strategy in one line (RECOMMENDATION).** Concede the raw per-tool numbers to the free
vendor consoles, and own the layer they structurally cannot build: **normalized cross-tool truth →
proficiency signal → personal coaching loop → telemetry-derived maturity** — privacy-first by
construction, honest about every inference.

**Top 5 moves (RECOMMENDATION, full ranking in §12):**
1. **Ship the coaching loop v1** — extend `deriveAttention` with static score-gap→guidance
   recommendations + a weekly digest (Grammarly pattern). Highest leverage, mostly lib-level work.
2. **Wire the analytics already in hand** — raw-metric deltas, spend run-rate projection,
   within-org percentiles, cost-per-unit displays, agentic-adoption rate. All computable from
   existing data; none needs new telemetry.
3. **Ship the telemetry-derived AI Maturity Model (0–4)** — the market's first; derivable from
   existing frozen contracts; the CTO/board artifact that answers "are we the 95% or the 5%."
4. **Harvest the low-effort vendor fields** — Copilot `ai_adoption_phase` + PR-velocity block,
   Cursor tab/apply/event-cost fields. Low effort, fills proficiency-signal gaps.
5. **Build the Claude Code OTel receiver** as the flagship Team channel (true accept/reject,
   active time, retries, tool taxonomy) — the sanctioned path to proficiency signals no
   competitor's admin-API pull can match.

---

## 1. Method

Ten parallel single-ownership research agents, synthesized by the orchestrator:

| Stream | Ownership | Output |
|---|---|---|
| 01 Telemetry map | Everything collected today, per vendor, + gap inventory | repo-grounded |
| 02 Metrics/scoring map | Engine, presets, analytic machinery, ADR levers | repo-grounded |
| 03 UX/insights map | Every surface; where reporting stops | repo-grounded |
| 04 Roadmap/constraints | Shipped / committed / parked / forbidden | repo-grounded |
| 05 Measurement science | DORA, DX Core 4, SPACE, METR, GitClear, Faros, Stanford | 12+ sources |
| 06 Competitors | DX, Jellyfish, Swarmia, LinearB, Faros, native consoles, gateways | 40+ sources |
| 07 Adoption & maturity | MIT/McKinsey/BCG/Microsoft/Anthropic/Deloitte + maturity models | 16+ sources |
| 08 Proficiency | Expert-vs-novice behavior → metadata-signal mapping | 14+ sources |
| 09 Behavior change | Habit science + Duolingo/Grammarly/Whoop/Strava/GitHub teardowns | 20+ sources |
| 10 Telemetry surfaces | Concrete field inventories for every realistic new source | 14+ sources |

Full source URLs live in the per-stream sections below and in the appendix pointers.

---

## 2. As-built product baseline (FINDINGS, repo-grounded)

Condensed from streams 01–04; cited file:line claims were re-verified during synthesis review.

**Telemetry.** Five shipped sources — `anthropic_console`, `openai`, `cursor`, `github_copilot`
(cron→queue→poller, transactional delete-then-upsert restatement) + `claude_code_local`
(push-based agent ingest, device token, content-free by schema). 26 canonical metric keys; a
24-slot hour histogram + peak concurrency per subject/day (`subject_day_signals`); an
honesty-gap machinery with 6 gap kinds surfaced to the dashboard. Per-vendor attribution
ceilings are explicit (Copilot person-level but daily-grain-only; OpenAI shared keys →
`key_project`, costs org-only; Anthropic Console OAuth actors may be entirely absent — vendor
bug #27780; Cursor has no session concept; the local CLI has a ~30-day retention cliff).

**Metrics/scoring.** Weighted 0–100 composites over a closed vocabulary (`sum`, `avg_per_day`,
`active_days`, `distinct_dims`) + ratios; honesty rules enforced per component (ratio missing
either side → component omitted; plain → floors to 0; no signal → no score row; weakest
attribution propagates). Personas (2D adoption×fluency), score-only period deltas, modeled
(fixture, explicitly unverified) benchmark percentiles, budget threshold alerts, Custom Index
Builder (UI over the same engine, 6 guardrails). The V1.5 agentic metrics
(`agent_sessions`/`agent_requests`/`agent_active`/`ai_credits`) are seeded but **no score
consumes them yet**.

**UX.** Two dashboards (Personal self-view / Team overview), methodology, playbook, reconcile,
spend, indexes, admin. The only prescriptive path in the product is shared-accounts → playbook.
Onboarding ends before scores exist (backfill/nightly-recompute cliff) with no bridging content.
No insight emails/digests exist (the only push surface is the in-app budget banner) — but a
Workers-compatible transactional email sender DOES exist (`src/lib/email.ts`, Amazon SES v2 via
aws4fetch, wired into Better Auth verification/reset per ADR 0015), so a digest needs
scheduling + unsubscribe/frequency controls, not a new sender. No goals, no leaderboards
(deliberate), no narratives.

**Constraints that bound every proposal.**
- Tripwires (verbatim, permanent): no formula DSL · no browser extension/proxy · no
  prompt-content ingestion in Team mode · no second B2C funnel · no Kafka/ClickHouse · no
  separate ML service · no Chinese-vendor connectors.
- Invariants: every query org-scoped · never fabricate per-user numbers · frozen contracts need
  ADRs · prose is a claim surface (never present-tense unshipped capability).
- Privacy prose that must stay true: "No prompt content. Ever." · team-level pseudonymized by
  default · self-coaching, never a manager leaderboard · no KMS claims · "read-only *use*", not
  read-only scopes.
- Founder decisions in force: desktop collector = individual-opt-in only, self-view-only in team
  orgs (sub-case C, 2026-07-09, thin-client architecture, 4 build gates); OTel receiver =
  separate sanctioned Team channel; Copilot connector merged but gated behind `NLV_PENDING_VENDORS`.
- The **single biggest ADR lever**: the closed aggregation vocabulary (`src/contracts/scores.ts`)
  blocks percentile/velocity/anomaly primitives *inside scoring*; everything in `src/lib/**` is
  free to build.

---

## 3. Gap analysis

Each gap is a FINDING (present/absent in code, or evidenced in market research); the "so what" is
RECOMMENDATION.

### 3.1 Telemetry gaps (stream 01 × 10)

| # | Gap | Severity | Fill |
|---|---|---|---|
| G1 | `retries` canonical metric populated by **zero vendors** | Med | Claude Code OTel (`api_request`/`tool_decision`) — T5 |
| G2 | True edit accept/reject + hands-on `active_time` uncollected (local path scrapes JSONL only; documented OTel export unused) | High | T5 OTel receiver |
| G3 | Copilot aggregate PR-productivity block + `ai_adoption_phase` cohorts not normalized | High (proficiency signal, cheap) | T2 |
| G4 | Cursor Analytics/AI-Code-Tracking APIs (per-commit AI-vs-human lines, accept ratios) unwired | Med | T3 |
| G5 | OpenAI: only completions+costs normalized; 8 usage families ignored | Low-Med | T4 |
| G6 | `anthropic_claude_enterprise` vendor declared, no module | Med (trigger: first enterprise customer) | T8 |
| G7 | No outcome/delivery layer at all (PR throughput, review latency, cycle time) | **High** — the science says this is where AI value leaks | T6 GitHub App signals |
| G8 | Individual/Pro/Max users invisible to every admin API; local path has a 30-day retention cliff | High for Personal funnel | T7 desktop companion |
| G9 | Shadow AI (~45–50% of employees) invisible by construction | Structural | Surface as honesty gap, never estimate |

### 3.2 Analytics gaps (stream 02) — computable from EXISTING data, unbuilt

Raw-metric WoW/MoM deltas · spend run-rate projection · within-org percentiles/distributions ·
cost-per-unit displays ($/active-day, $/accepted suggestion, $/agent session) · agentic-adoption
rate (agent_active ÷ active_day) · model-mix trend over time · score-drop → component attribution
· cohort/retention curves (adopt-then-plateau detection). None needs new telemetry; most are pure
`src/lib` additions.

### 3.3 Insight/UX gaps (stream 03)

The score→action void (soft band sentence is the entire answer to "so what?") · coaching scoped
in Spec V3 then cut · onboarding-to-value cliff · terminal empty states · no self-improvement
loop in Personal mode (share loop is viral, not improvement) · manager workflow read-only (no
digest, export, annotations) · no narrative synthesis of a period.

### 3.4 Market gaps Revealyst can uniquely fill (stream 06, 07)

1. Cross-vendor, identity-resolved, per-person normalization from admin APIs (native consoles
   structurally can't; git-inference platforms stop at PR level).
2. The measured-usage → personal proficiency coaching loop (nobody does it; DX's
   "AI Recommendations" are org-level).
3. Privacy-first pseudonymized team analytics (the market is running *into* the surveillance
   backlash; every incumbent exposes per-user dashboards).
4. The individual buyer / org-of-one (zero B2B tools serve them; WakaTime measures time, not AI
   proficiency).
5. A telemetry-derived maturity model (every existing model is survey-based).

### 3.5 What is NOT a gap (deliberate, keep)

No leaderboards (correct per behavior science) · no prompt-content signals in Team mode
(correct + differentiating) · no browser extension (permanently rejected) · acceptance rate not
worshipped (correct: it is an adoption proxy that goes ambiguous at skill).

---

## 4. The intelligence system — target architecture

RECOMMENDATION. The loop, mapped onto existing seams:

```
DATA        connectors + agent-ingest + OTel receiver + GitHub App signals     (frozen ingest contracts)
  ↓
METRICS     canonical metrics + derived lib metrics + score presets            (engine + src/lib)
  ↓
INSIGHTS    deltas, distributions, anomalies, projections, benchmarks          (src/lib, new)
  ↓
RECOMMEND   static gap→guidance map ranked by deriveAttention                  (extend score-insights)
  ↓
COACHING    weekly digest + learning goals + progress meters (self-view)       (new surfaces + email)
  ↓
BEHAVIOR    if-then plans, past-self comparison, friction-reduced next actions (product patterns §9)
  ↓
IMPROVEMENT maturity level trajectory + proficiency band movement              (§10 model; re-measured
  ↺                                                                             by the same telemetry)
```

Design rules inherited from the evidence:
- **Honesty-first inference tiers.** Every derived signal carries a confidence tier: *measured*
  (vendor-reported), *derived* (computed, labeled), *directional* (inference, ≥2 corroborating
  signals required, reversible). Nothing directional is ever billed, ranked, or manager-surfaced.
- **Individual granular data stays with the individual** (self-view); managers/CTOs get
  aggregates, distributions, and system-level coaching. This is both the behavioral-science
  answer (§9) and the existing privacy architecture — the differentiator is keeping it while
  adding intelligence.
- **No metric becomes a target.** Every volume/adoption metric ships paired with a
  counterweight (cost, consistency, or honesty gap) — Goodhart mitigation as product design.
- **Static content over engines.** Recommendation mapping is static content keyed off component
  gaps (no formula DSL, no ML service — tripwire-safe and reviewable).

---

## 5. Telemetry roadmap

Per proposal: required data · calculation/collection · user value · business value ·
visualization · actionability · privacy · effort · differentiation · confidence. Effort scale:
S (<1 wk), M (1–3 wk), L (>3 wk, or infra). Confidence = how sure we are the data exists as
described and is worth it.

### T1 — Harvest Copilot per-user cohorts + PR-velocity block *(BUILD NOW)*
- **Data:** already-polled Copilot usage-metrics API: per-user `ai_adoption_phase`
  (No Cohort / Code-first / Agent-first / Multi-agent), boolean day flags
  (`used_agent`, `used_copilot_code_review_*`, `used_cli`), aggregate `pull_requests` object
  (PR create/review/merge counts, median time-to-first-review, median review cycles — added
  2026-07-07). FINDING: fields documented; connector currently normalizes only `users-1-day`.
- **Calculation:** extend `copilot/normalize.ts`; map cohorts to a `feature_used` dim or (ADR)
  a new canonical metric; PR block lands org-level (aggregate attribution, honest).
- **User value:** the vendor's own proficiency cohort ladder per person, free.
- **Business value:** proficiency signal without any new privacy surface; feeds §10 maturity.
- **Visualization:** cohort distribution bar (team), phase badge (self-view).
- **Actionability:** phase transitions are the coaching trigger ("Code-first → Agent-first").
- **Privacy:** per-user metadata already within the connector's scope. No change.
- **Effort:** S–M. **Differentiation:** Med (vendor gives it away — but only inside its silo;
  we normalize it cross-tool). **Confidence:** High.

### T2 — Cursor: wire Analytics + AI-Code-Tracking + event-cost fields *(BUILD NOW)*
- **Data:** Cursor admin API fields not yet normalized: `acceptedLinesAdded/Deleted`,
  `totalApplies/Accepts/Rejects`, `totalTabsShown/Accepted` (partially wired), per-event
  `tokenUsage`/`chargedCents`, AI-vs-human committed-lines (Enterprise), `/teams/spend` per-member.
- **Calculation:** extend existing connector; commits/PR AI-share only where the vendor reports
  it (never inferred).
- **User/business value:** true accept/apply granularity + per-person spend for the one vendor
  that reports it; strengthens Efficiency score inputs.
- **Visualization:** existing score components + spend drill-down.
- **Actionability:** acceptance-calibration coaching input (§8 marker 11, two-sided framing).
- **Privacy:** unchanged scope. **Effort:** S–M. **Differentiation:** Low alone, Med in
  cross-tool normalization. **Confidence:** High (plan-gating on Enterprise features is the
  known unknown — NLV item).

### T3 — OpenAI usage families + tagged per-user attribution
- **Data:** 8 unnormalized usage families (embeddings, images, audio, moderations, vector
  stores, code-interpreter sessions, web/file search) + `group_by=user_id` where traffic is
  user-tagged. FINDING: costs still have no user dimension — per-user spend stays underived.
- **Value:** breadth-of-usage signal (feature diversity) for API-first orgs.
- **Effort:** S–M. **Differentiation:** Low–Med. **Confidence:** Med-High.

### T4 — Claude Code Analytics API completeness + Anthropic OAuth-actor recovery
- **Data:** already-ingested endpoint; remaining levers are the `customer_type: subscription`
  actor slice (vendor bug #27780 tracked — re-verify quarterly) and cache/estimated-cost detail.
- **Value:** closes the biggest attribution hole in the Anthropic surface when the vendor fixes
  actor reporting. **Effort:** S (watch + wire). **Confidence:** Med (vendor-dependent).

### T5 — Claude Code OTel receiver *(FLAGSHIP Team channel — already sanctioned)*
- **Data:** OTLP push, org-enforceable via managed settings: `token.usage` (with
  `query_source`, `agent/skill/mcp` attrs), `cost.usage`, `lines_of_code`, `commit/pull_request
  .count`, **`code_edit_tool.decision` (accept/reject + source)**, **`active_time.total`**,
  events `tool_result` (name, success, duration), `tool_decision`, `api_request`, `compaction`.
  Content flags OFF by default; Revealyst never sets them AND defensively scrubs any
  `prompt`/`response`/`tool_input` body at the ingestion boundary (metadata-only by construction).
- **Calculation:** OTLP/HTTP endpoint on a Worker route → queue batching → the existing
  agent-ingest upsert seam (`metric_records` + `subject_day_signals` at `event` granularity).
  Fills `retries`, true accept/reject, hands-on time — three structural holes at once.
- **User value:** self-view depth (real active time vs token burn; verification habits).
- **Business value:** the richest, vendor-sanctioned, per-event Team signal; the substrate for
  the §8 proficiency markers no admin-API-only competitor can compute.
- **Visualization:** session-depth panels; verification-habit indicators; active-time vs spend.
- **Actionability:** direct coaching triggers (§9): context hygiene, plan-then-execute, verify.
- **Privacy:** content-free by default + defensive scrubbing; org-owned config (not a Revealyst
  binary); document "we never enable content flags" in the DPA (claim must match code — W3-N rule).
- **Effort:** L (the ~1-week ingestion spike is already a committed gate; storage shape reuses
  frozen contracts). **Differentiation:** **High.** **Confidence:** High on fields (documented),
  Med on Worker-runtime fit (ASSUMPTION until the spike).

### T6 — GitHub App outcome signals (tool-agnostic delivery layer)
- **Data:** PR throughput, time-to-merge, review latency, review cycles, PR size — computed for
  ALL tools, not just Copilot. FINDING: the existing GitHub App is wired ONLY for the Copilot
  usage-metrics reports API and does NOT hold repo contents / pull-requests read permission —
  this proposal requires an App-permission expansion + org re-consent (a positioning decision as
  much as a technical one; needs its own ADR + DPA review). AI-commit trailers
  (`Co-Authored-By: Claude`) ONLY as a low-weight corroboration signal (user-disableable,
  spoofable — never billing/attribution, invariant b).
- **Calculation:** repo-walk + GraphQL aggregation, org- and team-level only (person-level PR
  metrics are the surveillance trap the science warns about — aggregate by construction).
- **User value:** answers the question the science says matters most — is AI output *converting*
  to delivered work, or piling up in review (Faros: +98% PRs, +91% review time, zero org gain)?
- **Business value:** the missing Impact leg of the DX Utilization/Impact/Cost triad; the
  quality counter-metric DORA demands; likely first-unparked V2 item per Spec V3 §13.
- **Visualization:** delivery funnel (created → reviewed → merged), review-latency trend beside
  adoption trend ("adoption up 40%, review latency up 60% — your bottleneck moved").
- **Actionability:** system-level coaching for managers (the legitimate manager coaching lane).
- **Privacy:** aggregate-only by construction; no per-person PR dashboards, ever.
- **Effort:** M–L (rate limits, repo walking). **Differentiation:** High (couples usage metadata
  with outcomes under one honest attribution model). **Confidence:** High on data, Med on effort.

### T7 — Desktop companion (decided: sub-case C) + multi-CLI collectors
- **Data:** grow `revealyst-agent` per the 2026-07-09 founder decision (thin client, on-device
  content stripping, self-view-only in team orgs). Expand parsers: **Codex CLI** JSONL
  (`token_count`, model, tool calls — CAUTION: contains content, strict on-device allowlist) and
  **Gemini CLI** local OTel (`gen_ai.client.token.usage`, operation names — cleanest shape).
- **Value:** the only path to Individual/Pro/Max users (structurally invisible to admin APIs);
  extends the Personal funnel to non-Claude CLI users; fixes the 30-day retention cliff via
  always-on sync.
- **Privacy:** the four build gates already defined (§5.5 of the desktop report) — ADR with
  provable self-view exclusion, dedup rules, copy alignment, transparency panel.
- **Effort:** L (companion) + M per CLI parser. **Differentiation:** High for the individual
  market. **Confidence:** High (decision made; effort estimates are ASSUMPTIONS).

### T8 — Anthropic Claude Enterprise Analytics connector
- **Data:** per-user cost/usage/engagement across chat/Claude Code/Cowork (data from 2026-01-01),
  stable user_id, SCIM-group dims. **Trigger:** first claude.ai-Enterprise customer (per parked
  list). **Effort:** M. **Confidence:** High.

### T9 — Windsurf / Gemini Code Assist (customer-demand-triggered)
Windsurf Analytics API (PCW, LOC, tool calls, credits; per-user behind an admin toggle;
field-name schema is an ASSUMPTION — confirm at build). Gemini Code Assist **metadata logs only**
(accepted-LOC, model, user — via customer-side GCP log sink; MEDIUM onboarding friction; never
the prompt/response logs). **Effort:** M each. **Confidence:** Med.

### T10 — MCP server-side OTel *(PARK)*
Per-tool-call latency/volume/error telemetry from customer-run MCP servers. Clean but niche;
revisit when MCP-heavy orgs ask.

### Rejected (with reasons — carry into any future debate)
- **OpenAI Compliance API / ChatGPT conversation logs** — content-bearing (eDiscovery/DLP);
  violates no-prompt-content-in-Team and the brand. Use only aggregate member-activity slices.
- **Gemini prompt/response logs** — same.
- **Calendar / Slack work-context signals** — surveillance-adjacent productivity proxies;
  off-mission; Slack content is prompt-like. Reject for core.
- **Browser extension / proxy** — reaffirmed permanent tripwire.
- **AI-commit trailers as primary attribution** — corroboration only, never a per-user
  "AI-authored %" claim (invariant b).

---

## 6. Metrics catalog (proposed)

Grouped by buildability. Same 10-field discipline; compact format. "Vocabulary ADR" = requires
adding an aggregation primitive to `src/contracts/scores.ts` (percentile / growth_rate — one ADR
unlocks the whole group). "Catalog ADR" = new canonical metric key (+ seed migration).

### Group A — computable today (pure `src/lib`, no ADR)

**M1 · Raw-metric period deltas** ("tokens ↑23% WoW", "spend ↓8% MoM")
Data: existing `metric_records`. Calc: same-window comparison, reusing the score-delta guard
patterns (grain mismatch → notComparable). User value: the first question every dashboard viewer
asks. Business: table stakes for a paid analytics product. Viz: delta chips on every stat.
Action: anchors digest narratives. Privacy: none new. Effort: S. Diff: none (hygiene).
Confidence: High.

**M2 · Spend run-rate projection**
Data: MTD spend (already read by spend-governance). Calc: MTD × days-in-month/elapsed, shown
against budget; label **derived, straight-line**. User value: "will we blow the budget" before
the 100% alert. Viz: projection line on the spend card. Action: pre-emptive budget coaching.
Effort: S. Diff: Low. Confidence: High.

**M3 · Within-org distributions & percentiles**
Data: existing score rows + per-person metric rows. Calc: p25/p50/p75 across teams/persons in
`src/lib` (outside the scoring engine → no vocabulary ADR). User value: "is adoption broad or
carried by 3 people". Business: the concentration-risk question CTOs ask (Microsoft frontier
pattern). Viz: distribution strip / box markers; **cohort aggregates only in team mode, never
named ranks** (§9 P4). Action: concentration coaching. Effort: S–M. Diff: Med. Confidence: High.

**M4 · Concentration index (champion-dependence)**
Data: per-person active_day/prompt rows. Calc: top-decile share of usage (or Gini), team+org.
Value: fragility signal — MIT learning-gap pattern is "champions only". Viz: one number + band
(broad / concentrated / fragile). Action: enablement coaching targeted at the *system*.
Privacy: aggregate only. Effort: S. Diff: Med-High (nobody surfaces this). Confidence: High on
math, Med on thresholds (calibrate on fleet data).

**M5 · Cost-per-unit displays**
$/active-day, $/accepted-suggestion, $/agent-session, cost-per-person-week — as raw displayed
ratios (the Efficiency score embeds normalized variants; CTOs want the dollar figures). Ratio
honesty inherited (either side missing → not shown). Effort: S. Diff: Med. Confidence: High.

**M6 · Agentic adoption rate** (agent_active days ÷ active days)
Data: seeded V1.5 agentic metrics — currently consumed by **no score**. Calc: ratio component or
displayed rate; per person (self-view), team, org. Value: BCG says agent share of value 17%→29%
by 2028; this is the maturity frontier signal. Viz: trend line + phase pairing with T1 cohorts.
Effort: S (display) / M (new preset version — versioned data, not a contract change).
Diff: Med-High. Confidence: High.

**M7 · Model-mix trend & tier routing**
Data: `model_requests`/`model_tokens` dims. Calc: share-over-time by model tier; flag
single-model monoculture vs deliberate routing (proficiency marker #6, directional tier).
Viz: stacked share trend. Action: "you send everything to the frontier model — try routing"
(self-view only). Effort: S–M. Diff: Med. Confidence: High on data, Low-Med on inference (org
policy may force the mix — label directional).

**M8 · Consistency / active-week ratio & retention curve**
Data: `metric_records` over rolling windows. Calc: active-weeks ÷ elapsed weeks; cohort
survival by adoption week. Value: distinguishes habit from spike — the §10 Consistency axis; the
adopt-then-plateau early warning (the "95%" failure signature). Viz: cohort retention curve.
Effort: M. Diff: High (nobody shows adoption *retention*). Confidence: High on calc; ASSUMPTION
that plateau patterns are distinguishable from seasonality without tuning — needs fleet data.

**M9 · Dark-seat count & $ waste**
Data: `tracked_user` vs provisioned seats. FINDING: provisioned-seat counts exist only where a
vendor reports members (Cursor `/teams/members`, Copilot user lists); ASSUMPTION for others.
Calc: provisioned − active, × per-seat price where known (labeled estimate). Value: the single
most CFO-legible number in the category. Viz: one big number + trend. Action: reclaim/enable.
Effort: M. Diff: Med-High. Confidence: Med (data availability varies by vendor).

### Group B — need an ADR (vocabulary, catalog, or new reader) or new telemetry

**M10 · Percentile + growth-rate aggregation primitives** *(the enabling ADR)*
Adds `percentile` and `growth_rate` to the closed vocabulary → within-scoring distributions,
velocity components, anomaly baselines. One ADR, many unlocks. Effort: M. Confidence: High.

**M11 · Proficiency Signal (person-level composite, self-view only)**
Data: markers §8 — work-per-prompt (tokens-out per user turn), verification tool-calls (OTel),
context hygiene (session boundaries), model routing, agent-mode breadth (T1 cohorts), parallel
sessions (`subject_day_signals` concurrency), sustained use. Calc: weighted composite; verify +
work-per-prompt weighted highest; **≥2 corroborating signals required per marker; org-relative
band (L0–L4), confidence-labeled; never an absolute grade**. User value: the self-improvement
loop nobody offers. Business: the durable coaching wedge. Viz: band + "what moved" breakdown.
Action: per-marker coaching content (§9). Privacy: **self-view only in team orgs; never
manager-visible, never billed** (mirrors the desktop-collector exclusion contract). Effort:
M–L (needs T1 + T5 for the high-value markers). Diff: **Very High**. Confidence: Med — the
marker→skill mapping is evidence-based (Anthropic expertise study) but the composite's validity
is an ASSUMPTION until calibrated; ship as "directional", validate against self-reported
usefulness.

**M12 · AI Maturity Level (org/team composite)** — see §10. Catalog-free v1 is derivable in
`src/lib`; a scored preset variant would want M10. Effort: M. Diff: Very High. Confidence: High
on derivability, Med on level thresholds (calibrate).

**M13 · Delivery-outcome metrics (org/team)** — from T6: PR throughput, review latency, review
cycles, time-to-merge; new canonical metrics (catalog ADR) at aggregate attribution. The Impact
leg. Effort: M after T6. Diff: High. Confidence: High.

**M14 · Active-time & verification metrics (person, self-view)** — from T5: hands-on time,
edit-decision accept/reject by source, retries, tool-taxonomy counts. Catalog ADR (new keys) —
`retries` already exists and finally gets a producer. Effort: M after T5. Diff: High.
Confidence: High.

**M15 · "AI Health" composite preset (org)** — weighted blend of Adoption/Fluency/Efficiency (+
Maturity when live): one board-legible number with full component decomposition. Versioned
preset data; benchmarkable (unlike custom indexes). Effort: S–M. Diff: Med. Confidence: High.

### Group C — refuse to build (honesty boundary)

- **Time saved / hours saved / productivity %** — scientifically indefensible from metadata
  (METR); would fabricate per-user numbers. Show DX/DORA public ranges as *context*, never as
  the org's own measured number.
- **Per-person code-quality scores** — no repo/content access; even with T6, quality stays
  aggregate.
- **Automation-vs-augmentation classification per person** — Anthropic's split came from
  conversation classification we structurally can't do; at most a low-confidence org-level shape.
- **Shadow-AI estimates** — invisible by construction; state the gap, never model it into a number.

---

## 7. Insights catalog (proposed)

Derived intelligence over §6. All live in `src/lib` unless noted.

**I1 · Score-drop attribution** — when a score falls ≥N points, name the component that drove it
(breakdowns are already persisted; nothing is derived today). "Efficiency ↓12 — driven by
spend ↑40% with flat accepted output." Effort: S. Confidence: High. The single cheapest
"intelligent-feeling" feature in the backlog.

**I2 · Anomaly detection (statistical, honest)** — z-score vs trailing per-org baseline for
spend/tokens/active-users; flag >2σ excursions with the driver dim (model? person-count? one
key?). No ML service (tripwire) — rolling mean/σ in SQL/lib is enough. Effort: M. Confidence:
High. Guard: label "unusual vs your baseline", never "wrong".

**I3 · Plateau / abandonment early warning** — cohort retention (M8) crossing a falling
threshold: "12 of 18 adopters from March are inactive 3+ weeks — the classic pilot-stall
pattern." The MIT learning-gap detector; the insight a CTO pays for. Effort: M. Confidence: Med
(threshold tuning).

**I4 · Cross-metric correlation surfaces (framed, not claimed)** — adoption vs efficiency
scatter by team; model-mix shift vs cost; agentic share vs consistency. Presented as "these
moved together", never causal claims. Effort: M. Confidence: Med.

**I5 · Real peer benchmarks** — swap the modeled fixture for consented cross-org percentiles
(the seam exists: `resolveBenchmarkSource`); publish only above a k-anonymity floor (e.g. ≥20
consenting orgs per cell); until then, show public anchor ranges (DX ~60% active-rate, DORA
~2h/day median, McKinsey $3.70/$1) clearly labeled as public research, not fleet data. Effort:
M (+ the W4-R calibration gate). Diff: High — becomes the network moat as the fleet grows.
Confidence: High on mechanics, Med on time-to-critical-mass.

**I6 · Delivery-funnel insight (after T6)** — "PR volume ↑34% since Copilot rollout; review
latency ↑61% — the bottleneck moved to review" (the Faros pattern, detected honestly on the
org's own data). Effort: M after T6. Diff: High. Confidence: High.

**I7 · Monthly narrative** — a generated plain-prose summary of the period (deltas, drivers,
one anomaly, one recommendation), rendered from the same data the dashboard shows (template
composition, not an LLM service — tripwire-safe; an LLM-written variant is a V2 question).
Effort: M. Confidence: High.

**I8 · Honesty-gap trend** — attribution coverage over time ("92% of usage person-attributed,
up from 71% — reconciliation is working"). Turns the honesty machinery into visible progress.
Effort: S. Diff: High (nobody else *can* show this). Confidence: High.

---

## 8. Proficiency signal model (person-level, self-view)

FINDINGS (stream 08, key sources: Anthropic expertise study; ROPE RCT; verification-bottleneck
literature): skill is behavioral and partly metadata-visible. The 11-marker map, with the tier
each lands in:

| Marker | Signal | Tier |
|---|---|---|
| Agent-mode breadth (autocomplete→agent→multi-agent) | Copilot cohorts (T1), Cursor/CC surface mix | **Measured** |
| Sustained use | active-day cadence | **Measured** (adoption gate, not skill) |
| Work-per-prompt (delegation) | tokens-out / agent actions per user turn (T5) | Derived |
| Verification habit | test/build tool-calls after edits (T5) | Derived |
| Context hygiene | session boundaries, clears, compaction (T5) | Directional |
| Model-tier routing | model mix spread vs task shape | Directional |
| Parallel orchestration | session overlap, `subject_day_signals` concurrency | Directional |
| Plan-then-execute | tool-type sequencing (T5/CC-log) | Directional |
| Recovery vs abandon | retry/restart shapes | Directional (ambiguous — shape only) |
| Acceptance calibration | acceptance rate in healthy band | Context display only (two-sided) |
| Off-hours autonomous runs | histogram + long runs | Directional (weak) |

**What metadata can NEVER see (state in-product):** prompt quality (the #1 driver), whether
verification was meaningful, output correctness, trust-calibration direction, task difficulty,
domain expertise (the strongest real predictor — zero footprint).

**Rubric:** L0 Dormant → L1 Novice → L2 Developing → L3 Proficient → L4 Orchestrator.
Coaching concentrates on **L1→L3** (the evidence says most gains are novice→intermediate:
15%→28–33% verified success). Presentation: org-relative band + confidence label + "patterns
that correlate with skilled use" framing. Never a certified grade; never manager-visible;
never billed.

---

## 9. Coaching framework

Design principles distilled from the behavior-change evidence (stream 09) — each maps to a
concrete surface:

| Principle (evidence) | Product rule |
|---|---|
| Individual data belongs to the individual (surveillance backlash) | Coaching lives in self-view; managers get aggregates + system coaching only |
| Task-focused feedback (Kluger & DeNisi: self-focused backfires ~1/3) | Every insight names a workflow/action, never a person-judgment or rank |
| Learning goals for novel skills (Locke & Latham) | Goals are "try X twice this week", never output quotas |
| If-then plans (d≈0.65) | Each recommendation offers a one-tap implementation intention |
| Past-self + similar-peer comparison; no global leaderboards | Trend-vs-you + cohort-median only; opt-out; hide-name |
| Friction beats motivation (Fogg) | Every nudge carries the one-click next step |
| Streaks only with forgiveness; GitHub-graph is the cautionary tale | Weekly (not daily) consistency framing; freezes; manager-invisible; or skip streaks entirely |
| Reflective-endorsement test | Ship a nudge only if the user would endorse its mechanism |
| Goodhart guard | Scores stay directional; every volume metric ships with a counterweight |

**C1 · Recommendation layer v1** *(the resurrection of the cut Spec-V3 Coaching feature)* —
extend `deriveAttention` with a `recommendation` item kind: a static map from score-component
gap patterns → guidance content (low breadth → feature-adoption play; low consistency → habit
play; low effectiveness → verification/workflow play; agentic zero → agent-mode intro). Static
content = tripwire-safe, reviewable, fact-checkable. Zero new queries; renders on both dashboard
views via the existing Alert primitive. **Effort: S–M. The highest ROI item in this report.**
Confidence: High.

**C2 · Weekly digest (Grammarly pattern)** — fixed Monday cue: trend vs past-self, one
personal-best, 1–3 task-focused recommendations with one-click actions. Personal mode: full
personal digest. Team admins: aggregate digest (adoption movement, concentration, anomaly, one
system recommendation). FINDING: a transactional sender already exists (`src/lib/email.ts`,
SES via aws4fetch — ADR 0015); the remaining build is scheduled/bulk delivery, unsubscribe +
frequency controls, and digest rendering. Effort: M. Diff: Med
alone, High as the loop's delivery vehicle. Confidence: High on pattern (best-evidenced coaching
loop in the case studies).

**C3 · Learning goals + progress meters** — self-set, learning-framed goals from a curated
catalog ("adopt 3 workflows this month"), endowed-progress meter, optional opt-in sharing.
Effort: M. Confidence: Med-High.

**C4 · Onboarding-to-value bridge** — "here's what we've ingested; first scores by tomorrow"
interim state + a first-week guided sequence (connect → first score → first recommendation →
first goal). Fixes the documented cliff. Effort: S–M. Confidence: High.

**C5 · Manager/system coaching lane** — aggregate-only: concentration, plateau warnings,
delivery-funnel bottlenecks (T6), enablement suggestions ("usage is champion-concentrated —
pair-programming rotation moves this pattern"). Never per-person directives. Effort: M.
Confidence: High.

**C6 · Learning-path content** — sequenced static curricula keyed to proficiency band (L1→L2:
from autocomplete to agent mode; L2→L3: verification + context habits), sourced from vendor
best-practice guidance; content, not code. Effort: M (content-heavy). Confidence: Med.

---

## 10. AI Maturity Model (telemetry-derived — market first)

FINDING: every incumbent maturity model (Gartner 5-level, BCG 41-capability, DORA capabilities,
DX triad, Deloitte, Microsoft Frontier Firm) is survey/self-assessment-based.
RECOMMENDATION: ship the first model where **every rung is an observable signal** from existing
frozen contracts. Public vocabulary borrowed deliberately: DORA's "AI is an amplifier" framing +
DX's Utilization/Impact/Cost triad (CTOs already know them).

Three axes: **Breadth** (people/tools/features activated) · **Depth** (frequency, agentic share,
work-per-session) · **Consistency** (retention, low variance, no plateau).

| Level | Name | Team/org signature (observable) |
|---|---|---|
| 0 | Dormant | Seats provisioned, <20% active |
| 1 | Trial | 20–50% active; usage concentrated in champions; spiky weeks |
| 2 | Adopted | 50–80% active; spreading beyond champions; chat/completion-dominant |
| 3 | Embedded | >80% active; low member variance; agentic share rising; sustained ≥N weeks |
| 4 | Amplified | Uniform high use; agentic + multi-tool depth; deepening QoQ; low abandonment |

Signals per axis map to `tracked_user` (activation), distinct connectors/features (breadth),
`metric_records` cadence + agentic rate (depth), active-week ratio + cohort retention
(consistency). **Explicitly not scored** (honesty gaps, shown as such): shadow AI (~45–50% of
employees), realized business impact/ROI (inputs shown, never asserted), governance/training
maturity (offer as optional self-report, kept visibly separate from the derived level).

**Org-level report (the board artifact)** — the eight numbers CTOs/boards actually ask for
(stream 07): activation % + dark-seat $ waste · adoption vs public benchmark · maturity level +
QoQ trajectory · plateau/abandonment flag · concentration risk · cost-per-active-user (vs
McKinsey $3.70/$1 anchor, labeled) · tool sprawl + shadow-gap caveat · agentic share. One page,
answering: *"What % of what we pay for is used, how well, by how many, trending which way, vs
peers."*

---

## 11. Product recommendations & competitive posture

1. **Reposition the scores as "adoption & usage sophistication — a leading indicator"** and say
   explicitly that adoption ≠ realized productivity (DORA amplifier framing). This converts the
   honesty constraint into the trust brand, and it is the only scientifically defensible posture
   in the category. Never ship a "time saved" number; when competitors do, that is a sales
   weapon, not a gap.
2. **Concede raw per-tool stats.** Copilot/Cursor/OpenAI/Anthropic consoles give them away free.
   Every roadmap item must add value *above* the silo: normalization, scoring, coaching,
   maturity, honesty.
3. **Make the individual the moat.** The self-view + proficiency + coaching loop serves the one
   buyer nobody else serves and generates the bottom-up funnel (Grammarly motion) the
   enterprise-sales incumbents can't run. It also compounds: coaching content + calibrated
   markers improve with fleet scale.
4. **Privacy-first is a structural advantage — keep it architectural.** Pseudonymized-by-
   construction team analytics directly monetizes the surveillance backlash. Incumbents can't
   bolt this on without contradicting their content-depth roadmaps.
5. **Watch DX.** Closest on framework depth, only "AI Recommendations" in market, line-level
   attribution. If DX ships a privacy mode or individual tier, the differentiation narrows to
   the Personal funnel + price + honesty brand. Jellyfish owns the ROI narrative at enterprise.
6. **Benchmark network is the long game.** Consent machinery already exists; real peer
   percentiles at k-anonymity become the data moat no vendor console can replicate (V3 spec
   already anticipates it at >100 orgs).
7. **Pricing note (ASSUMPTION to validate):** the coaching/proficiency layer is plausibly the
   first "expansion from feature depth" lever beyond the Custom Index Builder — a
   Personal-Pro or Team-paid coaching tier — but pricing changes are out of scope here.

---

## 12. Prioritized implementation roadmap

Scoring: each dimension 1–5 (5 best). Priority = User impact + Business value + Differentiation
+ Data availability + Confidence − Effort. FINDING-based inputs; ranking itself is
RECOMMENDATION.

| Rank | Item | User | Biz | Diff | Effort | Data | Conf | Score |
|---|---|---|---|---|---|---|---|---|
| 1 | C1 Recommendation layer v1 (static coaching in `deriveAttention`) | 5 | 5 | 4 | 1 | 5 | 5 | **23** |
| 2 | M1–M5 quick analytics (deltas, run-rate, distributions, cost-per-unit) | 5 | 4 | 2 | 1 | 5 | 5 | **20** |
| 3 | I1 Score-drop attribution | 4 | 4 | 3 | 1 | 5 | 5 | 20 |
| 4 | M6 Agentic adoption rate (wire the seeded metrics) | 4 | 4 | 3 | 1 | 5 | 5 | 20 |
| 5 | T1/T2 Copilot cohorts + PR block; Cursor field harvest | 4 | 4 | 3 | 2 | 5 | 5 | 19 |
| 6 | §10 Maturity model v1 + org report | 5 | 5 | 5 | 3 | 4 | 4 | 20* |
| 7 | C4 Onboarding-to-value bridge | 4 | 4 | 2 | 1 | 5 | 5 | 19 |
| 8 | C2 Weekly digest (rides existing SES sender) | 5 | 5 | 4 | 3 | 5 | 4 | 20* |
| 9 | I2/I3 Anomaly + plateau early-warning | 4 | 5 | 4 | 2 | 4 | 4 | 19 |
| 10 | I8 Honesty-gap trend | 3 | 3 | 5 | 1 | 5 | 5 | 20* |
| 11 | T5 Claude Code OTel receiver | 4 | 5 | 5 | 4 | 4 | 4 | 18 |
| 12 | M11 Proficiency signal + C6 learning paths | 5 | 5 | 5 | 4 | 3 | 3 | 17 |
| 13 | T6 GitHub outcome layer + I6 delivery funnel + M13 | 4 | 5 | 5 | 4 | 4 | 4 | 18 |
| 14 | I5 Real peer benchmarks (verified swap, k-anon) | 4 | 4 | 5 | 3 | 3 | 4 | 17 |
| 15 | T7 Desktop companion + multi-CLI (already founder-gated) | 4 | 4 | 4 | 5 | 4 | 4 | 15 |
| 16 | M15 AI Health composite preset | 3 | 3 | 2 | 2 | 5 | 5 | 16 |
| 17 | C3 Learning goals + progress meters | 4 | 3 | 4 | 3 | 4 | 4 | 16 |
| 18 | M10 vocabulary ADR (percentile/growth primitives) | 2 | 3 | 2 | 3 | 5 | 5 | 14 |
| 19 | T3/T4 OpenAI families; Anthropic OAuth recovery | 2 | 2 | 1 | 2 | 4 | 4 | 11 |
| 20 | T8/T9 Enterprise/Windsurf/Gemini connectors | 2 | 3 | 2 | 3 | 3 | 3 | 10 |

\* items 6/8/10 score at or above neighbors but carry sequencing dependencies (6 and 8 read
better after 1–5 exist; 10 is a garnish that should ride along with any dashboard release).

**Suggested waves** (each independently shippable, one workstream per wave-item per the fleet
rules; ADR/migration numbering to be claimed serially at build time per the W4 collision lesson):

- **Wave A — "From reporting to answering" (lib-only, ~no ADRs):** ranks 1–5, 7, 10.
  Coaching v1, quick analytics, score-drop attribution, agentic rate, vendor-field harvest,
  onboarding bridge.
- **Wave B — "The CTO artifact":** ranks 6, 8, 9. Maturity model + org report, weekly digest
  (scheduling + unsubscribe over the existing SES sender), anomaly/plateau warnings.
  Positioning refresh (§11.1) lands here.
- **Wave C — "The proficiency moat":** ranks 11, 12, 14. OTel receiver spike → receiver →
  proficiency signal + learning paths; verified benchmarks swap.
- **Wave D — "Outcomes & reach":** ranks 13, 15, 16–20 as demand dictates. GitHub outcome
  layer; desktop companion (its gates are already defined); remaining connectors.

**Dependencies:** M11 needs T1 (shipped cohorts) + T5 (rich markers) to rise above
"directional". I5 needs W4-R calibration + consent volume. T6 requires a GitHub App
permission expansion (repo/PR read — the App currently holds only Copilot-metrics access) and
the founder's read on the optics: repo-data processing is a positioning question as much as a
technical one — dedicated ADR + DPA review. C2 rides the existing SES sender
(`src/lib/email.ts`); the build is scheduling + unsubscribe controls.

---

## 13. Risks & honesty boundaries

- **The overclaim trap (highest brand risk).** Every coaching/proficiency surface is one lazy
  sentence away from a fabricated per-user claim. Mitigation: the three-tier confidence
  labeling (§4), the Group-C refusal list (§6), and the standing adversarial content
  fact-check on any new user-facing prose (the W3-N rule; it caught real overclaims twice).
- **Surveillance perception.** A proficiency band visible to a manager converts the product
  into the thing it positions against. Mitigation: self-view-only enforcement in code (audit
  predicate, like the desktop-collector exclusion contract), not in copy.
- **Goodhart drift.** The moment a maturity level or score becomes an OKR, users game it.
  Mitigation: paired counterweights, directional framing, no hard targets in-product.
- **Vendor dependency.** Native consoles keep expanding (Copilot GA'd theirs 2026-02); fields
  move (the metrics-API sunset already forced one migration). Mitigation: connector-facts
  quarterly re-verification cadence; value concentrated above the raw numbers.
- **Data-scale immaturity.** Percentiles, plateau thresholds, and proficiency weights need
  fleet data to calibrate; shipping them uncalibrated invites wrong-but-confident insights.
  Mitigation: "modeled/unverified" labeling discipline already exists (benchmarks) — reuse it.
- **Effort estimates are ASSUMPTIONS.** All S/M/L sizings here are research-level, not
  planning-level; each wave item needs its own plan-mode pass before commitment.

---

## Appendix — source pointers

Repo evidence: `src/contracts/*` (metrics, scores, attribution, connector), `src/scoring/*`,
`src/lib/score-insights.ts`, `src/lib/spend-governance.ts`, `src/lib/benchmarks/*`,
`src/connectors/*`, `src/lib/agent-ingest.ts`, `packages/revealyst-agent/*`,
`docs/connector-facts.md`, `docs/score-definitions.md`, `docs/Revealyst_Product_Spec_V3.md`,
`docs/research/2026-07-09-desktop-collector.md`, ADRs 0001–0023.

External evidence (primary anchors): METR RCT (arXiv 2507.09089) · DORA 2024/2025 reports + AI
Capabilities Model · DX Core 4 + AI Measurement Framework · SPACE (Forsgren et al.) · GitClear
AI code-quality 2025 · Faros AI Engineering Impact Report 2025 · MIT NANDA State of AI in
Business 2025 · McKinsey State of AI 2025 · BCG Widening AI Value Gap 2025 · Microsoft Work
Trend Index 2025 · Anthropic Economic Index 2025 + "How Claude Code is used in practice" ·
Claude Code monitoring/analytics docs · GitHub Copilot usage-metrics API changelogs (2026-05-29
cohorts, 2026-07-07 review cycles) · Cursor Admin API docs · Kluger & DeNisi 1996 · Gollwitzer &
Sheeran 2006 · Locke & Latham · Duolingo/Grammarly/Whoop/Strava/Peloton/LinkedIn case studies ·
competitor sites/pricing (DX, Jellyfish, Swarmia, LinearB, Faros, Multitudes, Opsera). Full URL
lists are embedded in the fleet's per-stream research files (session artifacts) and inline above
where load-bearing.
