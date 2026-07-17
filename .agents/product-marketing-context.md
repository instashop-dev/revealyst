# Product Marketing Context

*Last updated: 2026-07-07 (W3-P kickoff). Derived from `docs/legacy/Revealyst_Product_Spec_V2.md` v2.4 and `docs/score-definitions.md`. All downstream marketing skills consume this file. Honesty rule: nothing here may be cited in customer-facing copy unless it traces to the spec, the methodology doc, or founder-verified data — no fabricated metrics, logos, or testimonials (we are pre-launch; we have none yet).*

## Product Overview
**One-liner:** See who's actually adopting AI — and how well — across all your AI tools.
**What it does:** Revealyst pulls usage telemetry from the admin APIs of the AI tools a company already pays for and turns it into three scores — Adoption, Fluency, Efficiency — with team benchmarks. **Connector truth (verify against `src/connectors/registry.ts` before writing copy):** live today = Anthropic Console, OpenAI, Cursor, plus the Claude Code local agent; GitHub Copilot and Claude Enterprise are planned (spec §10) but NOT shipped — copy must say "soon", never present tense. It is the neutral third party: no AI vendor will ever credibly measure its own product's impact or tell you a competitor's tool is used better.
**Product category:** AI enablement / adoption analytics. Explicitly NOT FinOps and NOT employee monitoring.
**Product type:** B2B SaaS (PLG), with a free Personal mode as the individual on-ramp — same product, same machinery, not a separate B2C funnel.
**Business model:** Personal $0 forever · Team $2/tracked-user/mo (free for ≤5 tracked users — `FREE_TRACKED_USER_LIMIT` in `src/lib/entitlements.ts` is the source of truth, W3-M revised it from 10; time-boxed 50% founder discount → $1/user, publicly sunset-dated 2026-08-31, implemented as a Paddle discount, never a lower list price) · Enterprise custom. Billing via Paddle as Merchant of Record (handles global VAT — part of the EU-safe story). "Tracked user" = an identity-resolved person with usage in the period; unresolved keys/accounts are surfaced but never billed.

## Target Audience
**Target companies:** Engineering-led companies, 25–200 employees (V1 beachhead). Explicitly not enterprise 5000+ at launch.
**Decision-makers:** CTO / VP Engineering / technical founder — a buyer who already self-serves tooling analytics.
**Primary use case:** Answer "who's using AI, how well, and are we getting our money's worth" across every AI tool the company runs — without a call, without a spreadsheet safari.
**Jobs to be done:**
- Justify (or redirect) the AI tooling spend with objective, cross-vendor numbers.
- Find who's actually fluent vs. who's a skeptic, so enablement effort lands where it matters.
- Get a defensible answer for the board/CEO on "what are we getting from AI?"
**Use cases:**
- Consolidated AI spend + adoption view in the first 10 minutes (onboarding hook).
- Team fluency benchmarking (team vs team, org vs published benchmarks).
- Shared-account detection: "you think 12 people use AI; the pattern suggests ~30" — undercounted adoption, ToS risk, credential hygiene.
- Individual developer (free Personal mode) checks their own fluency score and shares the score card.

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| CTO / VP Eng (buyer) | ROI on AI spend, board-level answers, not creating a surveillance problem | Vendor dashboards are per-tool, self-graded, and don't compare | One neutral cross-tool view: adoption, fluency, efficiency, benchmarks — EU-safe by default |
| Individual developer (user + champion) | Own skills, curiosity, career signal | No objective read on how well they use AI | Free personal fluency score + shareable score card; they bring it to the CTO |
| Eng manager / team lead (user) | Coaching the team, fair comparisons | Can't see breadth/depth/effectiveness per team | Team-level drill-downs + coaching recs, pseudonymized by default |
| Works council / DPO (technical influencer, EU) | GDPR, AI Act, §87 BetrVG co-determination | Most analytics tools read as monitoring | Team-level pseudonymized default, no prompt content ever in Team mode, DPIA/works-council guidance built in |

## Problems & Pain Points
**Core problem:** Companies pay for multiple AI tools but can't see who actually uses them, how well, or what they get back — MIT's "95% of AI pilots show no measurable ROI" is a whole-company problem.
**Why alternatives fall short:**
- Vendor-native dashboards are per-tool, assume seat=person (shared accounts break them worse), and grade their own homework — zero credibility on impact.
- DIY spreadsheets across four admin consoles rot instantly and have no fluency signal at all.
- Engineering-analytics suites (Jellyfish-class) are $35–50/dev, sales-led, and not AI-adoption-focused; monitoring tools are exactly the "bossware" label an EU buyer must avoid.
**What it costs them:** Real money on unused seats, enablement effort aimed blind, and an unanswerable board question.
**Emotional tension:** The CTO fear of being asked "what are we getting for the AI spend?" and having nothing; the parallel fear of deploying anything that reads as employee surveillance.

## Competitive Landscape
**Direct:** Larridin ($17M a16z, $50K+/yr, top-down enterprise) — too expensive and sales-led for 25–200 SMEs. Worklytics (~$2.5K/mo floor) — same. Copilot/Cursor/OpenAI/Anthropic native dashboards — single-tool, non-neutral, no fluency scoring, no cross-vendor benchmark.
**Secondary:** Jellyfish / engineering-analytics platforms ($35–50/dev) — adjacent lens, not AI-adoption-native. WakaTime ($8.25/user) — individual dev telemetry, no org AI-adoption story.
**Indirect:** Spreadsheets over admin-console exports; doing nothing and answering the board with anecdotes.
**Structural wedge:** neutrality + cross-tool aggregation — the one thing a vendor dashboard can never copy.

## Differentiation
**Key differentiators:**
- **Neutral third party** across all AI tools — the category's only credible referee.
- **AI Fluency Score (flagship):** breadth / depth / effectiveness composite — no vendor offers proficiency scoring at all.
- **Attribution honesty:** every metric carries an attribution-confidence tag (person / key / account level); we never fabricate per-user numbers from account-level data.
- **Shared-account detection as a feature** (undercounted adoption, ToS + security exposure), not an edge case swept under seat counts.
- **EU-safe by design:** team-level pseudonymized default, no prompt content in Team mode ever, no browser extension/proxy (rejected, not deferred), DPIA + works-council + AI Act guidance built into onboarding.
- **Published methodology:** versioned score definitions, publicly documented (`docs/score-definitions.md`) — scores you can interrogate, not a black box.
**Why customers choose us:** cheapest in category by a wide margin at $2/user, self-serve in minutes, and the only option that answers the cross-tool question without triggering the monitoring alarm.

## Objections
| Objection | Response |
|-----------|----------|
| "Isn't this employee monitoring?" | Team-level and pseudonymized by default; no prompt content ever in Team mode; individual view is opt-in self-coaching only; DPIA/works-council/AI-Act guidance ships in onboarding. The architecture, not a setting, makes surveillance impossible. |
| "The vendors already give me dashboards." | Per-tool, seat=person assumptions that shared accounts break, and self-graded impact claims. Nobody compares across tools or scores fluency — that's the whole product. |
| "Is a fluency score even credible?" | Behavioral signals only (acceptance rates, engaged days, feature breadth, output shipped), published versioned methodology, component drill-downs, benchmark context. When data doesn't support a number, we omit it rather than fake it. |
| "$2/user seems too cheap to be real." | Deliberate low anchor — COGS is cents per tracked user; expansion comes from feature depth and headcount, not price hikes. Free ≤5 tracked users to prove value first. |
**Anti-persona:** 5000+ enterprises wanting sales-led procurement; companies wanting prompt-content review of employees (we refuse by design); non-engineering orgs needing org-wide coverage today (V2 — connectors don't exist yet, and we say so).

## Switching Dynamics
**Push:** Board pressure to justify AI spend; vendor dashboards that can't answer cross-tool questions; unused seats quietly burning budget.
**Pull:** First consolidated spend+adoption view within ~10 minutes of self-serve signup; a fluency score nobody else offers; free entry (Personal, and Team ≤5).
**Habit:** "The Copilot dashboard is good enough"; quarterly spreadsheet ritual already exists.
**Anxiety:** Works-council/GDPR blowback (answered by the privacy architecture); another SaaS to justify (answered by $2 + free bands); data-access trust (read-only admin APIs + envelope-encrypted credentials).

## Customer Language
**How they describe the problem:**
- "Who's actually using AI — and who isn't?"
- "How well are they using it?"
- "What are we getting for it?" / "Are we getting our money's worth?"
- "You think 12 people use AI; the pattern suggests ~30."
**How they describe us:**
- "Test your AI fluency" (share-card loop)
- "My AI Fluency: 78" (score card)
- "See your total AI spend in one place in 5 minutes" (onboarding hook)
**Words to use:** neutral, cross-tool, fluency, adoption, honest/attribution-confidence, team-level, pseudonymized, EU-safe, self-serve, benchmarks, behavioral signals, measured (not self-reported).
**Words to avoid:** monitoring, surveillance, tracking employees, productivity score, bossware framing, "ROI guarantee", FinOps/cost-optimization framing (spend is context, not the product), any per-user claim about account-level data.
**Glossary:**
| Term | Meaning |
|------|---------|
| Tracked user | Identity-resolved person with ≥1 usage record in the period; the billing unit. Unresolved keys/accounts are surfaced, never billed |
| Attribution confidence | Per-record tag: person-level / key-project-level / account-level — reporting granularity the data honestly supports |
| Fluency Score | Flagship composite: breadth (features/tools) + depth (engaged days) + effectiveness (acceptance per offer) |
| Segments | Skeptics · Casual · Power Users · AI Natives (team-level by default) |
| Personal mode | Free org-of-one; same machinery as Team + share card + anonymized-benchmark opt-in |

## Brand Voice
**Tone:** Plainspoken, technically honest, quietly confident. Show-HN-compatible: methodology-forward, no growth-hack hype.
**Style:** Direct and concrete; numbers over adjectives; admits limits explicitly ("connect when available", "we omit rather than estimate").
**Personality:** Neutral referee · engineer-credible · privacy-serious · unafraid to say "we don't know yet".

## Proof Points
**Metrics:** Pre-launch — no customer metrics exist yet. Usable honest claims: time-to-first-insight target <10 minutes (instrumented); published versioned scoring methodology; category price floor ($2 vs WakaTime $8.25, Jellyfish $35–50/dev, Worklytics ~$2.5K/mo, Larridin $50K+/yr).
**Customers:** None publishable yet (founder dogfooding + friendly developers only). Do NOT imply logos or testimonials.
**Testimonials:** None yet — never fabricate.
**Value themes:**
| Theme | Proof |
|-------|-------|
| Neutrality | Cross-vendor by construction; no AI vendor relationship to protect |
| Honesty | Attribution-confidence tags; omit-don't-fabricate scoring rules (score-definitions.md) |
| EU-safety | Pseudonymized team default; no content capture; DPIA/works-council/AI-Act guidance; Paddle MoR for VAT |
| Speed | Self-serve; first insight target <10 min; free entry both sides (Personal, Team ≤5) |

## Goals
**Business goal:** V1 launch validation via live signals: activation (first score), share-card virality, Personal→Team conversion (spec §15 — no pre-launch validation gate exists by design).
**Conversion action:** Sign up free → connect a key → see first score; secondary: share the score card; tertiary: Personal→Team upgrade.
**Current metrics:** None yet — §15 instrumentation ships in W3-P alongside this file.
