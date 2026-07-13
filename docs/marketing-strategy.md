# Revealyst — Automated Solo-Founder Marketing Strategy

> **Superseded positioning (2026-07-13):** this strategy predates the V4 pivot
> ([Product Spec V4](Revealyst_Product_Spec_V4.md) §1–§2). Its product framing —
> CTO-buyer-first, "Fluency (the flagship)" score-led messaging — is retired: V4 leads with
> the Personal AI Companion and demotes the raw score to a diagnostic. The automation-first
> channel mechanics below still stand; every positioning/copy claim must be re-cut against
> Spec V4 before use ([V4 Execution Plan](Revealyst_Execution_Plan_V4.md) W5-N).

**Status:** Proposed · 2026-07-07
**Owner:** Founder
**Scope:** Long-term, automation-first marketing system for a one-person company.
Grounded entirely in this repository — every recommendation cites the code, doc,
or infrastructure it builds on. Companion docs: [launch plan](launch/launch-plan.md) ·
[announcements](launch/announcements.md) · [directories](launch/directories.md) ·
[benchmark post data needs](launch/benchmark-post-data-needs.md) ·
[documentation plan](documentation-plan.md).

**Guiding principle applied throughout:** prefer less recurring effort, assets that
compound, automation over manual execution, systems over campaigns, evergreen over
time-sensitive, self-service over sales. The launch moment (Show HN / Product Hunt)
is the *single* sanctioned manual campaign — it is one-off, already fully scripted
in `docs/launch/`, and exists to seed the automated loops below.

---

## 1. Product Analysis

### 1.1 Product summary

Revealyst is **neutral, cross-vendor AI-adoption analytics**: it reads the admin
APIs of the AI tools a company already pays for and turns them into three scores —
**Adoption** ("who's using AI"), **Fluency** ("how well" — the flagship), and
**Efficiency** ("are we getting our money's worth") — plus benchmarks, segments
(Skeptic / Casual / Power User / AI Native), and shared-account detection
(`docs/Revealyst_Product_Spec_V2.md`, `docs/score-definitions.md`).

- **Shipped connectors** (`src/connectors/index.ts`): Anthropic Console, OpenAI,
  Cursor, plus the **Claude Code local agent** (`packages/revealyst-agent`, a CLI
  that summarizes local logs and pushes to `/api/agent/ingest` — never prompt content).
- **"Soon"** (in the frozen vendor enum, no connector module): GitHub Copilot,
  Claude Enterprise. The landing page derives this strip from
  `src/connectors/registry.ts`, so copy can never overclaim.
- **Live** at https://revealyst.thapi.workers.dev (Cloudflare Workers + Neon Postgres). Custom domains now attached with a host split: `revealyst.com` (marketing) + `app.revealyst.com` (app/auth) — `docs/infra.md` §6.

### 1.2 Target audience

Two personas, one funnel (`docs/Revealyst_Product_Spec_V2.md` §3, §6a):

1. **Buyer — CTO / VP Eng / technical founder** at engineering-led companies,
   **25–200 employees**. Self-serves tooling analytics; will not take a sales call
   for a $2/user product; enterprise 5000+ is explicitly out of scope.
2. **Champion — the individual developer** on free Personal mode who checks their
   own Fluency score and brings Revealyst to their CTO (the "Grammarly/RescueTime
   motion"). Personal mode is free forever by design.

### 1.3 Customer pain points (from `docs/Revealyst_Feasibility_Study.md` §2.2)

- **The ROI void:** MIT's "GenAI Divide" — 95% of enterprise GenAI pilots show no
  measurable ROI; boards are asking "are we getting our money's worth" and CTOs
  have no defensible number.
- **Dashboard fragmentation:** every vendor ships its own dashboard; none is
  neutral ("no AI vendor will ever tell a customer their team uses a competitor's
  tool better") and none aggregates.
- **Shadow AI:** >80% of workers use unapproved tools; adoption is undercounted
  and un-audited (shared-account detection addresses this directly).
- **EU/works-council anxiety:** measuring employees trips GDPR, §87 BetrVG
  co-determination, and EU AI Act worker-notification duties — Revealyst ships
  the DPIA template, works-council note, and AI Act checklist in-product
  (`docs/compliance/`).

### 1.4 Competitive advantages

| Advantage | Grounding |
|---|---|
| Neutral cross-vendor aggregation — the one thing vendor dashboards structurally can't copy | Spec §2, §5 |
| Attribution honesty — never fabricates per-user numbers; every metric carries a confidence tag | `src/contracts/` attribution ladder; landing §04 |
| Privacy by architecture — no prompt content ever, no extension, no proxy; team-level pseudonymized default | Spec §7, §10; `docs/legal/dpa.md` |
| EU-safe / works-council-proof, with compliance guidance shipped in-product | `docs/compliance/*`, `/compliance` page |
| Price — $2/tracked-user/mo, free ≤5 tracked users, vs Larridin $50K+/yr, Jellyfish $35–50/dev/mo, Worklytics ~$2.5K/mo, WakaTime $8.25/user | Spec §11; `src/lib/entitlements.ts` |
| Versioned, inspectable scoring — formulas are published data rows, reproducible forever | `docs/score-definitions.md` |
| Fully self-serve — signup → connect → first score with no sales call | Spec §15 exit criteria |

### 1.5 Primary acquisition opportunities

Ranked by fit with a solo founder (details in later sections):

1. **The share-card viral loop** — already shipped (`/s/[token]` + OG image +
   "Measure your own AI fluency" CTA). Zero marginal effort per acquisition.
2. **SEO/GEO on documentation and score methodology** — the category is new
   ("AI fluency score", "AI adoption analytics", "measure Copilot/Cursor usage");
   low competition, and `docs/connector-facts.md` + `docs/score-definitions.md`
   are ready-made source material.
3. **The benchmark data moat** — anonymized, consented aggregate data published as
   evergreen benchmark reports (the Worklytics playbook; Spec calls it "the
   content moat" and the solo-founder-compatible channel).
4. **Directories** — one-time submissions with permanent backlinks
   (`docs/launch/directories.md` already enumerates them).
5. **The open-source-adjacent CLI** — `revealyst-agent` on npm is a discoverable
   artifact in the `ccusage` tradition.

---

## 2. Solo-Founder Marketing Principles

The founder builds, supports, operates, and markets alone. Time is the scarcest
input, so the portfolio must be **high-leverage assets, not high-volume activity**.

### 2.1 The leverage hierarchy for this product

1. **Product-embedded distribution beats external promotion.** The share card,
   the free Personal tier, the free ≤5-user Team band, and the invite flow are
   marketing that runs whenever the product runs. Improving loop conversion (one
   engineering task) compounds; posting daily does not.
2. **Structural honesty is a maintenance strategy, not just an ethics one.**
   The landing page derives connector claims from `registry.ts` and renders
   `FREE_TRACKED_USER_LIMIT` from code. Every marketing surface should follow
   this pattern — content that *derives from the codebase* never goes stale and
   never needs a manual fact-check sweep (the W3-N/W3-P lesson: prose is a claim
   surface; derived prose can't drift).
3. **Write once, rank forever.** Documentation, methodology pages, benchmark
   reports, and comparison pages are evergreen in a nascent category. A tweet
   decays in hours; `/docs/scores/definitions` accrues authority for years.
4. **Data is the only content nobody else can write.** Aggregated, consented
   usage benchmarks are unique to Revealyst and regenerate themselves as the
   fleet grows. Opinion posts are a commodity; the benchmark report is a moat
   and a V3 flywheel seed (`benchmark_consent`, ADR 0008).
5. **Reuse the existing automation substrate.** The repo already has Cron
   Triggers + Queues (`wrangler.jsonc`, `src/worker.ts`), GitHub Actions CI/CD,
   Analytics Engine telemetry (`src/lib/launch-events.ts`), a funnel-metrics
   script (`scripts/launch-metrics.ts`), and an AI-agent fleet workflow
   (`.claude/` skills/agents). Marketing automation is *additional jobs on
   existing rails*, not a new stack.

### 2.2 Explicitly avoided (not sustainable for one person)

| Excluded activity | Why excluded | Exception |
|---|---|---|
| Daily/weekly social posting | Decaying content, permanent treadmill | Launch-week thread (already written in `announcements.md`); occasional auto-drafted changelog posts the founder approves in bulk |
| Cold email / manual outreach | High effort per lead; product is $2/user self-serve — CAC math never works | None |
| Webinars, demos, sales calls | Spec §15 explicitly requires the CTO question be answerable *without a call* | None |
| Paid ads | Budget-negative at $2/user price point; no compounding | Revisit only if Personal→Team conversion is proven and LTV known |
| Manual partnership/BD | Coordination-heavy, slow, non-compounding | Directory listings (one-time, async) |
| Community moderation (own Discord/Slack) | Permanent daily obligation | Participate opportunistically in existing communities during launch window only |
| Continuous manual content writing | The treadmill this strategy exists to avoid | AI-drafted, founder-approved; sources derived from repo/data (see §5, §8) |

The **one sanctioned manual push** is launch week itself: `docs/launch/launch-plan.md`
is already written, copy is pre-drafted in `announcements.md`, and the whole
sequence is bounded (T-7 → T+7). Its purpose is to seed the automated loops
(share cards in the wild, backlinks, first consented benchmark data) — a one-time
capital investment, not a recurring channel.

---

## 3. Automation-First Marketing Systems

Each system below keeps generating value after initial implementation. Effort
estimates assume the existing fleet workflow (Claude Code agents doing the
implementation, founder reviewing).

### System A — Technical SEO foundation (custom domain, sitemap, robots, metadataBase, static landing)

The single highest-leverage fix. **Update:** the custom domains are now attached
with a marketing/app host split (`revealyst.com` + `app.revealyst.com`,
`docs/infra.md` §6); the remaining SEO plumbing below (sitemap/robots/
`metadataBase` on `revealyst.com`) and the `workers.dev` → canonical 301 are the
outstanding items. Historically production ran only on `revealyst.thapi.workers.dev`
(`docs/infra.md`): a shared `workers.dev` subdomain accrues no domain authority,
looks untrustworthy on directories and in checkout, and every backlink earned at
launch would point at a domain the product doesn't own. The repo also has **no
`sitemap.ts`, no `robots.ts`, no `metadataBase`** (confirmed absent; already
planned in `docs/documenation-plan.md` PR 5), and the landing page is
`force-dynamic` solely to fire a `landing_view` event (`src/app/page.tsx`).

- **Work:** wire the already-purchased `revealyst.com` as the custom domain in
  `wrangler.jsonc` (planned before launch), 301 the workers.dev host, update
  Paddle/auth origins, add `metadataBase` + `sitemap.ts` +
  `robots.ts` (allow all; disallow `/api/`, `/onboarding`, `/invite/`, `/s/`,
  app routes), and move `landing_view` to an edge-side beacon or `after()` so the
  landing can render statically.
- Business impact: **Foundational** — every other organic system depends on it. Do before launch; backlinks are unrecoverable if earned on the wrong domain.
- Implementation effort: **Low** (1–2 days incl. Paddle/auth origin updates; the domain itself is already purchased).
- Ongoing maintenance: **None.**
- Automation potential: n/a — it *is* infrastructure.
- Monthly cost: **~$1–2/mo** (domain renewal, already owned; Cloudflare custom domain free).
- Priority: **P0.**

### System B — Public documentation as an acquisition surface

Execute `docs/documenation-plan.md` as written: MDX docs at `/docs` (getting
started, per-connector pages, `/docs/scores/definitions`, privacy & attribution,
billing, agent ingest), statically prerendered, with the plan's
claim-safety-by-construction pattern (`<ConnectorAvailability/>` from
`registry.ts`, `FREE_TRACKED_USER_LIMIT` interpolated, per-page metadata + OG).

- Business impact: **High** — captures "how to measure Cursor usage", "OpenAI
  admin API usage report", "AI fluency score methodology" queries; doubles as
  onboarding self-service (fewer support requests = founder time back).
- Implementation effort: **Medium** (the plan's 6 PR phases; source material
  already exists in `docs/connector-facts.md`, `docs/score-definitions.md`,
  `docs/compliance/`).
- Ongoing maintenance: **Near-zero by construction** — availability and numbers
  derive from code; adding a connector auto-updates the docs claims.
- Automation potential: High (see §5 content automation).
- Monthly cost: **$0.**
- Priority: **P0** (ship the SEO PR with System A; content PRs can follow launch).

### System C — Share-card loop optimization (the built-in viral engine)

Already shipped: opt-in public score card at `/s/<token>` with a dedicated OG
image and a "Measure your own AI fluency" CTA back to the landing page
(ADR 0008, `src/app/s/[token]/`). Telemetry already counts `share_card_view` /
`share_card_og_view` (`src/lib/launch-events.ts`).

- **Work:** treat loop conversion as a product metric. Instrument the
  card→signup edge (UTM `?ref=sharecard` on the CTA), make card creation a
  first-run prompt after the first score lands, and later add the ADR-0008
  "future work" items (team cards, per-metric links) once volume justifies it.
- Business impact: **High** — the only acquisition channel with zero marginal
  cost per user and built-in social proof ("Measured across real AI-tool usage —
  not self-reported").
- Implementation effort: **Low** (mostly shipped; instrumentation + nudge).
- Ongoing maintenance: **None.**
- Automation potential: **Total** — it runs itself.
- Monthly cost: **$0.**
- Priority: **P0** (instrumentation before launch; nudge tuning after).

### System D — Automated changelog → return-visit channel

No blog/changelog exists today (confirmed absent). Build `/changelog` as MDX
pages generated by a **scheduled GitHub Action**: an AI agent (Claude via API or
`claude -p` in CI) reads merged PR titles/bodies since the last entry, drafts a
user-facing changelog entry, opens a PR; the founder merges (existing CI deploys
previews per PR already — `ci.yml`). RSS feed generated from the same MDX.

- Business impact: **Medium** — freshness signal for SEO/GEO, return visits,
  and a credible "this product is alive" trust marker for solo-founder-wary buyers.
- Implementation effort: **Low–Medium** (one workflow + one MDX route; reuses the
  docs pipeline from System B).
- Ongoing maintenance: **~5 min/week** — review and merge one PR.
- Automation potential: **High** (draft fully automated; human is merge-gate only,
  which the repo's content-honesty rules require anyway).
- Monthly cost: **~$1–5/mo** API tokens.
- Priority: **P1.**

### System E — Benchmark report engine (the data moat)

The launch benchmark post is currently blocked on verified citations + real
dogfooding numbers (`docs/launch/benchmark-post-data-needs.md`). Unblock it once
for launch, then **turn it into an engine**: a scheduled job recomputes
consented, anonymized aggregates (score distributions, adoption/fluency medians
by fleet segment — only from `benchmark_consent = granted` rows per ADR 0008)
and regenerates a standing page, e.g. `/benchmarks/ai-fluency-report`, with an
"updated {date} · N contributing users/orgs" stamp. Re-announce quarterly (one
manual HN/newsletter touch), but the page itself stays current automatically.

- Business impact: **Very high, compounding** — the only content competitors
  cannot copy; earns citations/backlinks; is the stated seed of the V3 benchmark
  network (>100 orgs); directly reinforces the benchmark-consent opt-in loop.
- Implementation effort: **Medium** (aggregate query + static page + a cron
  branch; `scripts/launch-metrics.ts` and `src/lib/benchmarks/` are starting
  points). Honesty rules apply verbatim: draft rows are never presented as
  verified; small N is labeled ("early data from N users").
- Ongoing maintenance: **~1 hr/quarter** (sanity-check the regenerated numbers).
- Automation potential: **High** — data → page fully automated.
- Monthly cost: **$0.**
- Priority: **P1** (launch post first; engine is data-gated on consent volume — see §12 M3).

### System F — Directory & listing layer (one-time, permanent)

Execute `docs/launch/directories.md` exactly as written at T+7: Product Hunt
listing claim, AlternativeTo (as alternative to Worklytics/Jellyfish/WakaTime),
G2, Capterra/GetApp, SaaSHub, Indie Hackers, Uneed/Peerlist; tier-2
opportunistically; skip paid slots and anything bossware-adjacent. Each with
`?ref=<directory>` (telemetry already hostname-aware).

- Business impact: **Medium** — permanent dofollow backlinks to the new custom
  domain + steady referral trickle + AlternativeTo/G2 pages that rank for
  "<competitor> alternative" queries for free.
- Implementation effort: **Low** (~1 day of form-filling; copy is pre-written).
- Ongoing maintenance: **None** (respond to G2 reviews if any appear — minutes).
- Automation potential: Low (one-time manual — acceptable because non-recurring).
- Monthly cost: **$0.**
- Priority: **P1** (after domain + launch).

### System G — GEO / AI-search optimization

CTOs increasingly ask ChatGPT/Claude/Perplexity "how do I measure AI adoption
across my team" — a nascent-category query where being *the* citable source is
winnable. Work: `llms.txt` (+ `llms-full.txt`) generated in the docs build;
JSON-LD (`SoftwareApplication` with real pricing from `entitlements.ts`,
`FAQPage` on docs, `Dataset` on the benchmark report); crisp definitional pages
("What is an AI fluency score?") whose canonical definitions LLMs can quote;
and the methodology transparency Revealyst already has (versioned formulas)
front-and-center — LLMs preferentially cite inspectable methodology.

- Business impact: **Medium today, high on a 12-month horizon** — compounding
  first-mover citation advantage in a new category.
- Implementation effort: **Low** (build-time artifacts piggybacking on System B).
- Ongoing maintenance: **None** (regenerates with each docs build).
- Automation potential: **Total.**
- Monthly cost: **$0.**
- Priority: **P1** (bundle into the docs SEO PR).

### System H — Lightweight lifecycle email (deferred, then automated)

There is **zero email infrastructure** in the repo today (no sender, invites are
copy-a-link per ADR 0004), and the launch plan explicitly defers an email list.
Keep that discipline, but treat email as the retention layer to add **after**
activation data exists: Cloudflare Email Service or Resend (free tier) wired as
a Worker binding, then exactly three automated triggers — (1) onboarding nudge
if `signup → first connection` doesn't complete in 48h (the funnel already
measures this edge in `src/lib/launch-funnel.ts`), (2) "your first score is
ready" with a share-card prompt, (3) a quarterly benchmark-report announcement
(the post-V1 "monthly benchmark email" idea from the launch plan, made
quarterly to stay honest about cadence). No drip sequences, no newsletter
treadmill.

- Business impact: **Medium** — protects the expensive-to-earn signups; the
  activation nudge directly attacks the funnel's biggest drop-off.
- Implementation effort: **Medium** (binding + templates + queue branch; the
  cron/queue substrate in `src/worker.ts` already fans out per-org work).
- Ongoing maintenance: **None** once live (event-driven).
- Automation potential: **Total.**
- Monthly cost: **$0–20/mo** (Resend free tier / CF Email).
- Priority: **P2** (data-gated: needs ≥4 weeks of post-launch activation
  baseline first — see §12 M3).

### System I — Competitor & category monitoring agent

A scheduled AI agent (weekly GitHub Action or Claude Code scheduled task) checks
competitor pricing/positioning pages (Larridin, Jellyfish, DX, Worklytics,
Milestone — the set from the feasibility study) and vendor analytics-API
changelogs (Copilot metrics API, Anthropic/OpenAI usage APIs — which also feed
`docs/connector-facts.md` accuracy), and files a short digest as a GitHub issue
only when something changed.

- Business impact: **Low–Medium** — keeps comparison pages honest and surfaces
  connector-breaking API changes early (dual product/marketing value).
- Implementation effort: **Low.**
- Ongoing maintenance: **Read one issue when it fires.**
- Automation potential: **High.**
- Monthly cost: **~$2–5/mo** tokens.
- Priority: **P2.**

---

## 4. Organic Growth

Channels evaluated for fit; only recommended ones listed with a verdict.

| Channel | Verdict | Rationale (repo-grounded) |
|---|---|---|
| **SEO (docs + methodology)** | **Do — core** | Systems A+B. New category, low competition, source material already written (`connector-facts.md`, `score-definitions.md`, `compliance/`). |
| **Programmatic SEO (bounded)** | **Do — small set** | ~10–20 high-quality generated pages, not thousands: one per connector ("Measure {Cursor/OpenAI/Anthropic/Claude Code} usage & adoption" from `connector-facts.md` + `registry.ts`, "Soon" pages for Copilot/Claude Enterprise that never present-tense), one per score, one per segment persona, one per compliance topic (works council, EU AI Act, DPIA). All template-driven from repo data → self-maintaining. Avoid thin mass generation — the domain is new and can't absorb it. |
| **Comparison/alternative pages** | **Do** | `/vs/jellyfish`, `/vs/worklytics`, `/alternatives/larridin` etc. — the feasibility study's competitor analysis is the source; the honest angle writes itself ("they're $15K+/yr and enterprise-sales; we're $2/user self-serve"). AlternativeTo listing (System F) reinforces. Refresh via the System I monitoring agent. |
| **GEO / AI-search** | **Do** | System G. First-mover citation opportunity in an unnamed category. |
| **Documentation** | **Do — core** | §7 below. |
| **Product-led growth** | **Do — core** | Free Personal mode + free ≤5 Team band + share card + invite flow are all shipped. Marketing's job is only to feed the top of this funnel. |
| **Directories** | **Do** | System F; list exists in `docs/launch/directories.md`. |
| **Open source / npm** | **Do — light** | Publish `packages/revealyst-agent` on npm with a real README ("privacy-first Claude Code usage sync — summaries only, never prompt content"). It's discoverable where `ccusage` users already look, and the README is a permanent acquisition page on npmjs.com. Optionally public-source the agent repo for trust (it runs on user machines; inspectability is a selling point). Not a full OSS program — no roadmap/community obligations. |
| **Templates / resource pages** | **Do — already have them** | The DPIA template, works-council notification, and AI Act checklist (`docs/compliance/`) are genuinely rare, search-worthy artifacts ("AI tool DPIA template", "works council AI monitoring notification"). Publish them as public docs pages (gated nothing) — trust + SEO + the exact objection-handling content the EU buyer needs. |
| **Referral mechanism** | **Share card is the referral program** | No paid referral program: at $2/user the economics don't support one, and it's machinery to maintain. The share card + free band already reward sharing intrinsically. |
| Marketplaces (GitHub/Cloudflare) | **Later** | A GitHub Marketplace listing becomes natural when the Copilot connector ships (it needs a GitHub App anyway — approval already flagged in `docs/approvals.md` territory). Revisit then, not before. |
| Developer communities (Reddit/HN/Slack) | **Launch window only** | Per `launch-plan.md`. Ongoing presence is a treadmill — excluded. |

---

## 5. Content Automation

The repo's own W3-N/W3-P lesson governs everything here: **prose is a claim
surface** (invariant b). Automated content is therefore *derived from
authoritative repo sources*, and anything claim-bearing gets the existing
adversarial fact-check treatment before merge.

| Source in repo | Auto-generated asset | Workflow |
|---|---|---|
| `src/connectors/registry.ts` + `docs/connector-facts.md` | Per-connector docs + marketing pages, "Connects/Soon" strips everywhere | Build-time derivation (pattern already proven on the landing page). Zero drift possible. |
| `docs/score-definitions.md` + score preset rows (mig 0009) | `/docs/scores/definitions` — public, versioned methodology pages | Render from the versioned definition rows; new score version → new page section automatically. |
| `src/lib/entitlements.ts` (`FREE_TRACKED_USER_LIMIT`), Paddle price constant | Pricing page, docs, JSON-LD offers, directory blurbs | Single-source-of-truth interpolation (pattern mandated by CLAUDE.md's W3-M rule). |
| Merged PRs / git history | Changelog entries + RSS | System D: scheduled Action drafts, founder merges. |
| Consented aggregates (`benchmark_consent`, score results) | Living benchmark report + per-score benchmark stats on docs pages | System E: cron recompute → regenerate page. Honesty rules enforced in the generator (withhold under min-N, label draft vs verified). |
| `docs/compliance/*` | Public compliance resource pages + FAQ | One-time conversion to MDX; updated only when the source docs change (CI can diff-detect and flag). |
| `docs/launch/announcements.md` patterns + changelog entries | Drafted social snippets (X/LinkedIn) batched monthly for optional founder approval | AI agent drafts into a file/issue; founder posts in one 10-minute batch or skips entirely — posting is optional, never load-bearing. |
| Support questions the founder answers | FAQ page accretion | When a question is answered twice, an agent turns the answer into an FAQ entry PR. Converts support time into permanent content. |

**Human involvement across all of the above:** review/merge PRs (~15–30 min/week
total), plus a quarterly benchmark sanity check. Nothing requires the founder to
*originate* content on a schedule.

---

## 6. Website Strategy

The site (landing + docs + share cards) is the entire marketing surface. Goals:

1. **Organic discovery.** Custom domain, static rendering, sitemap/robots/
   metadataBase (System A); docs + programmatic pages (Systems B, §4); JSON-LD +
   llms.txt (System G). Every public page gets a canonical URL and OG image
   (the OG pipeline already exists — `src/app/opengraph-image.tsx`,
   `s/[token]/opengraph-image.tsx`).
2. **Conversion.** The current path is already right: every CTA → `/sign-in` →
   free personal workspace, "no sales call". Keep exactly one conversion goal
   (free signup). Add `?ref` tagging on all inbound surfaces (share card CTA,
   docs headers, changelog, npm README) so `launch-metrics` can attribute — the
   hostname-only telemetry design supports this without adding PII.
3. **Self-service onboarding.** `/docs/getting-started` mirroring the onboarding
   wizard, per-connector setup guides with exact key-scope instructions (from
   `connector-facts.md` — being careful to *never* claim vendor keys are
   read-only; Revealyst *uses* them read-only), and the `<10-min signup→score`
   screencast from the launch plan embedded on landing + docs.
4. **Trust.** Solo-founder SaaS asking for API keys must over-invest here:
   public security page (AES-256-GCM envelope encryption, versioned worker-secret
   KEK — **never** the word "KMS"; per `src/lib/credentials.ts` and the DPA),
   ~90-day raw-payload retention, sub-processors (Neon, Cloudflare), DPA on
   request, privacy/terms already live, compliance templates public (§4),
   "built in the open" changelog, and honest benchmark labeling. The pricing
   page keeps the founder-discount sunset date (2026-08-31) visible — an honesty
   tripwire from `launch-plan.md`.
5. **AI discoverability.** llms.txt, structured data, definitional pages,
   stable canonical URLs, and the benchmark report as the citable dataset
   (System G).

---

## 7. Documentation as Marketing

`docs/documenation-plan.md` is already the right blueprint; this strategy adopts
it wholesale and adds the marketing framing:

- **Docs pages are landing pages.** Each `/docs/connectors/<vendor>` page targets
  the query a CTO actually types ("cursor admin api usage", "anthropic usage
  report api", "measure copilot adoption") and ends with the same free-signup CTA.
- **Claim-safety-by-construction is the zero-maintenance mechanism.** Because
  availability, limits, and prices render from `registry.ts` and
  `entitlements.ts`, shipping the Copilot connector *automatically* updates
  every docs and marketing claim — the marketing site maintains itself as the
  product evolves. This is the pattern to extend to every new page.
- **Methodology transparency is the differentiator to lead with.**
  `/docs/scores/definitions` publishing the exact versioned formulas is
  something Larridin/Jellyfish don't do — it earns links, LLM citations, and
  CTO trust simultaneously.
- **Compliance docs are the EU wedge.** The DPIA/works-council/AI-Act pages will
  rank for queries with essentially zero competition and pre-answer the exact
  objections that stall EU purchases.
- **Growth without writing:** new connector → new docs page (template);
  new score version → definitions page grows; benchmark data grows → report
  updates; FAQ accretes from support. The docs section compounds with product
  work the founder is doing anyway.

---

## 8. AI-Powered Marketing

The founder already operates a Claude Code agent fleet with skills, subagents,
hooks, and CI (this repo's entire operating model). Marketing agents are the
same pattern on a schedule. All run as GitHub Actions (`claude -p` headless or
API calls) or Claude Code scheduled tasks; all produce PRs/issues, never
publish directly — the merge button is the founder's only recurring job.

| Agent | Trigger | Does | Output |
|---|---|---|---|
| **Changelog writer** | Weekly cron | Summarize merged PRs into user-facing changelog MDX + optional social snippet | PR |
| **Content fact-checker** | On any claim-bearing content PR | The W3-N adversarial fact-check, mechanized: diff every product claim against `registry.ts`, `entitlements.ts`, `credentials.ts`, `connector-facts.md`; flag "KMS", "read-only scope", present-tense Copilot | PR review comments / CI check |
| **SEO/GEO auditor** | Monthly cron | Crawl own sitemap: broken links, missing metadata/canonicals/JSON-LD, orphan pages; pull Search Console API top queries/impressions and propose title/keyword tweaks | Issue with ranked fixes |
| **Keyword/topic scout** | Monthly cron | Mine Search Console impressions + docs-search misses (once docs search exists) for pages worth adding | Issue: "queries you get impressions for but no page" |
| **Competitor monitor** | Weekly cron | System I: diff competitor pricing/positioning pages + vendor API changelogs | Issue only on change |
| **Benchmark report generator** | Quarterly cron | System E: recompute consented aggregates, regenerate report page, draft the announcement post | PR + draft |
| **KPI reporter** | Weekly cron | Run `npm run launch:metrics` (read-only, exists today) + Analytics Engine SQL API + Search Console → one-page funnel digest | Issue / email to founder |
| **FAQ accretor** | On founder command | Turn an answered support question into an FAQ entry | PR |
| **Directory maintainer** | Quarterly cron | Verify listings (System F) still accurate (price, connector list) | Issue if drift |

Estimated total founder time once running: **~30–45 min/week** (merge PRs, skim
digests), **~$5–15/mo** in API tokens.

---

## 9. Marketing Automation Stack

Everything rides on tooling the project already pays for or that is free:

| Layer | Tool | Status | Cost |
|---|---|---|---|
| Hosting/CDN/edge | Cloudflare Workers + OpenNext | **Existing** | Existing |
| Scheduled jobs | Cloudflare Cron Triggers + Queues (`wrangler.jsonc`) | **Existing** — add branches | $0 |
| CI + content pipelines | GitHub Actions (`ci.yml`, `deploy.yml`) | **Existing** — add workflows | $0 (public-repo minutes or minimal) |
| Product analytics | Cloudflare Analytics Engine (`LAUNCH_EVENTS`) + `scripts/launch-metrics.ts` | **Existing** | $0 |
| Search analytics | Google Search Console (+ Bing Webmaster) | Add after custom domain | $0 |
| Web analytics (optional) | Cloudflare Web Analytics (cookieless — fits privacy positioning) | Add | $0 |
| Domain | `revealyst.com` | **Purchased** — wire before launch | ~$10–20/yr renewal |
| AI agents | Claude API / Claude Code headless in Actions | Existing workflow | ~$5–15/mo |
| Email (deferred) | Cloudflare Email Service or Resend free tier | P2, data-gated (§12 M3) | $0–20/mo |
| Docs/content | `@next/mdx` per `documenation-plan.md` | Planned | $0 |
| Billing/checkout | Paddle (MoR) | **Existing** | Existing |
| Screencast | OBS/Screen Studio one-time (launch plan asset) | One-time | $0–89 once |

**Total new recurring spend: roughly $6–40/month.** No enterprise tools, no
marketing-automation suites, no CRM (there are no sales to manage — by design).

---

## 10. Growth Loops

Only loops the product actually supports:

1. **Score-card loop (shipped):** free Personal score → opt-in share card →
   `/s/<token>` seen by peers (OG image in social/Slack) → "Measure your own AI
   fluency" → signup → new cards. *Reinforce:* System C instrumentation + nudge.
2. **Champion→Team loop (designed-in):** developer gets personal Fluency score →
   shows CTO → team connects org keys, free ≤5 tracked users → 6th tracked user →
   Paddle paywall (`src/lib/access.ts`). Marketing's only job is feeding loop 1.
3. **Docs→SEO→signup loop:** product work (new connector, new score version) →
   docs pages auto-extend (claim-safe derivation) → rankings + LLM citations →
   signups → more product work funded. Zero marginal marketing effort per cycle.
4. **Benchmark data loop (the moat):** users opt into `benchmark_consent` →
   aggregate report improves → report earns links/citations → more signups →
   more consented data → report improves → …and at >100 orgs it matures into the
   V3 industry-benchmark network (a product feature earned by marketing).
5. **Changelog→trust loop:** merged PRs → auto-changelog → RSS/return visits +
   "actively maintained" signal → conversions of solo-founder-wary CTOs →
   revenue → more PRs.
6. **CLI→npm loop (light):** `revealyst-agent` on npm → discovered by Claude
   Code users searching usage tools → README converts → users push data →
   personal scores → loop 1.

---

## 11. Prioritized Automation Backlog

| # | Item | Impact | Automation | Initial effort | Ongoing | Cost | Time to value |
|---|------|--------|-----------|----------------|---------|------|---------------|
| 1 | Wire `revealyst.com` (purchased) + 301 + origin updates (Sys A) | Critical | n/a | ~1 day | None | ~$15/yr renewal | Immediate |
| 2 | sitemap/robots/metadataBase + static landing + JSON-LD + llms.txt (Sys A+G) | Critical | Total | 1–2 days | None | $0 | Days (crawl) |
| 3 | Share-card loop instrumentation + post-score nudge (Sys C) | High | Total | 1–2 days | None | $0 | At launch |
| 4 | Launch execution per `launch-plan.md` (one-off) + directories (Sys F) | High | Manual, bounded | ~1 wk elapsed | None | $0 | Immediate |
| 5 | Docs shell + getting-started + connector pages (Sys B) | High | High (derived) | ~1–2 wks agent time | ~0 | $0 | 4–12 wks (SEO) |
| 6 | Benchmark post unblock (verify 6 citations + dogfood data per `benchmark-post-data-needs.md`) | High | One-time | 2–3 days | None | $0 | Launch +7 |
| 7 | Changelog generator + RSS (Sys D) | Medium | High | 2–3 days | 5 min/wk | ~$3/mo | 2 wks |
| 8 | KPI reporter agent (Sys 8) | Medium | Total | 1 day | Skim weekly | ~$2/mo | 1 wk |
| 9 | Content fact-check CI agent | Medium (risk kill) | Total | 1–2 days | None | ~$2/mo | Immediate |
| 10 | Compliance templates + methodology as public pages | Medium | One-time + derived | 2–3 days | ~0 | $0 | 4–12 wks |
| 11 | Comparison/alternative pages (·vs Jellyfish/Worklytics/Larridin) | Medium | Semi (monitor agent refreshes) | 3–4 days | ~0 | $0 | 6–12 wks |
| 12 | Benchmark report engine (Sys E) | Very high, slow | High | ~1 wk | 1 hr/qtr | $0 | 1–2 qtrs |
| 13 | Lifecycle email ×3 triggers (Sys H) | Medium | Total | ~1 wk | None | $0–20/mo | Data-gated (M3) |
| 14 | SEO/GEO auditor + keyword scout + competitor monitor agents | Low–Med | Total | 2–3 days | Skim monthly | ~$5/mo | Ongoing |
| 15 | npm publish `revealyst-agent` + README page | Low–Med | One-time | 1 day | ~0 | $0 | Weeks |

**Highest-leverage cluster for a solo founder: items 1–3.** They are cheap, fast,
permanent, and every other item depends on (1)–(2) or amplifies (3).

---

## 12. Execution Plan — gate-based milestones

The strategy is implemented by AI agents (the same fleet workflow that builds
the product), so this plan is a **dependency graph with exit gates, not a
calendar** — the same philosophy as `docs/Revealyst_Execution_Plan.md` ("a wave
completes when its exit gate passes"). Three clocks govern pacing, and agents
only compress the first:

- **[A] Effort-gated** — build work. Agents compress this from weeks to days;
  ship as early as dependencies allow.
- **[W] World-gated** — external clocks agents cannot move: SEO indexing
  (4–12 weeks after pages exist), directory approval queues, the calendar-anchored
  launch window, DNS/payment-provider verification.
- **[D] Data-gated** — needs real usage data before building is even *informed*:
  activation baselines, consented benchmark volume, Search Console impressions.
  Building these early means building blind — keep the gate even when effort is free.

**WIP rule (the real bottleneck):** founder review bandwidth doesn't compress.
Every claim-bearing artifact keeps a human merge-gate (rule 4; the W3-N lesson),
so cap concurrent claim-bearing marketing PRs at **~3 open at once** and batch
review. Agents raise throughput; they must not flood the gate that keeps content
honest.

### M0 — Launch-ready foundations
- **Entry:** now.
- **Work:**
  - [W] Close launch blockers: Paddle end-to-end + "minutes" claim (OPEN in
    `launch-plan.md`'s 2026-07-07 fact-check). Founder-in-the-loop by nature;
    gates everything downstream.
  - [A] Items 1–2: wire `revealyst.com` (already purchased) + 301s + origin
    updates; sitemap/robots/metadataBase/JSON-LD/llms.txt; static landing.
  - [A] Item 3: share-card ref-tagging + post-score share nudge.
  - [A] Item 9: content fact-check CI agent — build *first*; it protects every
    later content PR.
  - [A→W] Item 6: benchmark post — agents draft and assemble dogfood metrics
    fast, but citation verification is founder judgment (the post-spec requires
    primary sources or "modeled estimate" reframing).
  - [A] Register Search Console + Cloudflare Web Analytics on the new domain.
- **Exit gate:** domain live and 301'd · SEO plumbing merged · share-card edge
  attributed · fact-check CI green on landing copy · benchmark post
  founder-approved · both launch blockers closed.

### M1 — Launch window
- **Entry:** M0 exit + founder picks the date.
- **Work:**
  - [W] Execute `launch-plan.md` T-7→T+7 as scripted (HN → PH → communities →
    benchmark post → directories, item 4). Calendar-anchored and one-shot — do
    **not** rush entry to this gate; a fast M0 buys quality, not an earlier launch.
  - [A] Item 8: KPI reporter live before T-0 (daily during launch week, weekly after).
  - Capture every support question for the FAQ accretor.
- **Exit gate:** HN/PH shipped · directory submissions filed ([W] approvals
  trail by weeks — fine) · KPI reporter producing digests.

### M2 — The compounding surface (build can overlap M0/M1)
All [A] — pure agent work with no data dependency, so it can be built in
parallel with M0/M1 and merged as review bandwidth allows. Its *payoff* is [W]
(rankings arrive 4–12 weeks after merge), which is exactly why it should ship
as early as possible, not on a day-25 schedule:
- Item 5: docs section per `documenation-plan.md`.
- Item 10: compliance templates + methodology pages public.
- Item 7: changelog generator + RSS.
- Item 15: npm publish the agent CLI.
- Item 11 (pulled forward): comparison/alternative pages — build now from the
  feasibility-study competitor set; only their *refresh loop* waits on Search
  Console data.
- Item 14 (pulled forward): auditor/scout/monitor agents — cheap to build; the
  keyword scout simply reports "insufficient data" until [W] Search Console
  accumulates.
- **Exit gate:** docs + compliance + comparison pages in the sitemap · first
  auto-drafted changelog PR merged · CLI on npm · monitoring agents on cron.

### M3 — Data-gated engines (gates held regardless of agent capacity)
Each item has its own entry gate; build when the gate opens, not before:
- Item 12: benchmark report engine — **entry:** consented volume clears the
  honest-labeling minimum (small-N rule). First auto-regenerated edition = exit.
- Item 13: lifecycle email — **entry:** ≥4 weeks of funnel data showing a
  signup→connect drop-off worth attacking (`launch-funnel.ts` measures the
  edge). If no material drop-off, skip entirely.
- Loop-tuning review — **entry:** enough share-card/ref data to compare loops.
  Kill what produced nothing; double down on the best-converting loop
  (expected: share card or docs SEO).

**Steady state after M3:** founder marketing time ≈ 30–45 min/week (merging
agent PRs, skimming digests) + ~1 hr/quarter (benchmark edition + optional
re-announcement). Everything else runs on cron. Agent capacity changes how fast
milestones are *reached*, never the order of the gates.

---

## 13. KPIs

Minimal dashboard, built on what already exists (`scripts/launch-metrics.ts`,
`src/lib/launch-funnel.ts`, Analytics Engine) + Search Console. One weekly
digest via the KPI reporter agent; no BI tool.

**North-star proxy (from Spec §8):** weekly-active-AI-user rate × fluency vs
benchmark — but for *marketing*, track the funnel that feeds it:

| Metric | Source | Why it matters |
|---|---|---|
| Signups /wk (by `?ref`) | DB + hostname telemetry | Top of funnel, channel attribution |
| Activation rate (signup → first score) & time-to-first-insight | `launch-funnel.ts` (exists) | The <10-min promise; biggest fixable leak |
| Share-card creation rate & card→signup conversions | `share_card_view` events + ref tag | Health of loop 1 (the growth engine) |
| Benchmark-consent opt-in rate | `benchmark_consent` rows | Fuel gauge for the data moat / V3 network |
| Personal→Team conversions & paying orgs / MRR | subscriptions table + Paddle | Revenue truth |
| Tracked users approaching the free band (4–5) | `access.ts` window query | Upgrade pipeline |
| Organic clicks & impressions, top queries | Search Console API | Docs/SEO engine health |
| Referring domains (quarterly) | Search Console / free checker | Directory + benchmark-report backlink payoff |

Explicitly **not** tracked: social followers, post impressions, email open rates,
vanity traffic — none map to a decision a solo founder can act on.

---

## 14. Risks & Trade-offs

### Assumptions
- W3 launch blockers close (Paddle end-to-end checkout is OPEN as of the
  2026-07-07 fact-check in `launch-plan.md`); this strategy starts after that.
- Legal docs (Terms/Privacy/DPA) get their human legal pass (`docs/approvals.md`)
  before heavy inbound traffic.
- Benchmark rows stay `draft` until founder-verified — content honestly labels
  them until flipped (`docs/score-definitions.md`, benchmark-post spec).
- The share-card loop converts. It's the load-bearing assumption of the PLG
  motion; Phase 1 instrumentation exists precisely to test it fast.
- Search demand for the category materializes as AI-measurement budgets grow
  (Gartner trajectory cited in the feasibility study). SEO payoff is 3–12
  months out; the free band means survival doesn't depend on it short-term.

### Dependencies
- **`revealyst.com` + `app.revealyst.com` attached (host split, done)** —
  `docs/infra.md` §6. Cutover touches `BETTER_AUTH_URL` (→ `app.revealyst.com`),
  the GitHub OAuth callback, Paddle-approved domains, and the OG/`metadataBase`
  URLs (→ `revealyst.com`). Still deferred: the `workers.dev` → canonical 301 so
  launch backlinks accrue to the real domain.
- Docs SEO plumbing (sitemap/robots/metadataBase) before any content investment.
- Benchmark engine depends on consent volume; small-N labeling rules protect
  honesty until then.
- Copilot connector (product work, external GitHub App approval) unlocks the
  biggest programmatic-SEO query family ("measure Copilot usage") — until then
  those pages must say "Soon".

### Risks & mitigations
| Risk | Mitigation |
|---|---|
| Automated content drifts into overclaim (the W3-N failure mode) | Content fact-check CI agent (item 9); derive-from-code pattern; founder merge-gate on all published content |
| $2/user revenue means marketing must be near-$0 CAC | Entire strategy is organic/product-led; paid channels excluded |
| "Bossware" misperception harms positioning | Never submit to monitoring/workforce-analytics directories (per `directories.md`); privacy/works-council content front-loaded; share cards are self-share only |
| Solo-founder trust gap (handing over API keys) | Security/trust page, public methodology, DPA, open changelog, inspectable agent CLI |
| Programmatic pages read as thin/spam | Bounded set (~10–20), each genuinely useful, built from real vendor facts |
| Google/LLM ecosystem shifts (AI Overviews eating clicks) | GEO investment (System G) hedges: being the *cited* source wins in both regimes |
| Launch spike with unready funnel wastes the one-shot HN moment | M0's exit gate requires instrumentation + activation path before T-0 (already the launch plan's own gating logic); a fast M0 buys launch quality, not an earlier date |

### Intentionally excluded (not sustainable for one person)
Recurring social posting · cold outreach/SDR motion · webinars & demos · sales
calls (product promise: "no sales call") · paid acquisition · running an owned
community · sponsorships/podcast tours · conference circuit · a paid referral
program · a weekly newsletter treadmill (email is 3 event-driven triggers +
quarterly benchmark note only). Each was excluded because its cost is *recurring
founder hours*, which this strategy treats as the scarcest, least renewable
budget line.

### Guardrails inherited from the repo (non-negotiable)
- Content claims are an invariant-(b) surface: no fabricated numbers, no "KMS"
  language, never claim vendor keys are read-only (Revealyst *uses* them
  read-only), Copilot is "Soon" until registered, founder discount always shown
  with its 2026-08-31 sunset (CLAUDE.md; `launch-plan.md` tripwires).
- Scope tripwires (rule 7) apply to marketing engineering too: no browser
  extension "growth hack", no prompt-content-derived content, no second B2C
  funnel for Personal — Personal stays an org of one on identical machinery.
- Anything touching frozen contracts (new tables for email prefs, etc.)
  follows the ADR process.
