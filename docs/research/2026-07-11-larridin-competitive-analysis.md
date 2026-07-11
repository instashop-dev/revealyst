# Competitive analysis: Larridin "Scout" vs Revealyst

**Date:** 2026-07-11 · **Status:** research report (no contract changes)
**Sources:** Larridin public docs at https://docs.larridin.com (feature pages, setup guides,
integration pages, Scout API v1 reference, MCP page), crawled 2026-07-11; Revealyst codebase,
`docs/Revealyst_Product_Spec_V3.md`, `docs/Revealyst_Product_Spec_V2.md`,
`docs/Revealyst_Execution_Plan.md`, `docs/connector-facts.md`, ADRs 0001–0026, and
`docs/research/2026-07-11-ai-intelligence-system.md` (PR #151).

**Method:** five parallel research passes with single ownership — Larridin docs crawl,
Revealyst metric/scoring inventory, telemetry/connector inventory, UX/architecture/privacy
inventory, roadmap/positioning inventory — synthesized here. Larridin claims cite their doc
URLs; where a capability is inferred from their API schema rather than a feature page, that
is stated. Revealyst claims are grounded in code paths (invariant b applies to this prose:
nothing below claims a Revealyst behavior the code doesn't have).

---

## 1. Executive summary

Larridin Scout is a direct competitor on the exact thesis Revealyst owns — "who's using AI,
how well, and are we getting our money's worth" — with materially broader scope: org-wide
capture via a **browser extension + desktop agent**, a deep **Developer Intelligence** suite
(DORA, AI code share, quality, reliability), **workflow mining**, **surveys**, **policy
enforcement (block/warn)**, a ~40-endpoint **REST API**, and a beta **MCP server**. It
targets enterprises (SSO/JIT, Okta/Azure AD/Workday directory sync, MDM deployment) at an
enterprise price point (Spec V2 §11's pricing analysis lists Larridin at $50K+/yr, and Spec V2
§16's risk table notes them as the funded incumbent — "$17M/a16z"; their own docs publish no
pricing).

The breadth comes at a cost that maps one-to-one onto Revealyst's declared differentiators:

1. **Scout is surveillance-shaped.** It ingests prompt content and coding-session
   transcripts (fluency is scored from prompt quality and prompt-topic classification;
   the desktop agent captures Claude Code/Cursor/Codex transcripts), and the browser
   extension's capture scope is undocumented. Revealyst's tripwires forbid every one of
   these in Team mode, on positioning, legal (§87 BetrVG, AI Act), and maintenance grounds.
2. **Scout's privacy control is UI-only.** Its single documented control (Team Reporting
   Threshold) is contradicted by an API that returns per-employee data, per-user tool usage
   keyed by email, and free-text survey responses. Revealyst enforces team-only
   pseudonymization at the data layer (`toPersonRef`, `assertTeamOnlyPseudonymized`) and
   gates the JSON API with the same access checks as pages — the exact anti-pattern
   Revealyst's own review invariants exist to prevent.
3. **Scout's headline metrics are unsubstantiated.** Complexity-Adjusted Velocity, AI Slop
   Index, engagement score, friction score, `estimatedTimeSaved`, and the "AI Helps / AI
   Hurts" verdict have no published formula or methodology. Several (time-saved,
   per-person quality) are metrics Revealyst's honesty boundary explicitly refuses to
   fabricate. Revealyst's scores are versioned, inspectable data with public formulas.
4. **Scout has no spend governance.** Its spend module is descriptive (breakdowns only);
   its `roiCalculator`/`aiRoi` API fields exist but return null. Revealyst ships budgets,
   thresholds, in-app alerts, and run-rate projection today.

**Strategic read:** do not chase Scout's breadth — it is exactly the product the tripwires
were written to avoid, and a solo founder cannot maintain a browser extension, an MDM
deployment matrix, and a nine-module dev-intelligence suite. Instead, sharpen the three
asymmetries Scout cannot easily copy (privacy at the data layer, published formulas,
$2/user self-serve PLG), close a small number of high-leverage gaps that fit the existing
architecture (percentiles/deltas, exports, email budget alerts, OTel receiver,
content-free conversation-shape metrics, an MCP server instead of an "Ask AI" clone), and
say "never" to the rest — out loud, as positioning.

---

## 2. Side-by-side capability map

Legend: ✅ shipped · 🟡 partial/gated · 🔬 proposed/planned · ❌ absent · 🚫 deliberate non-goal (tripwire/honesty boundary)

| Capability | Larridin Scout | Revealyst | Notes |
|---|---|---|---|
| **AI adoption (coding tools)** | ✅ per-user via admin keys + agents | ✅ Adoption score, DAU/WAU, trends | Same vendor credential mechanisms (Anthropic admin key, Cursor admin key, OpenAI org key) — validates `connector-facts.md` |
| **AI adoption (org-wide, all knowledge workers)** | ✅ via browser extension + desktop agent | 🚫 (extension/proxy tripwire); V2 direction is API-based (ChatGPT Business/Enterprise) | Scout's capture scope is undocumented (their docs gap #5) |
| **AI fluency / proficiency** | ✅ composite score: prompt quality + feature adoption + use-case diversity; percentiles p25–p85 | ✅ Fluency score (breadth/depth/effectiveness), published formula; percentiles planned (Phase 1) | Scout scores **prompt content**; Revealyst is behavioral-metadata only |
| **AI tool inventory / shadow AI** | ✅ sanctioned + shadow tools, unauthorized-usage rates | 🟡 tool coverage of *connected* tools; shadow-AI stated as a gap, never estimated | Estimating shadow AI is in Revealyst's refuse list (Group C) |
| **AI governance / policy enforcement** | ✅ block + warn events via extension | 🚫 monitoring/enforcement posture rejected; ships compliance guidance (`/compliance`, DPIA, works-council playbook) instead | Enforcement requires the extension Revealyst will never ship |
| **Token spend by model/team/tool** | ✅ incl. Bedrock/Vertex/Azure Foundry/OpenRouter/proxies/OTEL/SDK | ✅ vendor-authoritative vs estimated kept separate; 3 live connectors (Anthropic, OpenAI, Cursor) + Copilot (founder-gated, shown as "Soon") + local agent | Scout is broader on sources; Revealyst is stricter on estimate labeling |
| **Budgets / alerts / projection** | ❌ descriptive spend only; ROI fields null | ✅ org budgets, thresholds, in-app alerts, run-rate projection (W4-V) | **Revealyst lead — extend it** |
| **Spend ROI claims** | 🟡 scaffolded (`aiRoi` null), pitch says "value" | 🚫 time-saved/ROI-% refused (METR RCT grounds) | Their gap #3: core pitch, no methodology |
| **Developer Intelligence: DORA / CI-CD / reliability** | ✅ via GitHub/GitLab, Linear, PagerDuty, incident.io | ❌ out of category (Swarmia/Jellyfish territory) | Quality *counter-metrics* are the flagged first V2 unpark, via vendor aggregates |
| **AI code share (AI vs human authored)** | ✅ headline metric, methodology unexplained | 🚫 as attribution-unexplained per-repo claims; 🟡 vendor-reported `lines_*`, `commits`, `pull_requests` shipped | Unverifiable attribution would break invariant (b) |
| **Velocity / quality scores (CAV, AI Slop Index)** | ✅ proprietary, no formulas | 🚫 per-person quality scores refused; org-level counter-metrics parked V2 | Counter-position: "every Revealyst score shows its formula" |
| **Workflow intelligence / time-saved mining** | ✅ friction score, automatable-workflow detection, `estimatedTimeSaved` | 🚫 requires activity capture + fabricated time-saved | |
| **Agent effectiveness** | ✅ (one-line feature page; session-level signals → outcomes) | ✅ agentic metric family (`agent_sessions/requests/active`), agentic-adoption trend, honest denominator disclosure | Revealyst's is shipped and defined; theirs is a stub page |
| **Developer sentiment surveys** | ✅ campaigns, free-text responses (individually attributed w/ role+dept) | ❌ | A privacy-honest pulse variant fits (see §5) |
| **Maturity model** | ❌ (adoption tiers only) | ✅ telemetry-derived L0–L4 ladder (Dormant→Amplified), landing + `/maturity` | **Revealyst first-mover — market it** |
| **Benchmarks** | ❌ not documented | ✅ verified-row gating + consent-based network (V3 direction) | |
| **Custom scores** | ❌ | ✅ Custom Index Builder (no-code over frozen engine, W4-U) | |
| **Shared-account detection** | ❌ | ✅ advisory flags, median-baseline heuristics | Unique honesty feature |
| **Attribution honesty ladder** | ❌ (no attribution-confidence concept in docs) | ✅ person > key_project > account, propagated via `lowestAttribution` | Core differentiator |
| **NL query ("Ask AI")** | 🟡 beta, "in active development" | ❌ | Answer with MCP, not a clone (§5) |
| **MCP server** | 🟡 beta (OAuth, `query_larridin_analytics`) | ❌ | Strong fit for Revealyst's AI-native buyer (§5) |
| **Customer REST API** | ✅ ~40 endpoints (leaks individual data past the UI threshold) | ❌ | Revealyst variant must be visibility-mode-enforced by construction |
| **Data export (CSV/board deck)** | ❌ not documented (API only) | ❌ | Open ground for both (§5) |
| **SSO / directory sync / HRIS / org chart** | ✅ Okta, Azure AD, Google, Workday RaaS, CSV; JIT provisioning; manager hierarchy | ❌ Better Auth email+GitHub OAuth; Enterprise-tier roadmap | Demand-gated (first Enterprise customer) |
| **Slack/Teams notifications** | 🟡 Slack integration listed, feature unspecified | ❌ (weekly email digest ✅; budget alerts in-app only) | |
| **Self-serve pricing** | ❌ enterprise sales motion | ✅ $0 personal / $2 per tracked user, Paddle MoR, free band ≤5 | Order-of-magnitude price asymmetry |
| **Privacy: enforcement layer** | UI rollup threshold only; API returns per-employee data | Data-layer: `toPersonRef` single decision point, strict schemas, API paywall/privacy gates match pages | **The** structural differentiator |
| **Prompt/transcript content** | ✅ ingested (fluency scoring, desktop-agent transcripts) | 🚫 structurally impossible in the agent parser; tripwire in Team mode | |
| **Deployment model** | MDM (Intune/Jamf/Addigy) extension + desktop agent + integrations | API keys + GitHub App + user-run local CLI (`@revealyst/agent`) | Scout needs IT rollout; Revealyst onboards in minutes |

### Metric-level comparison (selected)

| Concept | Scout metric | Revealyst equivalent | Delta |
|---|---|---|---|
| Adoption rate | `aiAdoptionRate`, `avgDau/Wau/Mau`, `dauPct` | `active_day` → DAU/WAU/MAU aggregations; Adoption score (`active_days` + `distinct_dims`, formula public) | Parity on activity; Revealyst adds a defined 0–100 score |
| Fluency | `aiProficiencyScore` + promptQuality/featureAdoption/useCaseDiversity components + `avgTurnDepth`, `singleTurnDominancePct` | Fluency = breadth (`feature_used` dims) + depth (`active_days`) + effectiveness (accept ratio) | Scout's conversation-shape components (turn depth, single-turn dominance) have **content-free equivalents Revealyst could compute locally** (§4 gap G5) |
| Effectiveness | accept metrics via coding tools | `suggestions_accepted/offered`, `edit_actions_*`; true accept/reject awaits OTel `tool_decision` | Parity; OTel receiver would exceed it |
| Spend | `totalCost`, `costPerToolUser`, per-tool cost | `spend_cents` (authoritative) vs `spend_cents_estimated` (labeled), cost-per-active-day/prompt, budgets + projection | Revealyst stricter + governance layer |
| Engagement | `aiEngagementScore` (undefined) | interpret bands 0–39/40–69/70–100, explicitly presentational | Revealyst tells you what a number is *not* |
| Velocity/quality | CAV, AI Slop Index, 30-day rework (formulas unpublished) | vendor-reported `lines_*`, `commits`, `pull_requests`; quality counter-metrics parked V2 | Deliberate asymmetry — see honesty boundary |
| Shadow AI | `unauthorized_ai_tool_count/rate` | honesty gaps surfaced (`oauth_actors_missing` etc.), never estimated | Philosophical fork |

---

## 3. Strengths, weaknesses, overlaps, differentiators

**Larridin strengths (real, don't dismiss):** breadth beyond engineering; enterprise
distribution machinery (SSO/JIT, MDM, directory/HRIS sync, org chart as "the backbone");
Developer Intelligence depth (DORA + incident data joins no one else in the AI-adoption
category has); programmatic surfaces (REST API, MCP); survey channel pairing sentiment
with behavior; multi-cloud spend sources (Bedrock/Vertex/Azure Foundry/OpenRouter/OTEL/SDK).

**Larridin weaknesses (documented, citable):** UI-only privacy threshold contradicted by
its own API; prompt-content ingestion and undocumented extension capture scope (works-council
poison in the EU); unpublished formulas behind every headline metric; ROI scaffolding that
returns null; no budgets/forecasting/chargeback; admitted Bedrock blind spot for Claude
Code; Codex analytics gated on ChatGPT Enterprise with 90-day lookback; several flagship
pages (Agent Effectiveness, WorkGraph, AI Code Share, Ask AI) are one-line stubs.

**Overlaps (the contested ground):** coding-tool connectors using identical vendor
credential mechanisms; token spend by model/team/tool; adoption+fluency scoring; agentic
usage measurement; period-over-period deltas. On this ground the fight is *trust*: same
data, but Revealyst's numbers carry attribution tags, published formulas, and honesty gaps.

**Revealyst differentiators (defensible because they're structural):**
1. **Privacy enforced at the data layer**, not a settings slider — pseudonymization by
   construction, API gates identical to page gates, no content ingestion possible.
2. **Published, versioned score formulas** + attribution ladder + honesty gaps — every
   "78" traces to an exact formula version and the weakest data it consumed.
3. **$0/$2 self-serve PLG** with the personal→team champion loop and share cards, vs an
   enterprise sales motion.
4. **Spend governance** (budgets/alerts/projection) where Scout has only description.
5. **Telemetry-derived maturity model** — Scout has nothing comparable documented.
6. **Shared-account detection** — turns messy reality into an honesty feature.
7. **Minutes-not-MDM onboarding** — API keys + a user-run CLI vs an IT deployment project.

---

## 4. Gap analysis — every Larridin capability Revealyst lacks

Scale: complexity XS (<1 wk) / S (1–2 wk) / M (2–6 wk) / L (>6 wk agent-fleet waves) / XL (standing product).
"Fit" = fit with Revealyst's vision (neutral, honest, privacy-first, solo-maintainable).

| # | Capability (Larridin ref) | User value | Feasibility | Telemetry/data required | Complexity | Dependencies | Privacy implications | Fit | **Priority** |
|---|---|---|---|---|---|---|---|---|---|
| G1 | Within-org percentiles + PoP deltas (`p25–p85`, `…ChangePct`) | High — CTOs think in distributions | High — data in hand | None new (`score_results`, `metric_records`) | S | AI-intel plan Phase 1 (F1.2) already scopes it | None (team-level, existing visibility rules) | Strong | **Now** |
| G2 | Data export (board-ready CSV/report) — absent in Scout too | High — the CTO's deliverable is a board slide | High | None new | S | None; respects `visibilityMode` at the reader | Positive if export passes the same `toPersonRef` gate | Strong | **Now** |
| G3 | Email alerts for budget thresholds (Scout has no budgets at all) | High — a budget alert nobody sees isn't governance | High — SES sender + digest CAS pattern exist | None new (`budgets`, MTD spend) | XS–S | Founder decision already flagged in W4-V | Aggregate-only email; unsubscribe exists (RFC 8058 pattern) | Strong | **Now** |
| G4 | OTel/OTLP ingestion (Scout: spend-only OTEL source) | High — true accept/reject (`tool_decision`), active time, retries (`retries` is a catalog metric no connector emits today) | Medium — spike-gated | Claude Code OTLP push (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) | M–L | AI-intel plan Phase 3; ADR (new ingest surface); never sets `OTEL_LOG_USER_PROMPTS` | Strong positive: sanctioned, content-free, org-configured | Strong — planned flagship | **Now (spike) → Later (build)** |
| G5 | Conversation-shape fluency signals (`avgTurnDepth`, `singleTurnDominancePct`, `messagesPerSession`) | Medium-high — deepens Fluency beyond accept-rate; Scout gets these only by reading content | High — turn/message **counts** are metadata; `@revealyst/agent` already parses session JSONL locally; parser structurally drops content | Local session-log structure (counts only) | S–M | ADR (new catalog metrics = frozen-contract change); summarizer version bump; later mirrored from OTel | Strong positive if counts-only; must survive the `packages/revealyst-agent/tests/privacy.test.ts` sentinel harness | Strong — "their fluency depth, without reading your prompts" | **Later** (next agent release) |
| G6 | MCP server over org analytics (Scout: beta) | Medium-high — the buyer is an AI-native CTO; "ask Claude about your org's AI adoption" | Medium — Workers MCP support exists (agents-sdk); read-only tools over existing readers | None new | M | OAuth for MCP; must route through `forOrg` + visibility gates (trivially satisfied by reusing the API readers) | Positive counter-position: Scout's API leaks individual data; Revealyst's MCP structurally can't | Strong | **Later** |
| G7 | Pulse sentiment survey → **perceived-vs-measured panel** | Medium-high — METR: perceived ≠ real; pairing a 2-question pulse with telemetry is a panel only an honesty-first product can ship | High | New org-scoped tables (survey, responses) → ADR + 3 registrations | M | Digest email as delivery channel | Must be aggregate-only, no free text in v1, min-group-size at the data layer (unlike Scout's individually-attributed free text) | Strong | **Later** |
| G8 | Read-only customer REST API | Medium — programmatic pull for BI | High | None new | M | API-key issuance, rate limits; same readers as MCP | Must enforce visibility mode identically to UI — the differentiator vs Scout's leak | Medium (MCP first; REST when a customer asks) | **Later** |
| G9 | ChatGPT Enterprise / Codex analytics connector (`api.chatgpt.com`, 90-day lookback) | High for the V2 org-wide thesis | Medium — documented vendor surface | Codex Analytics Key (ChatGPT Enterprise) | M | Parked V2 (Spec V3 §13); connector-facts refresh | API-aggregate, consistent with posture | Strong at V2 trigger | **Later** (demand-gated) |
| G10 | Claude Enterprise analytics (Scout's `sk-ant-analytics-…` method) | High for Enterprise-tier deals | High — vendor id `anthropic_claude_enterprise` already reserved | Analytics API key; data floor 2026-01-01 | M | Named trigger exists: first Enterprise customer (§10.4) | Same as G9 | Strong at trigger | **Later** (trigger already defined) |
| G11 | SSO/SAML + directory sync + org hierarchy | High for >200-seat orgs | Medium | Okta/Entra/Google APIs | L | Enterprise tier; Better Auth SSO plugin path | Directory data is PII — needs DPA posture first | Medium — V2 land-and-expand | **Later** (Enterprise trigger) |
| G12 | Multi-cloud spend sources (Bedrock, Vertex, Azure Foundry, OpenRouter, proxies) | Medium — closes Scout's own admitted Bedrock blind spot | Medium | Cloud billing/usage APIs per source | L (each is a connector a solo maintainer carries forever) | Connector budget; quarterly re-verification cadence | Fine (billing aggregates) | Medium — only with demand | **Later** (demand-gated, at most one) |
| G13 | Slack notification channel | Medium | High | None new | S–M | An outbound integration to maintain | Aggregate-only payloads | Medium | **Later** (email first via G3) |
| G14 | GitHub/GitLab outcome layer (code share, velocity, quality, WorkGraph) | Medium — "did it show up in shipped work" | Low-medium — App permission expansion + attribution methodology problem Scout hasn't solved either | Repo-scope GitHub App (today's App has **no** repo scope) | L–XL | AI-intel plan Phase 4 re-decision; DPA review; ADR | High — repo metadata is sensitive; per-person code metrics are refused (Group C) | Weak as a suite; narrow org-level counter-metrics only | **Later** (Phase 4 re-decision, org-level only) |
| G15 | Full DORA/CI-CD/reliability suite (Linear, PagerDuty, incident.io) | Medium for eng leadership, low for the AI-adoption question | Feasible but it's a second product | 3+ new integrations | XL | — | Fine | Weak — Swarmia/Jellyfish category creep | **Never** (as a suite) |
| G16 | Browser extension / desktop-agent activity capture | High breadth, toxic trust cost | Feasible, rejected | Endpoint deployment via MDM | XL | — | Fatal: works-council/AI-Act high-risk posture; "bossware" | None — tripwire (rejected, not deferred) | **Never** |
| G17 | Policy enforcement (block/warn) | Governance buyers want it | Requires G16 | Extension | XL | G16 | Same as G16, plus active interference | None | **Never** |
| G18 | Shadow-AI estimation (`unauthorized_ai_*` rates) | Appears valuable, unverifiable | Cannot be done honestly without capture | G16-class capture | — | — | Surveillance inference | None — refuse list: state the gap, never model it | **Never** |
| G19 | Prompt-content fluency scoring (`promptQualityComponent`, prompt categories) | Real signal, wrong cost | Possible only by reading prompts | Content ingestion | — | — | Tripwire: no prompt content in Team mode, ever | None (G5 captures the shape without the content) | **Never** (Team) |
| G20 | Time-saved / friction / "AI Helps/Hurts" verdicts, `estimatedTimeSaved` | Sells well, scientifically indefensible (METR RCT) | Not honestly | Workflow capture + causal model | — | — | — | None — Group C refuse list | **Never** |
| G21 | Per-person quality scores (AI Slop Index per engineer), AI-vs-human attribution without methodology | — | Not honestly | — | — | — | Person-focused feedback backfires (Kluger & DeNisi); invariant (b) | None | **Never** |
| G22 | "Ask AI" NL-query clone | Medium | Feasible but undifferentiated + ongoing inference cost | None new | M–L | — | Query layer must respect visibility mode | Weak — G6 (MCP) delivers it through the user's own Claude at near-zero marginal cost | **Never** (superseded by G6) |

---

## 5. Recommendations

Only features that strengthen differentiation and are founder-carriable. Everything here
rides existing architecture (Workers, queues, SES, the frozen scoring engine, the local
agent) — no new runtimes, no endpoint software, no second product.

### Now (small, extend existing leads)
1. **G1 — percentiles + period deltas.** Already scoped as AI-intel Phase 1 (F1.2); pure
   `src/lib` work. Directly neutralizes Scout's p25–p85 proficiency percentiles.
2. **G3 — email budget alerts.** Scout has *no* budgets; Revealyst's are in-app only.
   One SES template + the digest's week-CAS idempotency pattern turns W4-V into a
   governance moat. (This is the flagged founder decision in W4-V — recommend GO.)
3. **G2 — board-ready export.** CSV of team scores/trends/spend, passing through the
   existing pseudonymization gate. The CTO's job-to-be-done ends in a slide; neither
   product serves it today.
4. **Positioning (content, not code):** a Larridin-alternative comparison page grounded in
   this document's citable facts — published formulas vs unpublished CAV/Slop; data-layer
   privacy vs UI threshold + individual-level API; $2 self-serve vs enterprise sales;
   budgets vs descriptive spend. Per W3-P rules: derive connector claims from
   `src/connectors/registry.ts`, never present-tense unshipped features, adversarial
   fact-check pass before publishing.

### Next (gated, already on the strategy map)
5. **G4 — OTel receiver spike → build.** The one investment that makes Revealyst's
   effectiveness data *better* than Scout's without touching content: true
   accept/reject (`tool_decision`), active time, and the never-emitted `retries` metric.
   Keep the plan's gate: ~1-week spike, founder go/no-go, ADR.
6. **G5 — conversation-shape metrics in `@revealyst/agent`.** Turn counts, messages per
   session, single-turn dominance — computed locally from session structure, content never
   leaves the machine (and structurally can't). ADR for new catalog metrics; must pass the
   privacy sentinel tests. Marketing line writes itself: *"their fluency depth, without
   reading your prompts."*

### Later (sequenced, demand- or trigger-gated)
7. **G6 — read-only MCP server** over existing org-scoped readers (and skip G22 "Ask AI").
8. **G7 — 2-question pulse survey** feeding a perceived-vs-measured panel (aggregate-only,
   min-group-size at the data layer; no free text in v1).
9. **G10/G9 — Claude Enterprise, then ChatGPT Enterprise analytics connectors** on their
   already-named triggers (first Enterprise customer / V2 org-wide unpark).
10. **G8 REST API, G11 SSO/directory, G13 Slack, G12 one cloud spend source, G14 org-level
    outcome counter-metrics** — each only on a concrete customer trigger, in that order of
    preference.

### Never (say it publicly — the refusals are the moat)
Browser extension/desktop capture (G16), policy enforcement (G17), shadow-AI estimation
(G18), prompt-content scoring in Team mode (G19), time-saved/ROI verdicts (G20),
per-person quality scores (G21), full DORA suite (G15), Ask AI clone (G22). Each is either
a scope tripwire, a Group-C honesty refusal, or category creep a solo maintainer cannot
carry. Scout's docs demonstrate the alternative: eight flagship claims resting on
unpublished methodology and a privacy model its own API contradicts. Revealyst's
counter-positioning is not "we'll catch up" — it is *"we measured what can be measured
honestly, we published the formulas, and we made the invasive version impossible by
construction."*

### Prioritized roadmap sketch

| Horizon | Items | Gate |
|---|---|---|
| Now (next wave) | G1 percentiles/deltas · G3 budget-alert emails · G2 CSV export · comparison-page content | none — all ride existing data + SES |
| Next | G4 OTel spike (→ build on GO) · G5 conversation-shape metrics (agent release + ADR) | founder GO after spike; ADR for catalog additions |
| Later | G6 MCP server · G7 pulse survey · G10 Claude Enterprise connector | customer demand / Enterprise trigger |
| Trigger-gated | G9 ChatGPT Enterprise · G8 REST API · G11 SSO · G13 Slack · G12 one cloud source · G14 org-level outcomes | V2 unpark / named triggers in Spec V3 §10.4, §13 |
| Never | G15–G22 | tripwires + honesty boundary (Execution Plan rule 7; AI-intel report §6 Group C) |

---

## 6. Open questions for the founder

1. **G3 email alerts** were left as a flagged decision in W4-V — this analysis recommends
   GO (Scout's missing budgets make governance the cheapest moat to widen).
2. **Comparison-page publication** (§5 item 4) is outward-facing marketing — needs the
   standard adversarial content fact-check (W3-N/W3-P rule) and a decision on naming the
   competitor vs an unnamed "extension-based tools" framing.
3. **G5 catalog additions** require an ADR against the frozen `CANONICAL_METRICS` — worth
   bundling with the OTel ADR if the spike goes ahead, since the same metrics arrive on
   both channels (the connector-facts OTel section already anticipates this mapping).
4. Larridin's Trust Center (trust.larridin.com) was outside the crawled doc site — if the
   comparison page ships, someone should read it first so no claim about their posture
   overstates what their docs actually say.
