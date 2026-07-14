# Revealyst — Product Specification (V2)

**Version:** 2.4 · **Date:** July 7, 2026
**Superseded by:** [Revealyst Product Specification V3](Revealyst_Product_Spec_V3.md) (the V1.5 spec) — this document remains the V1 reference; §2–§7 stay in force where V3 says so.
**Supersedes:** Revealyst Product Specification V1 (`Revealyst_Product_Spec_V1.docx`)
**Basis:** Revised per the Business & Technical Feasibility Study v1.1 ([docs/Revealyst_Feasibility_Study.md](Revealyst_Feasibility_Study.md)) and subsequent analysis of single-vendor analytics, shared-account attribution, cross-functional expansion, and individual (Personal-mode) usage.
**Execution model:** V1 is built by **parallel AI coding agents** orchestrated by the founder (see [docs/Revealyst_Execution_Plan.md](../Revealyst_Execution_Plan.md)), and ships **without a pre-build customer-validation gate** — the positioning and pricing in this spec are taken as the working thesis.
**Operating constraint:** Solo founder, bootstrapped. Build capacity is amplified by AI agents, but *sell and support remain solo* — so every scope decision is still filtered through "can one person sell and support this, and keep it maintained?" The scope tripwires (fewest connectors, no browser extension/proxy, no second funnel) exist because a solo maintainer, not an agent fleet, carries V1 forever.
**Changelog:**
- v2.4 — repriced **Team to a $2/user/mo list** with a **50% time-boxed founder discount** ($1/user effective) (§11). A deliberate founder decision that supersedes the v2.2 "hold list at $3–5" analysis; the founder rate remains a Paddle discount, never a separate low list price.
- v2.3 — set the execution model to parallel AI agents and removed the pre-build customer-validation gate (header, §15); named **Paddle as the payment processor and Merchant of Record** for global tax/VAT handling (§11, §12).
- v2.2 — resolved six review comments with mid-2026 research: rejected browser-extension and prompt-content ingestion for Team on positioning/legal/maintenance grounds and rehomed both in Personal mode (§7, §10, §6a.5); excluded Chinese-vendor tools (no admin APIs) (§10); held Team pricing at $3–5 with a time-boxed founder option (§11); made score definitions versioned data so the V1.5 Index Builder is UI-only (§8, §12); consolidated the stack to Cloudflare-first + managed Postgres (§12).
- v2.1 — added Personal mode (§6a) as the PLG entry point; reframed pricing as Personal → Team → Enterprise; updated change-table, market, integrations, and roadmap.

---

## 1. What Changed from V1 (and why)

| V1 assumption | V2 position | Reason |
|---|---|---|
| Lead with **Cost Intelligence** | Lead with **Adoption + Fluency**; spend is the onboarding hook and score denominator, not a headline module | Vendors + free FinOps tools commoditized cost analytics; adoption/fluency/impact is where neutral, cross-vendor value survives |
| Three co-equal pillars in V1 | **Adoption + Fluency in V1**, deep capability deferred, impact grows over time | Prompt-content capability is legally hazardous and technically heavy; a signal-based fluency score is buildable now |
| Cost/adoption reporting is the product | **Neutral cross-vendor aggregation + scoring + benchmarks** is the product | Every vendor now reports its own adoption; only a third party can compare across tools and stay credible on impact |
| Assumes seat = person | **Honest attribution ladder + shared-account detection** | Teams routinely share ChatGPT logins and API keys; faking per-user numbers destroys trust |
| Target: all SMEs 25–500 | **Land in engineering (25–200), expand org-wide (sales/marketing/finance) in V2** | The rich per-user APIs are all dev tools; land where data + buyer are strongest, then expand |
| Go/Rust + Python ML + Kafka + ClickHouse | **TypeScript monolith + PostgreSQL + scheduled pollers, managed hosting** | Telemetry arrives via daily API polling, not high-throughput streams; V1 has no ML |
| $499/mo flat, sales-led | **PLG: free tier → per-tracked-user pricing**, self-serve | Category is strongly PLG; sales-led doesn't scale for a solo founder |
| Custom Index Builder = V1 must-have | **3 preset scores in V1**, builder in V1.5 | Customers must trust base metrics before building custom formulas |
| Team/org product only | **Free Personal mode** as the PLG entry point | An individual checking their own fluency is the bottom-up path to the team sale, the benchmark-network seed, and the content moat |

---

## 2. Vision & Positioning

**Vision:** Help organizations understand and improve how well their people actually use AI — across every AI tool they run — through neutral, cross-vendor adoption and fluency intelligence.

**Positioning line:** *"See who's actually adopting AI — and how well — across all your AI tools."*

**Category:** AI enablement / adoption analytics (not FinOps, not employee monitoring).

**The wedge that survives scrutiny:** Revealyst is the **neutral third party**. No AI vendor will ever tell a customer their team uses a competitor's tool better, or measure its own product's impact credibly. That neutrality — plus cross-tool aggregation — is the one thing vendor-native dashboards structurally cannot copy.

### Core Questions (revised from V1)
1. **Who** is actually using AI — across all our tools, and who isn't?
2. **How well** are they using it? (fluency)
3. **What** are we getting for it? (impact, growing over time)
4. **How** do we compare and improve? (benchmarks)

*Cost — "what are we spending?" — is answered as onboarding context, not as the product's reason to exist.*

---

## 3. Target Market & Land-and-Expand

**V0 on-ramp — individual developers (free Personal mode).** The bottom of the funnel: a single developer connects their own API keys / Claude Code and gets their own fluency score. Feeds the team sale, the benchmark network, and the content moat (see §6a).

**V1 beachhead — engineering-led companies, 25–200 employees.**
Buyer: CTO / VP Eng / technical founder. Chosen because the four rich per-user APIs are all developer tools, coding tools emit *objective effectiveness* signals (acceptance rate, code shipped), and the buyer already self-serves tooling analytics. The individual who tried Personal mode is the internal champion for the team purchase.

**V2 expansion — org-wide (sales, marketing, finance, ops).**
The demand is org-wide (MIT's "95% of pilots show no measurable ROI" is a whole-company problem). The constraint was data, not demand. Expansion becomes viable as SME-tier connectors mature:
- ChatGPT Business/Enterprise workspace analytics
- Claude Team analytics (CSV connector as a pragmatic bridge until the API opens to Team)
- SSO / Google Workspace / Okta directory sync to map seats→people and provide the company-wide denominator ("% of the *whole company* using AI weekly")

Non-engineering teams get **adoption + spend first**, with **fluency added later** as chat-tool signals mature (and only ever from behavioral signals, never prompt content — see §7). The engineering champion who buys V1 is the natural internal sponsor for the org-wide rollout: bottom-up into the same expansion Larridin sells top-down.

**Explicitly out of scope:** enterprise 5000+ as a launch target (that's where the funded incumbents already sit).

---

## 4. Architecture

```
Vendor Admin APIs → Connectors (poll + normalize) → Unified Metrics Model
    → Scores (Adoption, Fluency, Efficiency) → Benchmarks → Dashboard + Alerts
```

Telemetry is **pulled** from vendor admin APIs on daily/hourly schedules — there is no high-throughput stream to justify Kafka/ClickHouse at this stage.

**The unified metrics model is the core IP:** mapping four (later many) vendors' different granularities — per-user, per-key, per-project, per-account — onto one normalized schema, with an explicit attribution-confidence level on every record (see §6).

---

## 5. The Data Reality: What Single Vendors Do and Don't Provide

Designing around what actually exists as of mid-2026:

| Capability | Single-vendor state | Revealyst's role |
|---|---|---|
| **Adoption reporting** | **Commoditized** per-tool. ChatGPT Enterprise workspace analytics; Claude Team dashboard + per-user CSV; Copilot & Cursor per-user; Microsoft Viva (free). *ChatGPT Business is only a basic admin console — rich analytics are Enterprise.* | Aggregate across tools; segment users; benchmark. Value is in the composite, not the raw number. |
| **Fluency scoring** | **Not offered.** Vendors expose raw signals (acceptance rate, engaged days, feature use) but none scores proficiency, tiers users, or coaches — and none can compare across tools. | Compute the cross-vendor AI Fluency Score. Open territory. |
| **Impact measurement** | **Essentially absent / not credible.** Only Microsoft estimates "assisted hours," and every vendor grading its own homework has a credibility problem. | Neutral, cross-tool impact — grows from proxy (V1) toward outcome-linked (V2+). The most defensible layer. |

**Design consequence:** Revealyst climbs the value ladder — adoption (table stakes, commoditized) → fluency (half-open) → impact (open). Positioning leads with fluency + impact and neutrality, never "we show you adoption."

---

## 6. Handling Shared Accounts (first-class, not an edge case)

Teams routinely share ChatGPT logins and API keys. This breaks seat=person attribution — and it breaks vendor dashboards *worse*, because they assume the seat is one person. Handling the messy reality is a differentiator.

**6.1 Attribution ladder — report at the granularity the data honestly supports, and label it:**
- **Person-level** — Copilot, Cursor, Claude Code, Claude Team (per-user CSV/API)
- **Key / project-level** — OpenAI API (per-employee only if the customer issues per-user keys or passes user IDs)
- **Account-level** — shared logins where individuals are genuinely indistinguishable

Every metric carries an **attribution-confidence** tag. Revealyst never fabricates per-user numbers from account-level data.

**6.2 Shared-account detection as a feature.** Usage patterns that imply sharing — one seat with round-the-clock activity, or volume several times the team median — are flagged. This is valuable to the buyer because it means:
- Adoption is *undercounted* ("you think 12 people use AI; the pattern suggests ~30")
- Sharing usually violates vendor ToS
- Shared credentials are a security/compliance exposure

**6.3 Visibility-readiness playbook.** Guided onboarding to issue per-user API keys and migrate shared Plus accounts to Team/Business plans — improves the customer's governance and Revealyst's own data quality over time. A natural upsell moment.

**6.4 Team-level scoring absorbs the problem.** Because the default scoring unit is the *team* (also the privacy default, §7), a team's fluency/adoption score stays valid even when individuals within it share credentials. The privacy-safe design and the shared-account reality converge on the same architecture.

---

## 6a. Personal Mode (individual users — the PLG entry point)

A single individual can connect their own AI tools and get their own Adoption and Fluency scores. This is not a separate B2C product — it is the free top of the same funnel, using the same connectors, the same scoring engine, and the same self-view UI the team product already defines.

**6a.1 Why it exists (three strategic jobs, not a side feature):**
1. **Bottom-up funnel.** The individual who checks their own fluency is the engineer who brings Revealyst to their CTO. This is the Grammarly/RescueTime motion, and it lands exactly on the V1 beachhead — the people with the best individual data access are developers.
2. **Benchmark cold-start solver.** Thousands of individuals opting into anonymized comparison ("your fluency is 78 — above 85% of developers on similar tools") seeds the §8 benchmark network years before 100 contributing orgs would exist.
3. **Content moat.** A shareable AI-fluency score card is a viral artifact ("test your AI fluency") that feeds the benchmark-content channel a solo founder must rely on.

**6a.2 What data an individual can actually connect (developer-skewed today):**

| Source | Personal-mode viability |
|---|---|
| OpenAI / Anthropic API keys | ✅ Full — an individual is their own org; usage/cost endpoints work directly |
| Claude Code | ✅ Best story — rich local session logs (community tools like `ccusage` already read them; OTel export supported). A local-ingest connector gives an individual everything a team gets |
| GitHub Copilot / Cursor **individual** plans | ❌ Gap — metrics/analytics APIs are org-admin surfaces; personal subscribers have no per-user API. Show "connect to measure" but cannot score. *(Re-verify — vendor APIs move monthly.)* |
| ChatGPT Plus / Claude.ai personal | ⚠️ Via data export — no personal usage API, but "upload your export → get your fluency profile" is feasible and privacy-clean (user handles their own data) |

Personal mode therefore works well **today for the API + Claude Code developer**, partially for others.

**6a.3 Architectural bonus — it erases both hard problems.** No shared-account ambiguity (it's the user's own account) and no privacy exposure (entirely self-directed — it *is* the opt-in self-view coaching mode from §7, reachable without an employer).

**6a.4 Scope discipline — what Personal mode must NOT become:** a separate B2C product with its own funnel and bespoke features. Individuals convert poorly to paid, and a solo founder cannot run two funnels. Personal mode is **free, forever**, identical machinery to Team, with only two additions: a shareable score card and an anonymized-benchmark opt-in. A paid personal tier, if demand ever appears, is a surprise — not a plan.

**6a.5 Explicitly deferred:**
- A quiz/scenario-based fluency *assessment* for non-developers with no connectable telemetry (the Section playbook — "what you know" vs. "what you actually do"). Different build, different credibility claim. Keep V1 telemetry-only; revisit an assessment later as a possible lead magnet, not a product pillar.
- **Prompt-quality coaching on the user's own content — Personal mode only, V2+.** Scoring the actual text of prompts (specificity, iteration, model-choice fit) is legally clean *only* when the individual is the data subject, controller, and beneficiary — i.e., never in Team mode (see §7). A Personal-mode "point the desktop companion at your own history / upload your ChatGPT export → get prompt coaching" feature is feasible (small local model, batch scoring) and could differentiate the free tier, but it is a significant separate build and stays deferred under the §6a.4 scope discipline — a possible surprise, not a V1 plan.

---

## 7. Privacy Model (EU-safe by default)

Scoring people is near the EU AI Act line even without reading content, so privacy is architectural, not a setting.

- **Team-level, pseudonymized by default.** Individual identities are not surfaced unless explicitly enabled.
- **No prompt content in V1 (and likely never).** The Fluency Score uses only behavioral signals the APIs already expose — acceptance rates, engaged days, feature breadth, output shipped. No content capture, no browser extension, no proxy. Two objections that surface repeatedly are answered here because they do *not* create a safe path to content capture in Team mode:
  - *"Process prompts locally so data never leaves the device."* Local processing is a good security story but **not a legal exemption.** Under GDPR (Art. 4(1)) reading/scoring prompts on-device is still processing of personal data, and EU AI Act high-risk classification (Annex III 4(b) — workplace evaluation of employees) attaches to the *system's purpose*, not to where inference runs. A fluency score bound to an employee is itself personal data even if only the score is pushed.
  - *"Make it opt-in with admin controls."* An admin-mediated opt-in is close to self-contradictory: EDPB Guidelines 05/2020 hold that employee consent is presumptively invalid due to the employer–employee power imbalance, and an opt-in the employer configures (and can see who declined) fails the "freely given" test. Separately, in Germany §87 BetrVG works-council co-determination is triggered by a system's monitoring *capability* — before any individual opts in. Content-based scoring is therefore a Personal-mode-only idea (§6a.5), never a Team feature.
- **Individual view is opt-in and framed as self-coaching**, never a manager surveillance leaderboard.
- **Privacy Modes** (from V1, retained and made meaningful): Private (team-only) · Managed visibility · Full visibility — with team-only as default.
- Built-in guidance for GDPR DPIA, works-council notification, and AI Act worker-notification obligations. Turning the compliance burden into onboarding help is itself a selling point to EU buyers.

---

## 8. Metrics, Scores & Benchmarks

### Level 1 — Metrics (normalized across vendors)
Active users (daily/weekly/monthly), sessions, prompts/messages, tokens, spend, model mix, acceptance/retry rates, feature usage, output shipped (commits/PRs/lines for coding tools), engaged days.

### Level 2 — Scores (3 opinionated presets in V1)
1. **AI Adoption Score** — breadth and consistency of use across the org and its tools (% active, frequency, tool coverage, trend).
2. **AI Fluency Score** — *the flagship.* Composite of:
   - **Breadth** — how many tools/features a team uses (autocomplete-only vs. chat/agent/composer)
   - **Depth** — engaged days, session depth
   - **Effectiveness** — acceptance rates, output shipped, retry patterns, model-choice appropriateness (e.g., expensive-model overuse on trivial tasks)
3. **AI Efficiency Score** — value signals per unit spend (spend is the denominator here — the one place cost data does real work).

Users are segmented into **Skeptics · Casual · Power Users · AI Natives** (retained from V1) — derived from adoption + fluency, at team level by default.

**Scoring architecture — scores are derived data, not hard-coded logic.** The normalized Level-1 metrics are the source of truth (persisted per user/team/tool/day); every score is a *derived view* computed by one generic scoring engine from **versioned score definitions** — the 3 presets are themselves rows (components, weights, normalization ranges, version), not code. This is a days-not-weeks decision now that pays off three ways: (1) the V1.5 Custom Index Builder becomes UI over an engine that already exists rather than a rewrite; (2) benchmark comparability is preserved because every number records which formula version produced it, and history can be recomputed when a definition changes; (3) attribution-confidence tags (§6.1) propagate naturally from raw metrics into any derived score. What this does *not* mean for V1: no formula-DSL parsing, no per-tenant sandboxed expressions, no rules engine — that surface stays in V1.5.

### Level 3 — Indexes
Rolled-up org-level AI Adoption / Fluency / Efficiency indexes over time.

### Level 4 — Benchmarks
- V1: **team vs. team**, **team vs. org**, and **org vs. published benchmarks** (seeded from public data — Copilot acceptance-rate norms, Worklytics/Section adoption benchmarks). Benchmarks are load-bearing: a fluency score is meaningless without comparison.
- V3: **org vs. industry** from the anonymized customer network (requires >100 contributing orgs — a genuine earn-out, not a launch promise).

### North Star (revised)
V1 replaces the unmeasurable ALR (Business Value / AI Spend) with a measurable proxy: **weekly-active-AI-user rate × fluency vs. benchmark**. True impact/ROI linkage grows in V2+ as outcome integrations (delivery metrics, CRM, etc.) come online.

---

## 9. Core Modules (V1)

1. **Adoption Intelligence** — active users across all connected tools, tool coverage, segmentation, team heatmaps, trends, and shared-account flags.
2. **Fluency Intelligence** *(flagship)* — the AI Fluency Score with breadth/depth/effectiveness drill-downs, team benchmarking, and coaching recommendations (team-level; opt-in self-view).
3. **Spend Context** *(demoted from V1's Cost Intelligence)* — one consolidated spend summary card across all tools + basic budget alerts. The onboarding hook ("see your total AI spend in one place in 5 minutes") and the efficiency-score denominator. **No** optimization recommendations or FinOps tooling.

**Dashboard UX:** 3 cards + benchmark panel — **Adoption · Fluency · Efficiency · Benchmark summary** (spend folds into Efficiency rather than getting its own hero card).

---

## 10. Integrations

**V1 (per-user data exists for SME tiers):**
- GitHub Copilot — metrics API (GA Feb 2026)
- Cursor — Admin + Analytics API (Teams plan)
- Anthropic — API usage/cost + Claude Code Analytics API *(note: non-Enterprise OAuth users not fully returned)*
- OpenAI — Usage & Costs Admin API (per project/key; per-user via customer-issued keys/user IDs)

**Personal-mode ingestion (§6a):** individual API keys, **Claude Code local session logs** (local-ingest connector, à la `ccusage` / OTel export), and **ChatGPT Plus / Claude.ai data-export upload**. Copilot/Cursor individual plans have no personal API — offered as "connect when on a Team plan," not scored. The local-log connector is delivered as a small **self-installed desktop companion ("Revealyst Agent")** — the sanctioned local-ingest path: it reads Claude Code logs today and is the extension point for other local AI-tool logs later. This is genuine self-analytics (the user is the data subject and beneficiary), WakaTime-precedented, and consent-clean — the opposite of a workplace extension.

**Ingestion:** API keys + OAuth only, plus the Personal-mode desktop companion above. **No browser extension, no proxy** — rejected, not merely deferred, on three grounds: (1) *positioning* — no non-security analytics product has shipped a workplace extension without being labeled monitoring/"bossware"; it collides head-on with the §2 category claim "not employee monitoring"; (2) *legal* — an extension that can read AI-tool pages is a "technical device capable of monitoring behavior/performance," triggering §87 BetrVG works-council co-determination and pushing toward EU AI Act high-risk, destroying the EU-safe wedge (§7); (3) *maintenance* — AI web UIs change ~weekly and reliably break selector-based extensions, an untenable second product for a solo founder. The shared-account attribution an extension would buy is instead solved at the root by the §6.3 visibility-readiness playbook (per-user keys, migrate shared Plus → Team) with zero new software.

**Chinese-vendor tools (DeepSeek, Qwen/DashScope, Moonshot Kimi, Zhipu GLM):** excluded — as of mid-2026 **none exposes an org/admin usage or cost API** (only individual keys + dashboard billing), so there is nothing to poll and a connector cannot deliver per-user or per-org telemetry. Backend-routed usage (developers pointing Claude Code at a Chinese endpoint via `ANTHROPIC_BASE_URL`) is *partially* visible for free through the Claude Code local-log connector regardless of backend — a shadow-AI-detection byproduct, not a reason to build vendor integrations. Compliance drag (Italy's Garante GDPR ban on DeepSeek; US device bans) reinforces exclusion for an EU-safe product. *Re-verify quarterly — vendor APIs move monthly.*

**V2 (org-wide expansion):** ChatGPT Business/Enterprise, Claude Team (CSV bridge → API when available), Slack/Jira for orgs on enterprise plans, and SSO/Google Workspace/Okta directory sync for the company-wide denominator.

---

## 11. Pricing (PLG)

| Tier | Price | Includes |
|---|---|---|
| **Personal** | $0, forever | Single user, self-connect own tools, own Adoption + Fluency score, shareable score card, anonymized-benchmark opt-in (§6a) — the PLG top of funnel |
| **Team** | $2 / tracked user / mo | Multi-user orgs: all connectors, full history, all scores, team benchmarks, shared-account detection (≈ $60–200/mo for a 30–100-person team). Free for ≤5 tracked users |
| **Enterprise** | Custom | SSO, audit, DPA, org-wide connectors, industry benchmarks — a later-stage tier |

Value scales with headcount, so **per-tracked-user** pricing fits better than flat tiers. Personal is the free individual on-ramp; Team's ≤5-user free band lets a small team form organically before paying. Self-serve signup and in-app upgrade throughout — no sales-led motion required below Enterprise.

**Billing runs on Paddle as Merchant of Record (§12).** Paddle is the seller of record and handles global sales-tax/VAT collection and remittance, so a solo founder selling into the EU avoids per-country tax registration — a natural fit with the EU-safe positioning (§7). Team is modelled as a quantity-based subscription metered on tracked-user count; the time-boxed founder rate (50% off → $1/user) is a Paddle discount, never a separate low list price.

**Team list price is set at $2/user — a deliberate founder decision (v2.4) that departs from the earlier $3–5 hold.** Competitive context still applies: Revealyst is the cheapest option in the category by a wide margin (WakaTime $8.25/user; Jellyfish $35–50/dev; Worklytics ~$2.5K/mo floor; Larridin $50K+/yr), so $2 buys headline affordability. The prior analysis flagged the tradeoffs this override accepts: sub-$5 risks signalling low value, and the revenue math is thin for a solo founder (100 teams at $2 ≈ $3.3K MRR against 100 customers' support load, vs. the ≈ $5K the old $3 bottom-of-band implied). Because repricing upward from a low anchor is well-documented pain, $2 is chosen as a deliberate low anchor, not a placeholder. COGS is cents per tracked user, so this is a positioning choice, not a margin one, and adoption friction here is trust + connector setup, not price — the free Personal and ≤5-user bands remain the real adoption levers. The time-boxed, publicly sunset-dated **50% founder discount ($1/user effective)** is layered on top as a Paddle discount, never a separate list price. Expansion should come from **feature depth** (team benchmarks, coaching, custom indexes) and headcount growth, **not** from raising the per-user rate.

---

## 12. Tech Stack

- **Frontend + Backend:** one **TypeScript monolith** (e.g., Next.js) — one language, one deploy.
- **Hosting: Cloudflare-first.** Workers via the OpenNext Cloudflare adapter (1.0 GA, Feb 2026 — Node runtime, production-ready) host the monolith; **Cron Triggers + Queues** run the connector pollers (Queues allow minutes of wall-time, enough for polls/backfills); **Cloudflare Containers** (GA Apr 2026) are the escape hatch for anything long-running. No Kubernetes, no self-managed compute estate.
- **Data:** **managed PostgreSQL** reached through Cloudflare **Hyperdrive** connection pooling (included in Workers Paid). Start on **Neon** (post-Databricks: no monthly floor, generous free tier) — because all access goes through Hyperdrive, swapping to **AWS RDS** later (e.g., to spend AWS credits or for an AWS data-residency story) is a connection-string change, not a migration. Note: Cloudflare has no native Postgres (D1 is SQLite — wrong tool here). Add TimescaleDB/ClickHouse only when a real customer's volume demands it.
- **Vendor surface (intentionally small):** Cloudflare (compute, jobs, pooling) + managed Postgres, with **AWS reserved for RDS / S3 / SES** if and when needed. This satisfies an "AWS + Cloudflare only" consolidation goal while keeping the app off the weaker AWS app-hosting options (App Runner in maintenance mode; Amplify's Next.js DX is poor).
- **Payments:** **Paddle Billing as Merchant of Record** — overlay checkout + webhooks drive entitlement state in Postgres; Paddle owns global tax/VAT (§11). The only reason to add a second processor later is a capability Paddle lacks, not cost.
- **Scores are versioned data evaluated by a generic engine** (see §8), not bespoke per-score code — so the V1.5 Custom Index Builder is UI over an existing engine.
- **No** separate Python ML service in V1 (there is no ML in V1; scores are deterministic formulas).

---

## 13. Roadmap

- **V1 (0–3 mo)** — Adoption + Fluency + Spend Context over the 4 dev connectors; 3 preset scores; published-data benchmarks; self-serve PLG onboarding; **free Personal mode** (API keys + Claude Code local ingest) with shareable score card; shared-account detection; EU-safe privacy defaults.
- **V1.5 (3–6 mo)** — Custom Index Builder (no-code weighted formulas); more connectors; coaching content.
- **V2 (6–12 mo)** — Org-wide expansion: ChatGPT Business/Enterprise + Claude Team connectors, SSO/directory sync, adoption+spend for sales/marketing/finance; begin impact/outcome linkage.
- **V3 (12 mo+)** — Industry benchmark network once >100 orgs contribute anonymized data; deeper impact analytics.

---

## 14. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Vendor commoditization of adoption reporting | Live at the neutral cross-vendor **fluency + impact** layer, not raw adoption |
| Funded incumbents (Larridin $17M/a16z) move down-market | Speed + SME-native PLG + content moat (publish benchmark data early) |
| EU privacy / AI Act on people-scoring | Team-level pseudonymized default; no content capture; built-in compliance guidance |
| Shared accounts corrupt attribution | Attribution ladder + shared-account detection + team-level scoring |
| Benchmark cold-start | Seed from published data in V1; network benchmarks are a V3 earn-out |
| Solo bandwidth | Fewest connectors; self-serve everything; API-first ingestion — no browser extension or proxy to maintain (the only local component is the self-installed Personal-mode desktop companion, §10) |

---

## 15. Success Criteria (V1)

- Time-to-first-insight under 10 minutes from signup (connect a key → see consolidated spend + adoption).
- A CTO can answer "who's using AI, how well, and are we getting our money's worth" without a call.
- The Fluency Score is credible enough that a team lead acts on a coaching recommendation.
- Self-serve conversion works end to end: Personal signup → live score → Team upgrade through Paddle checkout, with no founder in the loop.

*Note: V1 ships without the pre-build CTO-validation gate that earlier drafts (and the feasibility study) recommended. Validation is instead read from live self-serve signals — activation, share-card virality, and Personal→Team conversion — after launch. This trades pre-build certainty for speed, accepting the risk that the fluency-wedge thesis is only tested once the product is public.*

---

*This spec is a living document. Competitor pricing, API capabilities, and vendor-tier feature gates should be re-verified before committing engineering time — they are moving monthly.*
