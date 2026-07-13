# Revealyst — V1 Execution Plan

> **Status (2026-07-13):** waves W0–W3 are complete and shipped (V1.5/W4 waves: Spec V3 §16).
> The active plan is the [V4 Execution Plan](Revealyst_Execution_Plan_V4.md) (waves W5–W6 for
> [Product Spec V4](Revealyst_Product_Spec_V4.md)). This document remains the historical record
> and the authoritative home of orchestration rules 1–7 and the seven scope tripwires, which
> bind every V4 workstream verbatim.

**Version:** 2.1 · **Date:** July 4, 2026
**Basis:** [Revealyst Product Spec V2.3](Revealyst_Product_Spec_V2.md)
**Execution model:** The entire app is built by **AI agents running in parallel**. This plan is therefore organized as a **dependency graph of workstreams**, not a calendar. Waves are ordered by hard dependencies only; everything inside a wave runs concurrently. No timelines — a wave completes when its exit gate passes.
**Scope decision:** V1 is built **without a customer-validation track**; the spec's positioning and pricing are taken as given.
**Critical path is human review, not code.** When build is parallel and agent-fast, the schedule is gated by the clocks that *cannot* be parallelized: GitHub App review, Paddle Merchant-of-Record onboarding, and the legal pass on ToS/DPA. Fire every one of these at the earliest wave that permits it (W0 for those needing no live site; the moment W2 produces a live site for Paddle). Treat these as the true critical path; agent build time is not.

---

## 0. Plan-on-a-page

| Wave | Theme | Parallel workstreams | Exit gate |
|---|---|---|---|
| **W0 — Contracts & skeleton** | Everything downstream depends on these | A. Vendor API fact-finding · B. Walking skeleton · C. Core schema & interface contracts | Skeleton in production; the 7-item frozen-contract checklist (schema incl. sub-daily signals, `tracked_user`, encrypted credentials, enforced tenancy, typed interfaces, connector-facts) merged |
| **W1 — Foundation build-out** | Fan out against frozen contracts | D. Connector framework + Anthropic · E. Claude Code local ingest (Revealyst Agent CLI) · F. Scoring engine · G. App shell/auth/design system · S. Integration & E2E harness *(standing)* | Real metrics in Postgres; engine computes scores from fixtures; authenticated app shell live; E2E green on ingest→score |
| **W2 — Product surfaces** | Personal + Team built concurrently | H. Personal onboarding + self-view dashboard · I. Score definitions + benchmarks seed · J. Copilot/Cursor/OpenAI connectors · K. Identity mapping + shared-account detection · L. Team dashboard + privacy modes | Personal: signup → key → score in <10 min. Team: team-level scores from ≥2 connectors with attribution tags |
| **W3 — Commercial & launch** | Monetization and go-live | M. Paddle billing (MoR) · N. Compliance guidance content · O. Hardening/ops · P. Launch assets + share card | Public self-serve signup; Personal free / Team paid via Paddle; launch shipped |

Personal mode still lands **before/alongside** Team surfaces in dependency terms: it needs only the W1 connectors (Anthropic + Claude Code), has zero shared-account/privacy complexity (§6a.3), and produces the shareable score card the launch relies on.

---

## Wave 0 — Contracts & skeleton

Nothing here is optional and little of it parallelizes further: W0's job is to produce the **frozen contracts** that let many agents build concurrently in W1–W2 without integration drift.

### W0-A. Vendor API fact-finding
Verify every V1 connector against a **live account** (open paid accounts where needed):
- **GitHub Copilot metrics API** (GA Feb 2026): auth model, per-user fields, rate limits, minimum plan tier.
- **Cursor Admin + Analytics API** (Teams plan): same.
- **Anthropic** usage/cost + Claude Code Analytics API: confirm the noted gap (non-Enterprise OAuth users not fully returned) and its scoring impact.
- **OpenAI Usage & Costs Admin API**: per-project/per-key granularity; what per-user attribution requires (per-user keys / user IDs).
- **Claude Code local logs**: format/location on Win/macOS/Linux, what `ccusage` parses, OTel export shape.
- Spot-check §6a.2 gap claims (no personal API for Copilot/Cursor individual plans).

Output: `docs/connector-facts.md` — per vendor: endpoints, auth, granularity, rate limits, attribution level (§6.1), field→Level-1-metric mapping. **This is the contract all connector agents build against.**

> File any OAuth/GitHub App approvals **now** — external review lead time is the one clock this plan can't parallelize away.

### W0-B. Walking skeleton
- Next.js TypeScript monolith deployed to Cloudflare Workers via OpenNext adapter.
- Neon Postgres via Hyperdrive; migrations tooling (e.g., Drizzle) from day one.
- One Cron Trigger + Queue consumer running a no-op poll job writing a heartbeat row — proves the poller architecture end-to-end.
- Auth (email + OAuth), CI (typecheck, test, preview deploys).
- Locked decision: single database, `org_id` on every row; **Personal mode = an org of one** — identical machinery to Team (§6a.4).

### W0-C. Core schema & interface contracts
The critical enabler for parallel agents — freeze these before W1 fans out. A post-freeze change is expensive precisely because agents will have built against the frozen version, so the items below are deliberately over-specified now:
- **Entities:** `orgs`, `users` (pseudonymous by default, §7), `teams`, `connections`, `identities` (vendor account ↔ person, many-to-many to model shared accounts).
- **Facts:** `metric_records` per (org, tool, subject, metric, day); subject = person / key / project / account per the attribution ladder; every row carries `attribution_confidence` + `source_connector` + raw-payload reference. Idempotent upsert keys.
- **Sub-daily signals for shared-account detection.** Daily aggregates alone *cannot* express §6.2's heuristics (round-the-clock activity, concurrent usage). The schema must, from day one, carry the intra-day signals those heuristics need — an active-hours histogram and a peak-concurrency measure per (subject, day), or session/event rows where a vendor exposes them. Deciding this at W0 is cheap; retrofitting it after W2-K is built against a daily-only schema is a frozen-contract break.
- **`tracked_user` definition — a billing primitive, defined here not in W3.** Paddle metering, the ≤5 free band, and the paywall all key off this count, so it is a contract, not a billing detail. Define: a tracked user is an identity-resolved person with ≥1 metric_record in the billing period; **unresolved key/account-level subjects are surfaced but not billed** (never fabricate people from shared accounts, §6.1), and a shared account flagged as N-people (§6.2) still counts as its resolved identities only. This keeps billing defensible and aligned with the attribution ladder.
- **Credential security — foundational, not W3 hardening.** Customers' vendor API keys and admin tokens (Anthropic/OpenAI/GitHub/Cursor) are the highest-value secrets in the system and are written by W1–W2 connectors, so encryption-at-rest via a KMS/envelope pattern and the encrypted-credential column shape must be fixed at W0. Device tokens for the Revealyst Agent likewise.
- **Enforced tenant isolation.** Single DB + `org_id`-on-every-row is only safe if scoping is *mechanically enforced* — with many agents writing queries independently, one missing filter is a cross-tenant leak. Mandate Postgres row-level security, or a repository layer that makes org-scoping non-optional, as a frozen contract. Convention will not survive an agent fleet.
- **Metric catalog** (Level 1, §8) as a seeded reference table, not an enum.
- **Raw landing zone** (JSONB) retained long enough to cover a realistic normalization-bug discovery window (e.g. 90 days), then aged out; after that, recompute is score-only (from persisted `metric_records`), since normalization replay is no longer possible. State this trade-off rather than implying raw is kept forever.
- **Interface contracts (typed, in-repo):** `Connector = { auth, discover(subjects), poll(window), normalize(raw) → metric_records }`; `ScoreDefinition` / `ScoreResult` shapes; internal API route contracts for the dashboards. With these frozen, connector agents, the engine agent, and UI agents can all build against fixtures instead of each other.

**Exit gate W0 — frozen-contract checklist (all merged, marked frozen; changes thereafter require an ADR):** (1) skeleton serves an authenticated page in production and the heartbeat job runs on schedule; (2) `connector-facts.md` complete; (3) schema migrations including sub-daily signals; (4) `tracked_user` definition; (5) encrypted-credential shape + KMS wiring; (6) enforced tenant isolation (RLS or mandatory-scoping repository) with a test proving cross-org reads fail; (7) typed `Connector`/`ScoreDefinition`/`ScoreResult`/API-route interfaces.

---

## Wave 1 — Foundation build-out (all workstreams parallel)

### W1-D. Connector framework + Anthropic connector
- Framework: scheduling via Cron Trigger → Queue message per connection; retries, backoff, per-vendor rate limits, `connector_runs` log table (surfaced later as "last synced 2h ago"); **backfill mode** (trailing 30–90 days on first connect) — the enabler of <10-min time-to-first-insight.
- **Backfill must not blow the Queue wall-time budget.** Cloudflare Queues allow minutes, not hours (spec §12), and a 30–90-day backfill across rate-limited vendors can exceed that. Design backfill as **chunked, resumable work** — many small queue messages (e.g. one per day-range per connection) with a cursor — falling back to Cloudflare Containers (the §12 escape hatch) only if a single vendor genuinely needs long unbroken runs. A backfill that silently times out breaks the <10-min promise.
- Anthropic first among vendors: key-based (no approval wait), serves Personal mode fully, exercises spend + usage + Claude Code Analytics API.
- **OpenAI is one connector with two credential modes**, not two connectors: a **personal-key** mode (built here, same pattern as Anthropic, for Personal mode) and an **org-admin** mode (per-project/key, built in W2-J). Same `normalize()`, different auth + attribution level.

### W1-E. Claude Code local ingest — "Revealyst Agent"
- **V1 shape: a CLI** (npm package or single binary), not a tray app — reads Claude Code session logs, summarizes locally to metric records (**never raw prompt content**, §7), pushes via device token. `npx revealyst-agent sync` + optional scheduled task. The desktop-companion branding can grow later; the sanctioned local-ingest path (§10) starts as a CLI.

### W1-F. Scoring engine
- Tables: `score_definitions` (components, weights, normalization ranges, subject level, **version**) and `score_results` (subject, definition+version, period, value, component breakdown, propagated attribution confidence).
- Deterministic evaluation of a definition over `metric_records`. **No DSL, no per-tenant expressions, no rules engine** (§8's explicit non-goals).
- Recompute: nightly + on-demand post-backfill; history recomputable on definition-version change.
- Built and tested against fixture metric data — no dependency on live connectors.

### W1-G. App shell, auth flows, design system
- Authenticated app shell, org/team navigation, invite flow, roles (admin/member), shared UI components, empty/loading/sync-status states. Dashboards in W2 compose from this.

### W1-S. Integration & E2E harness *(standing workstream — starts here, runs through W3)*
Parallel agents each pass their own unit tests, but nothing owns the seams — which is exactly where an agent fleet leaks defects. This workstream owns the end-to-end path (signup → connect → poll → normalize → score → render → bill) and is where the wave exit gates are actually executed:
- **Contract tests** that fail CI when any workstream drifts from a W0-C typed interface.
- **Fixtures derived from *recorded real* vendor payloads** (not hand-written), so live-data integration at each gate matches what agents built against.
- A **tenant-isolation test** (the W0-C gate item) and a **cross-workstream E2E** run added to per-wave gates.
- Produces the **gate evidence pack** every human review consumes (orchestration rule 4): test results, known-truth comparisons against dogfooding data, isolation proofs, adversarial pre-review findings — so the founder judges evidence rather than reading code.

**Exit gate W1:** real Anthropic + Claude Code data lands normalized, attribution-tagged, backfilled, re-pollable; engine computes correct scores from fixtures; app shell live behind auth; E2E harness green on the ingest→score path.

---

## Wave 2 — Product surfaces (all workstreams parallel)

**Build is parallel; integration order is not.** Fixtures (rule 2) let all five workstreams *build* concurrently, but the *exit gates* re-couple them along real dependencies: **W2-I** (score definitions) feeds the numbers **W2-H** and **W2-L** render; **W2-J** (connectors) + **W2-K** (identity/flags) feed **W2-L**. Sequence the *integration* accordingly (I ahead of H/L; J+K ahead of L) even though the code is written at the same time — otherwise the wave feels parallel then stalls at the gate.

### W2-H. Personal mode — onboarding + self-view
- Flow: sign up → connect (Anthropic key · OpenAI key · install Revealyst Agent) → backfill → first-insight screen (consolidated spend + adoption immediately; fluency once enough engaged days exist).
- Self-view dashboard: Adoption · Fluency · Efficiency cards + benchmark panel (vs. published benchmarks) + fluency drill-down (breadth/depth/effectiveness).
- **Shareable score card:** OG-image card ("My AI Fluency: 78") with opt-in public link — the §6a.1 content-moat artifact. Static-image simple.
- **Anonymized-benchmark opt-in:** explicit checkbox with stored consent record (seeds the V3 network; promise nothing).
- Honest "connect when available" states for Copilot/Cursor individual; **ChatGPT-export upload deferred to post-launch**.

### W2-I. Score definitions + benchmark seed
- Seed **Adoption**, **Fluency** (breadth/depth/effectiveness), **Efficiency** as versioned definition rows; calibrate against real W1 data; publish rationale in `docs/score-definitions.md` (doubles as the credibility/content asset).
- Segmentation job: Skeptics · Casual · Power Users · AI Natives, team-level by default.
- Seed the published-data benchmark table (Copilot acceptance norms, Worklytics/Section adoption benchmarks) with citations — benchmarks are load-bearing (§8 L4).
- **Calibration/launch data comes from dogfooding, not a validation gate.** The founder's own Anthropic + Claude Code data (available from W1) plus a handful of friendly developers on Personal mode supply real numbers to tune definitions and to source the launch benchmark post. This is data-seeding and QA, not customer validation — it does not reintroduce the removed pre-build gate, and it is the *only* source of pre-launch user data, so the W3-P launch post depends on it.

### W2-J. Team connectors — Copilot, Cursor, OpenAI Admin
- Each connector is an independent agent task against the W0-C contract: **Copilot** (org admin auth, person-level), **Cursor** (Teams API, person-level), **OpenAI Admin** (per-project/key; per-user only when the customer issues per-user keys — surfaced honestly in UI).
- New work is auth flows (GitHub App / OAuth — approvals filed in W0) and vendor quirks; framework and schema are already fixed.

### W2-K. Identity mapping + shared-account detection
- Vendor account → person mapping via email matching + a manual reconciliation UI; unmatched subjects **stay** at key/account level (never fabricate per-user numbers, §6.1). Manual team assignment (directory sync is V2).
- Shared-account heuristics (§6.2): round-the-clock activity, volume ≫ team median, concurrency patterns → flags with "adoption likely undercounted" callouts + the **visibility-readiness playbook** as static guided content (§6.3) — zero new software.

### W2-L. Team dashboard + privacy model
- Team-level, pseudonymized by default (§7): heatmaps, segments, trends, tool coverage, shared-account flags; 3 cards + benchmark panel at org level (§9).
- **Privacy modes:** Private (team-only, **default**) · Managed visibility · Full visibility. Individual view exists only as opt-in self-coaching (reuses the Personal-mode UI).

**Exit gate W2:** Personal — a fresh account goes key → score in <10 min (instrumented). Team — an org with ≥2 connectors sees team Adoption/Fluency/Efficiency + benchmark panel; shared-account flags fire on seeded test patterns; privacy default verified as team-only pseudonymized.

---

## Wave 3 — Commercial & launch (all workstreams parallel)

### W3-M. Billing — **Paddle (Merchant of Record)**
- **Paddle Billing** with Paddle as MoR: Paddle is the seller of record and handles global sales tax/VAT collection, remittance, and invoicing — a meaningful simplification for a solo founder selling into the EU (no per-country VAT registration; complements the EU-safe positioning).
- Plans: **Personal** free forever · **Team** per-tracked-user at a **$2 list** (founder decision, Spec v2.4) modeled as a **quantity-based subscription**. The metered quantity is the **`tracked_user` count defined in W0-C** (identity-resolved people billed; unresolved key/account subjects surfaced, not billed) — a metering job reports it to Paddle each billing cycle (proration per Paddle's quantity-update rules); free band ≤5 tracked users enforced in-app with the upgrade paywall at the 6th.
- Integrate **Paddle Checkout (overlay)** for self-serve upgrade and **webhooks** (`subscription.created/updated/canceled`, `transaction.completed`) → entitlement state in Postgres; customer portal links for invoices/cancellation.
- Time-boxed founder pricing (**50% off → $1/user**, publicly sunset-dated, per §11) implemented as a Paddle **discount**, never a separate low list price.
- **Approval timing — why later than the GitHub App.** Paddle's MoR onboarding reviews the actual product and a live domain, which don't exist at W0, so it is filed **the moment W2 produces a live site** — not W0 like the OAuth/GitHub App reviews (which need no site). This is the split behind orchestration rule 5. Also: tax-category setup (SaaS) and sandbox coverage in CI.

### W3-N. Compliance guidance content
- DPIA template, works-council notification note, AI Act worker-notification checklist as static onboarding content (§7). ToS/Privacy Policy: template + one legal-review pass (Paddle as MoR covers the *sale*; the product's data-processing terms are still ours).

### W3-O. Hardening & ops
- Poller rate-limit/error-budget review, Neon backup/restore drill, secrets rotation, basic audit log, uptime monitoring, load sanity checks on Queues/Workers.

### W3-P. Launch assets
- Landing page ("See who's actually adopting AI — and how well — across all your AI tools"), score-card viral loop, one benchmark-data blog post (content moat, §14) sourced from **published benchmarks + the W2-I dogfooding data** (there is no other pre-launch dataset — see W2-I), Product Hunt / Hacker News / dev-community launch, directory submissions.
- Metrics instrumentation for §15: time-to-first-insight funnel, activation (first score), share-card rate, Personal→Team conversion signals.

**Exit gate W3 / V1 done:** public self-serve signup live; Personal free and Team paid through Paddle checkout with entitlements enforced; a CTO can answer "who's using AI, how well, and are we getting our money's worth" without a call.

---

## Post-V1 (V1.5 direction)

Per §13: Custom Index Builder as **UI over the existing engine** (the W1-F architecture makes this a frontend project), ChatGPT-export upload for Personal mode, next connectors by customer demand, coaching content, and a **quarterly vendor-API re-verification** cadence (calendar it now — §10/§12 facts move monthly).

---

## Orchestration rules for parallel agents

1. **Contracts before fan-out.** No W1+ workstream starts until W0-C's schema and typed interfaces are frozen. Post-freeze changes require an ADR in `docs/decisions/` and an explicit re-sync of affected workstreams.
2. **Fixtures over coupling.** Engine and UI workstreams build against fixture `metric_records`/`score_results`; connectors build against recorded vendor API responses. Live-data integration happens only at wave exit gates.
3. **One agent, one workstream, one PR chain.** Each lettered workstream is an independently mergeable unit with its own tests; merges to main gated on CI (typecheck, tests, preview deploy).
4. **Integration gates are human-reviewed — thin and evidence-based.** Wave exit gates are never self-certified by the agents that built the code, but the founder reviews **evidence, not code**: the gate checklist results, E2E harness output, the tenant-isolation proof, and dashboards rendered against known-truth data (the founder's own dogfooding data, where the correct spend/usage values are known in advance). Before each human gate, run an **agent adversarial pre-review** — independent review agents that did *not* write the code, prompted to refute rather than confirm — so human attention lands on pre-filtered findings instead of raw diff surface. The founder's role at a gate is judgment only ("do these numbers match reality? would I trust this score?") — hours per gate, not weeks, so the human never becomes the fleet's bottleneck.
5. **External approvals are the critical path — fire them ASAP.** These human-review clocks, not agent build time, set the schedule. GitHub App / OAuth reviews need no live site → **filed in W0**. Paddle MoR onboarding needs a live product/domain → **filed the instant W2 produces one**. Legal ToS/DPA pass → started as soon as data-processing terms are drafted.
6. **The seams have an owner (W1-S).** Per-workstream tests are not enough with an agent fleet; the standing Integration & E2E harness owns contract tests, recorded-payload fixtures, the tenant-isolation test, and the cross-workstream E2E that every wave gate runs.
7. **Scope tripwires** — if any agent is building one of these in V1, stop it: a formula DSL, a browser extension or proxy, prompt-content ingestion in Team mode, a second B2C funnel for Personal, Kafka/ClickHouse, a separate ML service, Chinese-vendor connectors.

## Top execution risks (beyond §14)

| Risk | Signal | Response |
|---|---|---|
| Vendor API surprises invalidate connector-facts | W0-A finds missing per-user fields | Re-scope the affected connector before the W0-C freeze; the attribution ladder absorbs degraded granularity |
| Contract drift across parallel agents | Interface changes appearing outside ADRs | Freeze discipline + typed contracts in-repo + CI contract tests (W1-S) |
| Frozen schema can't support later heuristics | W2-K needs signals a daily-only schema lacks | Sub-daily signals baked into W0-C schema up front; frozen-contract checklist item (3) |
| Cross-tenant data leak from a missing scope | An agent-written query omits `org_id` | Mechanically enforced isolation (RLS / mandatory-scoping repository) + a gate test proving cross-org reads fail — W0-C item (6) |
| Stored vendor credentials compromised | High-value keys/tokens sit in Postgres | Envelope encryption + KMS fixed at W0-C item (5), not deferred to W3 hardening |
| External approvals block W2-J / W3-M | GitHub App / Paddle review still pending | GitHub App filed W0; Paddle filed at first live site; fall back to PAT/admin-key auth for early teams; launch Personal-only if Paddle approval lags |
| Fluency score not credible (garbage-in) | Early users dispute their score | Component-level drill-down + published methodology doc; tune definition versions (cheap by design); calibrate on W2-I dogfooding data |
| Integration debt discovered late | Wave exit gate fails on live data | W1-S harness: fixtures derived from *recorded real* API payloads, not hand-written; raw landing zone replayable within its 90-day retention |
| Human gate becomes the fleet bottleneck | Gate review taking days, waves queuing behind the founder | Evidence-based gates (rule 4) + adversarial agent pre-review; the founder judges the W1-S evidence pack, never reads full diffs |
| Scope creep across many parallel agents | Tripwire items appearing in PRs | Orchestration rule 7 enforced at review; cut order under pressure: ChatGPT-export upload → score-card polish → Cursor connector — never privacy defaults or attribution honesty |
