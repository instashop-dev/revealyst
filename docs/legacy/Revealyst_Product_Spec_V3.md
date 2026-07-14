# Revealyst — Product Specification (V3)

**Version:** 3.0 · **Date:** July 7, 2026
**Superseded by:** [Revealyst Product Specification V4](../Revealyst_Product_Spec_V4.md)
(2026-07-13) — this document remains the V1.5 reference.
**Supersedes:** [Revealyst Product Specification V2.4](Revealyst_Product_Spec_V2.md)
**Scope:** V3 specifies **V1.5 only** — the wave that follows the completed V1 (W0–W3, gate
evidence in [docs/gates/W3-evidence.md](../gates/W3-evidence.md)). The V2-of-the-roadmap
(org-wide expansion) is **parked by founder decision** and appears here only as a
directional note (§13). Everything in Spec V2 §2–§7 (vision, market, architecture, data
honesty, shared accounts, Personal mode, privacy) remains in force except where this
document says otherwise.
**Basis:** the W3 exit-gate evidence, the shipped-code inventory on `main`, the deferred-work
sweep across ADRs/gates/code, and a July-2026 market + vendor-API re-verification. Vendor
facts are grounded in the frozen [docs/connector-facts.md](../connector-facts.md) (evidence
date 2026-07-04) — where any external brief disagrees with connector-facts, connector-facts
wins until a live re-verification changes it via ADR.
**Execution model:** unchanged — parallel AI coding agents against frozen contracts
([Execution Plan](../Revealyst_Execution_Plan.md) rules 1–7 and all seven scope tripwires
carry forward verbatim).
**Changelog:**
- v3.0 — first V1.5 spec. Commits the full V1.5 scope up front (founder decision — no
  launch-signal gating); promotes spend governance from "context" to a module completion;
  schedules the GitHub Copilot connector (facts current in connector-facts §1 since W0-A);
  adds the Custom Index Builder with its guardrail decisions; converts V1's placeholder
  person-level scores and draft benchmarks into calibrated/verified ones; parks roadmap-V2.

---

## 1. What changed from V2 (and why)

| V2 position | V3 position | Reason |
|---|---|---|
| V1.5 scope decided after launch signals ("next connectors by customer demand") | **Full V1.5 scope committed now** | Founder decision. Launch is still pending its five founder close-out actions (§16 entry notes); build capacity is agent-parallel and need not wait |
| Spend Context = summary card + "basic budget alerts" (promised in V2 §9, never shipped) | **Spend Governance module completion**: org budget, threshold alerts (in-app first), drill-down by tool/model | The V1 promise was unmet, and H1-2026 made spend governance table stakes: GitHub moved Copilot to usage-based AI Credits (2026-06-01, per connector-facts §1); agentic workloads multiplied token burn and Anthropic/OpenAI shipped admin spend controls (external market claims, mid-2026 — re-verify before quoting) |
| Copilot connector "Soon" | **Copilot connector ships in V1.5** against the usage-metrics reports API documented in connector-facts §1 | The GitHub App exists (see `docs/approvals.md`); the remaining work is the App-auth credential seam, the report-file ingestion shape, and the founder's live verification run |
| Person-level scores served by placeholder definitions; benchmark rows all `draft` | **Calibrated person-level presets; verified benchmark rows only** | These are claims the product already renders; V1.5's first job is making them true (invariant b) |
| Custom Index Builder = "UI over the engine" one-liner | **Builder fully specified**, including its privacy/honesty guardrails (§8.5) | A no-code builder over person-capable score machinery is a people-scoring surface unless constrained; the constraints are part of the feature, not polish |
| Metric catalog: 22 canonical metrics | **+ agentic usage metrics** (additive, via ADR) | Every vendor added agent telemetry in 2026 (Copilot agent/coding-agent fields, Cursor `agentRequests`, Claude Code sessions); measuring AI adoption without agent usage is measuring 2024 |
| Roadmap-V2 = org-wide expansion next | **Parked — directional only** | Founder decision; V1.5 deepens the engineering beachhead first |

---

## 2. Vision & Positioning — unchanged, sharpened

Everything in Spec V2 §2 stands: neutral third party, cross-vendor adoption + fluency
intelligence, "not employee monitoring." Two 2026 market facts sharpen it:

- **Every vendor now ships a competent free single-tool dashboard** (Copilot usage metrics
  GA, Cursor team analytics, Anthropic Console analytics, OpenAI usage dashboards).
  Single-tool reporting has near-zero standalone value; the defensible layer remains
  cross-tool identity resolution + honest normalized scores + spend-per-outcome — exactly
  the V1 thesis, now with more evidence.
- **Public pushback against individual AI-usage tracking is growing.** Revealyst's frozen
  privacy defaults (team-level pseudonymized, no prompt content, attribution honesty) are a
  differentiator to lead with, not a compliance tax to hide.

Competitive frame for V1.5 (July 2026, pricing claims are external and time-sensitive —
re-verify before quoting in sales contexts): enterprise suites (Faros AI, Jellyfish AI
Impact, DX, LinearB) own large-org AI-ROI analytics; **Swarmia** is the closest self-serve
comparator (free under 10 devs, ~€20–39/dev/mo list). Revealyst's open seat: honest
cross-tool measurement with a free band at a $2 list — an order of magnitude below the
category — for the 25–200 engineering org.

---

## 3–7. Market, architecture, data honesty, Personal mode, privacy — carried forward

Spec V2 §3 (target market), §4 (architecture), §6 (shared accounts), §6a (Personal mode),
and §7 (privacy model) apply unchanged to V1.5, with these deltas:

**§4 delta — report-file ingestion.** The connector pipeline gains one new ingestion shape:
*report-download* vendors. Copilot's usage-metrics API returns signed download links to
NDJSON report files (two-hop fetch) rather than inline JSON (connector-facts §1). The fetch
step runs inside the existing Queue wall-time budget with the same chunked/resumable
discipline as backfill; no new infrastructure.

**§5 delta — the data-reality table, July 2026 (per connector-facts):**

| Vendor surface | Reality | Consequence for Revealyst |
|---|---|---|
| GitHub Copilot | Legacy metrics APIs sunset (2026-03/04); the usage-metrics **reports API** (GA 2026-02-27) is the only surface: per-user daily NDJSON reports, agent/CLI/code-review fields, history floor 2025-10-10, data finalizes ≤3 UTC days with restatements; billing switched to usage-based **AI Credits** (2026-06-01), with the per-user daily `ai_credits_used` field existing only **since 2026-06-19** — earlier days are absence, never zero | Build only against the reports API; reuse the restatement re-poll pattern; spend arrives as **credits, not cents** (§10.1) |
| Anthropic | Two org surfaces with non-interchangeable keys: Console Admin key (usage/cost + Claude Code Analytics) and claude.ai **Enterprise** Analytics key; known gap: OAuth/subscription actors missing from Claude Code Analytics in practice (bug #27780); claude.ai **Team** has no API — dashboard + CSV only (**NLV-A6**); Bedrock/Vertex-routed Claude Code invisible to both | Console connector (shipped) keeps surfacing the OAuth honesty gap; the Enterprise connector remains parked (§10.4) |
| OpenAI | Usage API groups by `user_id` at 1m/1h/1d — `user_id` = the API-key owner (connector-facts' most load-bearing attribution fact, still **NLV-O1**); **costs endpoint has no per-user grouping** — per-user spend is only derivable as usage × price | Per-user OpenAI spend is always labeled **derived/estimated**, never presented as vendor-reported (invariant b) |
| Cursor | Rich Admin API (per-user daily + event-level); unpaginated `daily-usage-data` returns **active users only**; today's row mutates (hourly aggregation), trailing 24–48h unstable | Shipped connector already paginates; spend reconciliation notes in connector-facts §2 govern |
| Vendor-reported vs derived cost | Anthropic + Cursor report per-user cost; OpenAI derived-only; Copilot per-user credits (dollar-true billing needs a deliberately-deferred heavyweight permission, §10.1) | The honesty ladder distinguishes **vendor-reported cost** from **derived/estimated cost** wherever spend renders |

**§7 delta — none.** No prompt content, team-level pseudonymized default, opt-in self-view:
unchanged and non-negotiable. The Custom Index Builder inherits these constraints (§8.5).

---

## 8. Metrics, Scores & Benchmarks — the V1.5 upgrades

### 8.1 Calibrated person-level score presets (closing the W2-I debt)
V1 ships person-level self-view scores from **placeholder** definitions (org-scoped
fixtures, explicitly marked for replacement). V1.5 replaces them with **global person-level
preset definitions** (Adoption, Fluency, Efficiency at `subject_level: person`), calibrated
against the founder-dogfooding dataset via the existing operator tool
(`scripts/calibrate-scores.ts`), each with an oracle row per ADR 0003. Definitions are new
versioned rows; placeholder history is never edited (the frozen versioning contract).
*Founder dependency:* calibration requires the recorded real-payload dogfooding data that
also unblocks the W3 golden test — one dataset, two debts.

### 8.2 Verified benchmarks
All three seeded benchmark rows are `status: draft` with no verified primary sources; the
team panel currently renders modeled estimates labeled as such. V1.5: (a) founder verifies
primary sources and lands the verified rows; (b) an ADR extends the benchmark shape with
the **percentile-curve** structure the panel renders (the future-ADR noted in ADR 0007);
(c) the panel swaps from `norms.ts` modeled estimates to the verified DB source and the
"modeled estimate (unverified)" labels come off. Until (a)–(c) complete, the current honest
labeling stays — the swap is atomic per surface, never partial.

### 8.3 Agentic usage metrics
Additive metric-catalog entries (ADR + migration) for agent-mediated work: agent sessions,
agent requests, agent-initiated code activity — sourced from Copilot's agent/coding-agent
fields, Cursor's `agentRequests` and agent analytics, and Claude Code session metrics.
These are Level-1 metrics like any other: attribution-tagged, never fabricated, available
to score definitions and the Builder. Scoring changes that *use* them are new definition
versions, not edits. Ingestion across all three source vendors — including the small
`normalize()` additions to the shipped Cursor and Anthropic connectors that map their
existing agent fields onto the new keys — is owned by W4-T alongside the catalog ADR
(§16); this is the one deliberate exception to §10.2's maintenance-only posture.

### 8.4 Segmentation, indexes, north star — unchanged
Skeptics · Casual · Power Users · AI Natives, org-level indexes, and the V1 north-star
proxy (weekly-active rate × fluency vs benchmark) carry forward.

### 8.5 Custom Index Builder (the V1.5 flagship)
**What it is:** a no-code UI over the existing scoring engine. Score definitions are already
versioned data rows evaluated by one generic engine; the schema already anticipates
org-scoped custom rows. The Builder lets a Team admin compose a custom index from the
**closed aggregation vocabulary** (`sum`, `avg_per_day`, `active_days`, `distinct_dims`,
ratio components), pick metrics from the catalog, set weights (must sum to 1) and
normalization ranges, **preview against the org's own recent data**, and publish as a
versioned definition. Published definitions join the nightly recompute.

**What it is not (tripwire):** no formula DSL, no per-tenant expressions, no rules engine.
The Builder emits the same zod-validated component data the presets use — UI over data,
exactly as architected in V2 §8.

**Guardrails (part of the feature, not optional):**
1. **Team/org subject level only.** Custom definitions cannot target `person` in V1.5. A
   no-code person-level builder is an admin-built people-scoring surface (§7 / EU AI Act
   exposure). If person-level customs are ever considered, the pseudonymization audit
   predicates must be extended to custom definitions *first* — an audit that doesn't know
   about customs passes vacuously.
2. **No fabricated comparability.** Custom scores never render against the benchmark panel
   and are not shareable via score cards — no benchmark rows exist for a custom formula,
   and a "vs industry" panel next to one would fabricate comparability (invariant b).
3. **Reserved slugs.** `adoption`, `fluency`, `efficiency` (and future global presets) are
   reserved; custom slugs are validated/prefixed so an org cannot shadow a preset (the
   uniqueness key `(org_id, slug, version)` currently permits shadowing).
4. **Bounded cost.** Per-org cap on *active* custom definitions — **recommended 10**
   (nightly recompute cost scales per active definition) — with archive/unarchive rather
   than delete (versioned rows are immutable).
5. **Lapse behavior.** If Team entitlement lapses, custom definitions stop recomputing;
   last results render with an explicit "paused" state — never silently stale numbers.
6. **Tier gating — founder decision, recommendation: Team (paid) only.** The Builder is the
   §11 "expansion from feature depth" lever; Personal/free orgs get the presets.

---

## 9. Core Modules (V1.5)

1. **Adoption Intelligence** — unchanged, plus Copilot data and agentic metrics.
2. **Fluency Intelligence** — unchanged machinery; person-level presets now calibrated
   (§8.1); **Coaching** added: static, team-level recommendations mapped from
   score-component gap patterns (e.g., low breadth → feature-adoption guidance; low
   effectiveness → acceptance-workflow guidance). Content, not ML; team-level framing per
   §7 — never individual callouts.
3. **Spend Governance** *(completes V2 §9's unshipped "basic budget alerts")* —
   - Org monthly budget (admin-set, org-scoped `budgets` table via ADR).
   - **Threshold alerts, in-app first**: dashboard banner + alert row when *observed*
     month-to-date spend crosses configured thresholds. Honesty framing is mandatory:
     vendor spend data is day-grain with up-to-24h latency and vendor restatements —
     alerts fire when observed burn crosses the line, and are never marketed as
     "before overspend."
   - **Email delivery is a flagged founder decision, not an assumption**: the product has
     no email-sending capability today (ADR 0004 — invites are copy-a-link). If chosen,
     email alerts are new infrastructure (Cloudflare Email Service, or the SES option V2
     §12 reserved) with its own secret/deliverability surface.
   - Spend drill-down by tool and model, distinguishing vendor-reported from
     derived/estimated cost (§5 delta).
4. **Custom Index Builder** — §8.5.

**Dashboard deltas:** the team dashboard gains the **honesty-gaps surface** the personal
view already has (W3 finding A5 — same data, same "How complete is this?" framing), plus
the spend-governance card. The **Settings page** (new) hosts org rename and the
visibility-mode control — see §9.1.

### 9.1 Settings & visibility control (privacy-sensitive by design)
V1 renders visibility mode read-only; V1.5 makes it changeable — the single most
privacy-sensitive mutation in the product. Requirements: admin-only; API route added via
ADR (frozen `api.ts`); every change writes an `audit_log` entry; the visibility-readiness
playbook (§6.3) surfaces *at the toggle* with its consent/works-council framing before a
switch away from team-only; `people.displayName` semantics follow the mode exactly as the
schema defines (stays null unless the mode allows it). Default remains Private (team-only)
— switching is deliberate, audited, and reversible.

---

## 10. Integrations (V1.5)

### 10.1 GitHub Copilot connector — ships in V1.5
Everything per **connector-facts §1** (current since W0-A; re-verified 2026-07-04):

- **API:** usage-metrics reports API only — org `users-1-day` / `organization-1-day`
  (each with a `28-day/latest` variant) / `user-teams-1-day` (no 28-day variant);
  NDJSON files behind signed links (two-hop fetch);
  backfill iterates 1-day endpoints (history floor 2025-10-10); team metrics = users ×
  user-teams join; per-user daily fields incl. acceptance activity, LoC
  suggested/added, `used_agent`/`used_copilot_coding_agent`/chat-mode features,
  `ai_adoption_phase`, CLI totals, and per-user `ai_credits_used`.
- **Auth — the GitHub App credential seam** (the recorded W2-J deferral): installation-token
  exchange — App private key as a Worker secret, installation id per connection — a **new
  credential kind and connect flow**, not an admin-key paste. Envelope encryption of the
  stored connection material follows the frozen `connection_credentials` shape unchanged.
- **Restatements:** data finalizes ≤3 full UTC days and past days are restated — reuse the
  framework's restatement re-poll window (as the shipped connectors do).
- **No sub-daily signals** (event-level API sunset): `subject_day_signals` carries
  NULL/`none` granularity, exactly as the schema designed — absence, never fabrication.
  Consequence stated honestly in-product: Copilot subjects don't feed the sub-daily
  shared-account heuristics.
- **Spend honesty:** `ai_credits_used` is **credits, not cents**. V1.5 ships it as a native
  credits metric; any cents conversion is derived/estimated and labeled as such (invariant
  b). Dollar-true billing data requires the org **"Administration (read)"** permission that
  was deliberately deferred for App-review optics — it **stays deferred**; the spec says so
  rather than letting a workstream "helpfully" add it.
- **Personal-mode spend context** (small, §6a.2 upgrade): personal-plan users can read
  their own per-model daily AI-credit spend
  (`GET /users/{username}/settings/billing/ai_credit/usage`) with their own token. Personal
  mode gains Copilot *spend context* — not usage metrics (those remain org-only; the
  honest "connect when on a Team plan" state stays for usage).
- **Preconditions (founder-gated, not agent work):** the live NLV verification run
  (`scripts/verify/copilot.mjs`, 17 open NLV items — link TTLs, rate pools, policy-off
  behavior, restatement magnitude, etc.) against a real Copilot Business/Enterprise org
  with the App installed; App private key wired into deploy secrets. Until the connector
  registers, **every surface keeps Copilot future-tense** (the thrice-relearned W3 lesson).

### 10.2 Shipped connectors — maintenance posture
Anthropic Console, OpenAI (both modes), Cursor: unchanged. Known items tracked in
connector-facts (Cursor row-mutation window and spend reconciliation; OpenAI derived
per-user spend; Anthropic OAuth-actor gap surfaced as an honesty gap). No new work beyond
the quarterly re-verification below — with one exception: the agentic-metric `normalize()`
additions §8.3 assigns to W4-T.

### 10.3 Quarterly vendor-API re-verification — now a calendared cadence
The Execution Plan's post-V1 note becomes operational: once per quarter, run the
`scripts/verify/*.mjs` probes (founder-gated — they read founder keys from env), diff
findings against connector-facts, and land any true divergence via ADR (connector-facts is
frozen). **The V1.5 first run doubles as the Copilot NLV run** (§10.1). Calendar it at V1.5
kickoff; the cadence, not the individual findings, is the deliverable.

### 10.4 Explicitly not in V1.5 (deferred with reasons; revisit triggers noted)
- **`anthropic_claude_enterprise` connector** — separate Analytics key kind (primary-owner
  issued), D+4 engagement freshness with ~4–24h cost lag and a 30-day cost restatement
  window (connector-facts §3); belongs to the parked org-wide expansion. *Trigger: first
  real claude.ai-Enterprise customer.*
- **ChatGPT Business/Enterprise, Claude Team** — parked with roadmap-V2 (Claude Team still
  has no API at all — dashboard CSV only).
- **Gemini Code Assist** (GCP-native: metrics via Cloud Monitoring/Logging/BigQuery sinks,
  not a pollable admin REST surface) · **Windsurf** (Devin/Cognition rebrand churn;
  enterprise API exists but stability unproven) · **Amazon Q Developer** (per-user telemetry
  arrives as CSV-to-S3 export, a different ingestion class) · **JetBrains AI** (console
  reporting only, no public API found). *These four rationales are external July-2026
  research, not connector-facts — re-verify at each quarterly run (§10.3). Trigger for
  each: paying-customer demand plus a stable admin API.*
- **Cursor personal export** (undocumented CSV — NLV-U9) and richer Personal-mode Copilot
  usage: blocked on vendors, tracked in connector-facts.
- **ChatGPT-export upload** IS in V1.5 (Personal mode, §6a) — but it is the designated
  first cut under pressure (§16).

---

## 11. Pricing — unchanged

Personal $0 forever · **Team $2 / tracked user / mo list** (free band ≤5 tracked users;
`FREE_TRACKED_USER_LIMIT` remains the single source of truth rendered everywhere) ·
Enterprise custom (later-stage). The time-boxed **50% founder discount ($1/user effective)
sunsets 2026-08-31** and is always presented with that date. Paddle remains MoR. V1.5 adds
no pricing changes; the Custom Index Builder is the first "expansion from feature depth"
lever (§8.5 guardrail 6 — founder decision on gating, recommendation Team-paid).

---

## 12. Tech Stack — unchanged, two notes

The V2 §12 stack (Next.js monolith on Workers via OpenNext, Neon via Hyperdrive, Cron →
Queues, Paddle MoR, scores as versioned data) carries forward untouched. V1.5 notes:
1. **Report-file fetch** (Copilot NDJSON two-hop) runs inside the existing poller/queue
   wall-time budget, chunked and resumable like backfill. No Containers needed on current
   evidence.
2. **Email delivery** (if the founder opts in for spend alerts, §9) is the only new-infra
   candidate in V1.5 — Cloudflare Email Service or SES, decided explicitly, never implied.

---

## 13. Roadmap

- **V1.5 (this spec)** — §8–§10 scope + §16 execution: calibrated person scores, verified
  benchmarks, Custom Index Builder, Copilot connector, Spend Governance, agentic metrics,
  coaching content, Settings/visibility control, team honesty-gaps, debt paydown
  (bulk-reader ADRs + N+1 fix, retention, route-test harness, health rate limit),
  ChatGPT-export upload, quarterly re-verification cadence.
- **Roadmap-V2 — PARKED (directional only, founder decision):** org-wide expansion (ChatGPT
  Business/Enterprise, Claude Team, SSO/directory sync, non-engineering adoption+spend),
  impact/outcome linkage, quality/stability counter-metrics. The 2026 market signals
  (DORA "AI is an amplifier"; bug/incident-rate concerns; AI-code-churn research) make
  quality counter-metrics the likely first unparked item — but nothing here is committed.
- **V3 (unchanged, further out):** industry benchmark network once >100 orgs contribute
  (consent records are already being stored; nothing is promised).

---

## 14. Key Risks & Mitigations (V1.5)

| Risk | Mitigation |
|---|---|
| Copilot data discontinuities (server-side-telemetry additions shift active-user counts — connector-facts quirks; D+3 restatements; monthly NDJSON schema churn) | Restatement re-poll window; lenient NDJSON parsing per connector-facts quirks; vendor-announced telemetry changes are annotated as discontinuities (dates confirmed at NLV time, never hard-coded from hearsay) rather than read as adoption jumps |
| Copilot NLV run surprises (17 open items — link TTLs, rate pools, policy-off 403s) | NLV run is a §16 entry gate for the connector's *live* integration, not an afterthought; the attribution ladder absorbs degraded granularity |
| Custom indexes create honesty/privacy regressions | §8.5 guardrails are spec, not polish: team/org-only, no benchmark/share rendering, reserved slugs, caps, paused-on-lapse |
| Founder-data dependency stalls calibration (§8.1) and benchmarks (§8.2) | Isolated in one workstream (W4-R) that blocks nothing else; the rest of V1.5 proceeds in parallel |
| Spend-alert overclaim (day-grain data marketed as real-time protection) | Honesty framing baked into §9's Spend Governance copy requirements; alerts described as observed-burn threshold crossings |
| Solo maintenance of a 4th connector | Copilot is report-download + daily grain (no event firehose); quarterly re-verification cadence catches drift on a schedule instead of in production |
| Vendor-native dashboards keep commoditizing | Unchanged V2 answer: live at the cross-tool + honesty layer; V1.5's Builder and spend governance deepen exactly that layer |

---

## 15. Success Criteria (V1.5)

- A Copilot Business org connects via the GitHub App and sees attribution-tagged Copilot
  metrics in its scores within the established time-to-first-insight budget.
- A Team admin builds, previews, and publishes a custom index self-serve — team/org-level,
  no benchmark panel shown against it, within the per-org cap.
- Person-level scores in the Personal self-view come from calibrated global definitions —
  the placeholder fixtures are gone.
- The benchmark panel renders **only** founder-verified rows; the "modeled estimate
  (unverified)" interim labels are retired by the swap, not by relabeling.
- A budget alert fires in-app when observed month-to-date spend crosses the configured
  threshold, correctly distinguishing vendor-reported from derived cost.
- The team dashboard shows the same honesty-gaps alert the personal view has.
- The quarterly vendor-API re-verification has run at least once (doubling as the Copilot
  NLV run) and its findings are reflected in connector-facts via ADR where needed.
- The five W3-gate founder actions and the two W3-O ops deferrals (§16 entry note) are
  done — V1.5's exit gate includes V1 actually being live end-to-end.

---

## 16. V1.5 Execution Plan

**One wave — W4 — all workstreams parallel.** The dependency analysis found no real
cross-workstream build dependencies: each workstream writes the ADRs it needs (rule 1
applies *per workstream*: ADR before code), builds against fixtures (rule 2), and
integrates at the exit gate. Workstream letters continue the A–P + S sequence.

**Entry note — V1 close-out founder actions (prerequisite track, not V1.5 build scope).**
The **five founder actions from the W3 gate** ([W3-evidence §Sign-off](../gates/W3-evidence.md))
remain open and gate the V1.5 *exit* gate (not build start): (1) Paddle prod secrets
(`PADDLE_API_KEY` + `PADDLE_CLIENT_TOKEN`) + re-run Deploy; (2) end-to-end Team purchase
walkthrough; (3) measured TTFI run; (4) `/code-review ultra` independent pass;
(5) benchmark-post data + vendor-payload recordings (also feeds W4-R). **Plus two W3-O ops
deferrals** (from `docs/ops-runbooks.md`, not the gate list): the `[dlq]` Logs alert and the
ops-drill rehearsals (Neon restore, KEK rotation).

| Workstream | Scope | ADRs it writes | Founder gates |
|---|---|---|---|
| **W4-Q — debt & hardening** | Bulk `identities` + bulk `subject_day_signals` readers on `forOrg`, fixing the N+1 call sites recorded in code comments (`src/lib/identity/apply.ts`, `src/lib/reconcile.ts`, `src/lib/shared-account/query.ts` — sweep for others before closing); retention jobs for `audit_log` / `poll_heartbeats` / `connector_runs` (+ heartbeat `observed_at` index); route-handler test harness for `/api/share` + `/api/reconcile`; `/api/health` rate limit | Bulk-readers ADR(s) — the two promised in W2-K PR notes | — |
| **W4-R — calibration & benchmarks** | Golden dogfooding fixtures; calibrated global person-level definitions (new versions + oracle rows); verified benchmark rows; percentile-curve benchmark shape; benchmark-panel swap to the verified DB source | Benchmark percentile shape (extends ADR 0007's noted follow-up) | Dogfooding recordings + primary-source verification — **this workstream is founder-data-gated and blocks nothing else** |
| **W4-T — Copilot connector** | GitHub App credential seam (new credential kind + connect flow); reports-API poller with report-file fetch; users×user-teams join; restatement re-poll; credits-honest spend + Personal-mode spend context; agentic metric ingestion across all three source vendors (incl. the §8.3 `normalize()` additions to Cursor/Anthropic) | Metric-catalog agentic additions (+ migration); GitHub App credential kind (usage of `connection_credentials`, shape untouched) | NLV run (`scripts/verify/copilot.mjs`) against a live Copilot Business org; App private key into deploy secrets |
| **W4-U — Custom Index Builder** | Builder UI (component picker / weights / normalization / preview / versioned publish); §8.5 guardrails 1–5 as code + tests; tier gating per founder decision | `api.ts` builder routes; slug-reservation rule | Tier-gating decision (recommendation: Team-paid) |
| **W4-V — Spend Governance** | `budgets` table; in-app threshold alerts; spend drill-down by tool/model with vendor-reported vs derived labeling | `budgets` table ADR (new org-scoped table → tenant-isolation `SCOPED_READS` entry + non-vacuous B-org seed row, per the completeness tripwire); `api.ts` alert routes | Email-delivery decision (in-app ships regardless) |
| **W4-W — trust UX & content** | Settings page + visibility-mode control per §9.1 (audit entries, playbook-at-the-toggle); team honesty-gaps threading (A5); coaching content (§9); ChatGPT-export upload (lowest priority in this workstream) | `api.ts` settings routes | — |

**Standing:** W1-S integration & E2E harness continues to own contract tests, recorded
fixtures, the tenant-isolation sweep (every new org-scoped table joins `SCOPED_READS` with
a non-vacuous B-org seed), and the wave's evidence pack. **The §10.3 quarterly
re-verification cadence is also owned here**: W1-S calendars it at W4 kickoff; its first
run is W4-T's founder-gated NLV run, and subsequent runs outlive the wave. Exit gate is human-reviewed,
evidence-based, adversarially pre-reviewed — rule 4 unchanged. ADR and migration numbers
are independent sequences; check both (and re-check `docs/decisions/` after final sync —
the W3-M/W3-O collision lesson).

**Cut order under pressure (first listed = first cut):** ChatGPT-export upload → coaching
polish → Index Builder preview niceties. **Never cut:** attribution honesty,
verified-benchmark gating, or the §8.5/§9.1 privacy guardrails.

**Exit gate W4 / V1.5 done:** the §15 success criteria, evidenced in the established
gate-pack style, plus the entry note's founder actions (five W3-gate items + two W3-O ops
deferrals) confirmed live.

---

*This spec is a living document. Vendor API facts are frozen in
[docs/connector-facts.md](../connector-facts.md) and re-verified quarterly (§10.3); competitor
pricing and tier gates move monthly — re-verify before quoting them anywhere
customer-facing.*
