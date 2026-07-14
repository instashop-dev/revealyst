# Revealyst Desktop Data-Collection App — Product Research Report

**Date:** 2026-07-09 · **Author:** Product research (AI-assisted, four parallel evidence streams: product spec/roadmap, codebase capability map, desktop data-source research, feasibility & competitive research) · **Status:** Research → **direction chosen. Founder decision (2026-07-09): adopt §5 sub-case (C)** — desktop collection is individual-opt-in only; on the Personal plan it is the collector, and inside Team orgs it enriches the member's private self-view exclusively (never team rollups, manager-visible surfaces, or billing). Build gates in §5.5.

**Question:** Should Revealyst build a desktop data-collection app? What data would it unlock that the web app + vendor admin APIs cannot get, and what is the business case for Individual (Personal) and Team plans?

---

## 0. Executive summary

**The question is mis-framed as "build a desktop app?" — Revealyst already ships the embryo of one.** The sanctioned local-ingest path exists end-to-end: the `revealyst-agent` CLI (`packages/revealyst-agent`, ADR 0002) reads Claude Code logs, summarizes them *on-device* into metric rows (never prompt content — enforced by the ingest schema's shape), and pushes them to the frozen `POST /api/agent/ingest` route with a device token. The execution plan explicitly anticipated this evolution: *"The desktop-companion branding can grow later; the sanctioned local-ingest path (§10) starts as a CLI"* (`Revealyst_Execution_Plan.md:72-73`).

**Recommendation in one line:** grow the existing CLI into a small always-on desktop companion for the **Personal/Individual plan** (multi-CLI log parsing + auto-sync + tray status), and make **Claude Code's official OpenTelemetry export the Team-plan channel** (Revealyst hosts an OTLP receiver; orgs deploy vendor-documented managed settings — no Revealyst endpoint software required). Do **not** scrape Cursor's local SQLite, do **not** build process/app monitoring, and do **not** deploy a Revealyst binary fleet-wide via MDM as the *primary* Team story — each of those collides with maintenance economics, the privacy positioning, or both.

**Chosen direction (founder, 2026-07-09):** the above, refined by §5's scenario analysis to **sub-case (C)** — the desktop collector is strictly individual-opt-in everywhere. Personal-plan members get it as their collector; Team-org members may opt in voluntarily, with their desktop data confined to their own private self-coaching view (excluded from team rollups, every visibility mode's manager-readable surfaces, and billing). Org-deployed endpoint collection (MDM push of a Revealyst binary) is off the table. The OTel receiver remains a separate, unaffected decision — it is org-owned vendor config, not a desktop app, and (C) is explicitly designed as its conversion bridge.

**Architecture directive (founder, 2026-07-09):** the desktop app is a **lightweight connector** — it collects relevant data and pushes it to the app; processing happens server-side. §5.6 works out what this changes: aggregation/summarization logic moves from the device to the server (a maintenance win that mirrors the existing Cursor per-request-events pipeline), while **content stripping is the one responsibility that cannot move** — the client pushes allowlist-projected, content-free events, never raw logs.

The evidence supports this because the two genuinely unique desktop capabilities split cleanly by plan:

- **Individual:** personal/Pro/Max-plan usage is *structurally invisible* to every vendor admin API — the local path is the only way a free-tier individual gets a score at all. This is the funnel product.
- **Team:** the valuable "desktop-grade" data (per-event tokens/cost, edit accept/reject, real active time, sub-daily timing) is available through Claude Code's *documented, org-enforceable* OTel export — vendor-sanctioned, no file scraping, no per-machine Revealyst binary, and therefore the cheapest-to-maintain and easiest-to-procure version of the same data.

---

## 1. Findings

Findings are grounded in the repo (file:line) or cited web sources. Assumptions are collected separately in §2.

### F1 — The product already has a sanctioned local-collection architecture; the desktop app is an extension, not a new category

- The `Connector`/ingest seam was designed for this. `POST /api/agent/ingest` (frozen contract, `src/contracts/api.ts:216-226`; ADR `docs/decisions/0002-agent-ingest.md`) authenticates with a device token (`rva1.<orgId>.<connectionId>.<secret>`), and its request schema **only admits metric shapes** — subjects, metric records, sub-daily signals, honesty gaps. No field can carry log lines, prompts, file paths, or tool output. Server-side backstops reject person-attribution for non-person subjects and length-bound/control-char-reject the `dim` field as an anti-exfiltration measure (`src/lib/agent-ingest.ts:122-141`).
- Writes are transactional delete-then-upsert within the pushed window ("a push is authoritative for its window"), so a desktop client can re-sync freely without over-counting (`src/lib/agent-ingest.ts:144-209`).
- The shipped client (`packages/revealyst-agent`: `login --token … [--consent-identity]`, `sync [--days 30]`, `status`) already computes exactly the sub-daily signals the schema wants: a 24-slot UTC-hour histogram and peak concurrency via interval-overlap sweep (`packages/revealyst-agent/src/summarize.ts:45-49, 205-207`), feeding `subject_day_signals` (`src/db/schema.ts:512-539`) at `event` granularity — the finest of any source.
- Positioning already accommodates it: the landing page says ingestion is "admin APIs and keys you control" **plus** "the Claude Code local agent, which ingests via the desktop companion, not polling" (`src/app/page.tsx:53,343`). Spec V2 §10 frames the local path as *"genuine self-analytics… WakaTime-precedented, and consent-clean — the opposite of a workplace extension"* (`docs/legacy/Revealyst_Product_Spec_V2.md:212`).
- Hard constraints a desktop app must inherit: browser extensions/proxies are **rejected, not deferred** (positioning, §87 BetrVG, maintenance — `docs/legacy/Revealyst_Product_Spec_V2.md:214`; tripwire, `Revealyst_Execution_Plan.md:165`); no prompt-content ingestion in Team mode, likely ever (`V2:156`); privacy is "architectural, not a setting" (`V2:153`); attribution honesty (invariant b) applies to every new metric.

### F2 — What admin APIs structurally cannot see (the gap inventory the codebase itself documents)

Revealyst's honesty-gap machinery (`HonestyGap`, `src/contracts/connector.ts:24-33`; surfaced via `/api/dashboard/summary`) already names the holes. The ones only local/desktop collection can fill:

| Gap | Evidence | Desktop fixes it? |
|---|---|---|
| **Individual/Pro/Max/Hobby users invisible to every org admin API** (Anthropic, OpenAI, Cursor) | `docs/connector-facts.md` §2, §3; Personal mode exists *because* of this | **Yes — only the local path can.** |
| **Anthropic Console: OAuth/subscription actors silently missing from Claude Code Analytics** (live vendor bug; one org "lost ~15 engineers" of visibility) | `oauth_actors_missing` gap, `src/connectors/anthropic/normalize.ts:29`; facts §3 | **Yes** — local logs/OTel see the user regardless of auth type. |
| **OpenAI: no user dimension on costs; shared/backend keys carry zero person-level signal** | `shared_key_not_person_level`, `src/connectors/openai/normalize.ts:25`; facts §4 | Partially — only for CLI usage (Codex) on that machine. |
| **Copilot (planned): daily grain only, no sub-daily ever; teams <5 suppressed; 2-day latency** | facts §1; `sub_daily_unavailable` | Timing only (process/OTel-adjacent signals); acceptance data is already per-user in the new Copilot metrics API. |
| **`retries` canonical metric: never populated by any vendor** | `src/contracts/metrics.ts` catalog; facts §1–§3 | Yes for Claude Code (OTel `api_request`/`tool_decision` event stream). |
| **True edit accept/reject: absent (OpenAI) or proxy-only (Claude Code logs)** | facts §5: "true accept/reject only via OTel `tool_decision`" | **Yes via OTel**, not via JSONL scraping. |
| **Hands-on active time** — no vendor admin API reports it | all vendors daily-or-coarser | **Yes** — `claude_code.active_time.total` (user vs cli split). |
| **Backfill depth for local data is ~30 days** (Claude Code `cleanupPeriodDays`) | facts §5: "do not promise deep backfill for local data" | Constraint, not capability: a *resident* collector converts this from a 30-day window into continuous history. |

The last row is an under-appreciated argument for an always-on collector over the current run-on-demand CLI: Claude Code prunes local logs, so any sync gap longer than the retention window permanently loses data. A resident agent (or OTel push) makes coverage continuous.

### F3 — What is locally accessible per source, and how stable it is

From web-verified research (citations in the stream reports; load-bearing ones repeated here):

**Documented / vendor-sanctioned (build on these):**
- **Claude Code OTel export** — the headline finding. Officially documented (`https://code.claude.com/docs/en/monitoring-usage.md`): `token.usage` (per model/type), `cost.usage`, `session.count`, `lines_of_code.count`, `commit.count`, `pull_request.count`, `active_time.total`, `code_edit_tool.decision` (accept/reject per language/source), `tool_decision`/`api_request`/`api_error` events — every one carrying `user.id`, `user.email`, `organization.id`, `session.id`. Deployable via **managed settings users cannot override** (MDM-distributable). Prompts/tool params `<REDACTED>` by default. `docs/connector-facts.md:335` already plans this: *"OTel receiver is a complementary enterprise path (later) — same metric names map to both."*
- **Codex CLI** — documented `[otel]` exporter (prompts redacted by default) + `~/.codex/sessions/**/rollout-*.jsonl` transcripts with token counts (`https://developers.openai.com/codex/config-advanced`).
- **Gemini CLI** — documented OTel telemetry, GenAI semantic conventions (`https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/telemetry.md`).
- **Copilot** — locally poor (diagnostic logs only), but the current per-user metrics API covers acceptance/lines/model breakdowns server-side; desktop adds little for Copilot.

**Semi-stable community-parsed (acceptable as best-effort enrichment):**
- **Claude Code `~/.claude/projects/*.jsonl`** — parsed by a large OSS ecosystem (ccusage etc.), but undocumented and on a treadmill: `costUSD` field removed in v1.0.9 days after ccusage launched (`https://github.com/ryoppippi/ccusage/issues/4`); ongoing field chasing per release; and a documented upstream bug produced 10–17× token undercounts (`https://github.com/ryoppippi/ccusage/issues/866`, `https://github.com/anthropics/claude-code/issues/22686`) — an *accuracy* risk that collides with invariant (b) if presented as authoritative. Notably, `revealyst-agent` already lives with this risk today.
- **opencode, aider** — community-parsed local session stores / documented opt-in analytics.

**Reverse-engineered and brittle (avoid):**
- **Cursor `state.vscdb` / `~/.cursor`** — undocumented SQLite; ~2–3 breaking storage refactors per year (SpecStory rebuilt for the 0.43 schema change; 2.2.x corruption; chats moving cloud-side); contains full prompt/code content. Meanwhile Cursor's Teams Admin/Analytics API already provides per-user daily + per-request events server-side — Revealyst's richest existing connector. Local scraping would add Personal-plan Cursor visibility and AI-attributed-lines-per-commit (`ai-code-tracking.db`) at high maintenance cost.
- **ChatGPT / Claude desktop apps** — effectively opaque (ChatGPT encrypted local storage post-2024; Claude desktop keeps chat server-side). Only process-presence signals are available, and those are monitoring-shaped (see F5).

### F4 — Feasibility and cost

- **Tech shape:** headless collector first; Tauri v2 (~8–10 MB, first-party autostart/tray/file-watch plugins) if a tray UI is a launch requirement; Electron disproportionate; a Go daemon (`kardianos/service`) is the lowest-risk headless option for a team with no Rust codebase. Precedent: ccusage itself converged on a Rust core distributed via npm; WakaTime is a Go CLI invoked by editor plugins, not a daemon.
- **Distribution trust:** ~$250–1,000/yr all-in (Apple $99/yr + notarization free; Azure Artifact Signing ~$120/yr — EV certificates no longer buy SmartScreen bypass per Microsoft's own docs). Reading `~/.claude` needs **no** macOS Full Disk Access/TCC prompt (home-dir dot-folders are unprotected), which makes both UX and the Jamf PPPC story clean. Pipeline build ≈ 4–6 engineer-weeks to production grade.
- **Effort:** MVP (Individual: resident agent, multi-CLI parsing, auto-sync, macOS-first) ≈ **6–10 engineer-weeks**. Hardened enterprise/Team endpoint agent (Windows/Linux, MDM kits, legal kit, pen test) ≈ **4–6 engineer-months cumulative** plus a standing ~0.15–0.25 FTE format-treadmill tax — the strongest argument for OTel-primary in Team mode, where the marginal build is roughly an OTLP/HTTP receiver endpoint + managed-settings snippet generator, reusing the existing metric mapping.
- **Security posture that survives review:** device-scoped upload-only tokens (already implemented), no vendor credentials on device ever, aggregate-only payload enforced by server schema (already implemented), signed updates with CI-only keys, no listener ports, no server→agent command channel, SBOM + security datasheet for enterprise sales.

### F5 — Privacy/legal: the plans diverge sharply

- **Individual/Personal:** consent-clean self-analytics — the person is data subject, controller, and beneficiary. Spec V2 already blesses this shape (`V2:212`) and even reserves a V2+ "point the desktop companion at your own history" prompt-coaching idea as Personal-mode-only (`V2:147`).
- **Team:** employee consent is not a valid GDPR basis (WP29 2/2017); the employer needs legitimate interest + mandatory DPIA; **BetrVG §87(1)(6) is capability-triggered** — a works council veto attaches to any technical system objectively *capable* of performance monitoring, regardless of intent, and **auto-updates can re-trigger co-determination** if they intensify capability. CNIL's €32M Amazon France fine shows per-minute individual timelines are the enforcement danger zone. Revealyst's aggregate-only, pseudonymized, no-content design is the proportionality argument — but per-person activity durations remain the residual exposure regardless of whether collection is a Revealyst binary or vendor OTel.
- Practical implication: the *collection mechanism* changes procurement/works-council friction (an auto-updating third-party endpoint agent is the hardest sell; vendor-documented OTel config deployed by the org's own MDM is the easiest), but the *data* triggers the same legal analysis either way. Revealyst's existing DPIA/works-council kit (`docs/compliance/`) would need a per-channel addendum, and every claim in it must match the actual upload payload (W3-N content rule).

### F6 — Competitive landscape: the lane is open, with a warning attached

- **No commercial team product ships a desktop agent for AI-usage analytics today.** The commercial field is entirely server-side: Antenna (ex-Software.com) at **$15–29/user/mo** ("read-only API… never read, transmit, or store source code"), DX/Jellyfish/LinearB/Faros at enterprise quotes, WakaTime Team at $21/user/mo (editor plugins, not an agent). The local-parsing lane is occupied exclusively by free OSS individual tools (ccusage, Sniffly, CCSeva, agentsview, ~30 others).
- The lane is open partly *because* first-party server-side surfaces are closing the gap for exactly the flagship tools (Anthropic's own Claude Code analytics dashboard + OTel, Cursor Admin API, Copilot per-user metrics API), and because enterprise buyers have been conditioned to "no endpoint software" as the trust posture.
- **Pricing anchor:** Antenna's $15/user/mo "Copilot Telemetry" tier is the closest analog to what OTel-grade Claude Code data would give Revealyst — collected at a fraction of the cost, against Revealyst's $2 list (`src/lib/entitlements.ts:11`: free ≤ 5 tracked users; landing: "the cheapest answer in the category, on purpose").

---

## 2. Assumptions (explicitly not verified)

1. Effort estimates (6–10 wk MVP; 4–6 mo enterprise; 0.15–0.25 FTE treadmill) are synthesized from verified mechanics, not measured on this team — and this team ships via parallel AI agents, which may compress them.
2. That an OTLP/HTTP receiver is implementable as a Cloudflare Worker route within CPU/body-size limits (OTLP JSON is plain HTTP POST, so likely, but unproven here; batching/aggregation windows need design).
3. Windows/Linux locations of the various local stores mirror the documented macOS layouts (verified only for the standard VS Code userData pattern).
4. ChatGPT **Windows** app storage is as opaque as macOS post-encryption (not directly verified).
5. Demand assumptions: that Personal-mode users want multi-CLI coverage (Codex/Gemini/opencode) beyond Claude Code, and that Team buyers will value sub-daily/acceptance fidelity enough to justify OTel rollout effort. No customer-interview evidence was collected in this pass.
6. That Claude Code's JSONL treadmill pace (~monthly adaptations, per ccusage history) continues; Anthropic could stabilize or break it at any time.
7. Legal-kit costs ($5–15K review, $15–40K pen test) are market-rate assumptions.

---

## 3. Recommendations

### R1 — Reframe: one ingest contract, three collection channels *(updated per the founder's §5(C) decision)*

Keep `POST /api/agent/ingest` + device tokens as the single local-collection contract and grow these channels onto it, in this order:

1. **Now / V2-candidate — opt-in desktop companion (Personal + Team self-view), built as a thin collector (§5.6).** Evolve `revealyst-agent` from run-on-demand summarizing CLI to a small resident connector: watch local session stores (`~/.claude`, `~/.codex`, Gemini CLI, opencode), allowlist-project events to a content-free event schema, and push on change (fixes the 30-day log-retention data-loss window); all aggregation, sessionization, and pricing happen server-side via the existing raw_payloads → queue → normalize pipeline. Optional tray status (Tauri v2) with pause/inspect ("what this agent sees" panel). Privacy-by-shape preserved at the event level. On the **Personal plan** it is the collector — the only way individuals on Pro/Max plans get any score, strengthening the free on-ramp that feeds the Team sale. Inside a **Team org** it is offered per member as strictly voluntary self-analytics whose data feeds only that member's private self-view — the §5(C) shape, with the enforcement gates in §5.5 satisfied first.
2. **Next — Team-plan OTel receiver.** Ship the already-planned OTLP endpoint (`connector-facts.md:335`) + a managed-settings snippet generator in the Connections UI. Unlocks the highest-value Team metrics (true accept/reject, `retries`, active time, per-event cost/model) from a **documented vendor contract**, org-deployed, with no Revealyst endpoint binary — the lowest-friction, lowest-maintenance path to team-visible "desktop-grade" data, and the sanctioned destination for demand that (C)'s self-view whets. Never set `OTEL_LOG_USER_PROMPTS`.
3. ~~**Later, demand-gated — Team endpoint agent via MDM.**~~ **Retired by the §5(C) decision.** Org-deployed Revealyst endpoint binaries are off the roadmap; team-visible fidelity data is the OTel channel's job. Revisit only via a new decision (and ADR) if paying Enterprise customers demand coverage OTel cannot reach — and even then, weigh it against §5.2's works-council analysis rather than assuming opt-in framing rescues it.

### R2 — What NOT to build (tripwire-adjacent)

- **No Cursor local scraping** (brittle, content-laden, and Cursor's admin API already covers Team; Personal-plan Cursor visibility is not worth the treadmill).
- **No process/app/focus monitoring, no window titles, no screen-time APIs** — monitoring-shaped, needs macOS Accessibility grants, and directly undermines "built to pass the works-council test." Shadow-AI *detection* by app presence is a real CTO need but the wrong product for Revealyst's positioning; revisit only as an explicit, separately-consented Enterprise module, if ever.
- **No prompt-content ingestion in Team mode** (existing tripwire; the ingest schema already enforces it — keep it that way). The Personal-mode prompt-coaching idea stays deferred per spec.
- **No auto-update without a change-disclosure channel** for Team deployments (BetrVG re-trigger risk): version-pinned MDM rollouts for enterprise, auto-update for Personal.

### R3 — Business value framing per plan

| | Individual (Personal, $0) | Team ($2/tracked user list) |
|---|---|---|
| **Unique data unlocked** | Their own usage at all (invisible to any admin API); multi-CLI coverage; continuous history past log retention | Accept/reject + retries + active time + sub-daily at person level; recovery of Anthropic's missing OAuth actors; richer `subject_day_signals` for shared-account detection |
| **Value mechanism** | Funnel: better free product → more champions → Team conversions; shareable score card gets real data | Score fidelity (Fluency components currently gap-omitted become live); differentiation vs. server-side-only competitors at 1/7th–1/15th their price |
| **Adoption friction** | Low (self-install, self-benefit, WakaTime-precedented) | Medium (OTel: an MDM config push) to High (endpoint agent: security review + works council) |
| **Privacy posture** | Consent-clean self-analytics | Same legal analysis as today's admin-API data, plus §87 capability trigger; aggregate-only design is the defense |
| **Pricing implication** | Keep free — it's the moat's on-ramp | Don't raise the $2 list; consider OTel/agent-fed fidelity as the substance of the Enterprise tier (currently thin: "custom DPA, SSO on roadmap") |

*Post-decision note:* under §5(C), the Team column's "unique data unlocked" arrives via the **OTel channel** for team-visible surfaces; desktop-sourced data inside Team orgs enriches only the opted-in member's private self-view. The differentiation and pricing rows are unchanged — the OTel channel carries them.

### R4 — Honesty obligations that come with the data

- Local JSONL numbers can be wrong upstream (documented 10–17× undercount bug): keep JSONL-derived spend as `spend_cents_estimated` (already the contract), prefer OTel where both exist, and surface a new honesty-gap kind for "local-log accuracy unverified" rather than silently presenting local counts as authoritative.
- Every new claim in landing/compliance copy about the desktop channel must derive from the ingest schema (W3-N/W3-P rule) — e.g., "the agent uploads only metric rows; here is the schema" is provable today and should stay provable.

### R5 — Decision gates before committing build effort *(partially superseded: the direction decision is made — §5.5; these remain as pre-build validation)*

1. **Demand check (cheap, do first):** instrument `revealyst-agent` sync adoption among current Personal users; interview 5–10 Team prospects on whether accept/reject + active-time fidelity changes willingness to pay or deploy an OTel managed-settings config (the MDM-agent variant of this question is retired).
2. **Ingestion spike (≈1 week, combined):** prove OTLP/HTTP JSON ingestion on a Worker route mapping to existing canonical metrics (assumption #2) **and** the §5.6 event-batch path (body limits, queue batch sizing, server-side normalization cost) in the same spike — the OTel receiver and the thin desktop connector need the identical event-normalization pipeline, so one spike validates both.
3. Any frozen-contract touch (new vendor ids, new honesty-gap kind, new metric keys, the §5.5 self-view marking) requires an ADR per rule 1.

---

## 4. Open questions

- Does Anthropic's Team/Enterprise analytics dashboard roadmap eventually expose an API that erodes OTel's advantage the way Copilot's metrics API eroded the Copilot-local case? (Quarterly vendor re-verification cadence, V1.5, should watch this.)
- Where does the OTel receiver sit architecturally — Worker route vs. a small dedicated collector — given Workers' request-time limits and OTLP batch sizes?
- Is there Personal-plan demand for non-Claude-Code CLI coverage, or is Claude Code 90% of the audience? (Cheap to answer from sign-up survey / agent telemetry.)
- Enterprise-tier packaging: is "endpoint agent + legal kit + pen-test datasheet" the substance that justifies custom pricing?

---

## 5. Scenario analysis — desktop as an individuals-only opt-in (added 2026-07-09)

**Scenario:** the desktop collector is never org-deployed and never mandated; it exists only where an individual personally chooses to install it. This decomposes into three distinct sub-cases with different verdicts, because "individual" and "Personal plan" are not the same population:

- **(A) Personal-plan only** — desktop data exists only in Personal orgs (orgs of one). Team orgs never receive desktop-sourced rows.
- **(B) Individual opt-in inside Team orgs** — employees voluntarily install; their desktop data flows into the team's dashboard and scores.
- **(C) Opt-in inside Team, self-view only** — employees voluntarily install; desktop data enriches only that person's private self-coaching view and is never surfaced in team rollups, any visibility mode, or billing.

### 5.1 What the constraint buys (all sub-cases)

- **Positioning purity.** "We never install anything on an employee's machine without that person's own decision" extends the landing page's "No extension, no proxy" stance (`src/app/page.tsx:122-125`) instead of eroding it. It keeps the WakaTime-precedented self-analytics frame the spec already blessed (`docs/legacy/Revealyst_Product_Spec_V2.md:212`).
- **Cost collapse.** The enterprise hardening tranche disappears: no MDM kits (Jamf/Intune), no version-pinned rollout channel, no fleet supply-chain posture beyond ordinary signed auto-update, and the pen-test/security-datasheet spend can wait for real Enterprise demand. Investment reverts to roughly the Personal-MVP estimate (~6–10 engineer-weeks) plus the standing format-treadmill tax. [A: estimates]
- **Procurement friction avoided.** The strongest competitive headwind found in F6 — buyers conditioned to "read-only API, no endpoint software" — never engages, because the org isn't asked to approve endpoint software.

### 5.2 The legal trap in sub-case (B): individual opt-in is not an escape hatch in Team mode

This is the load-bearing finding, and the spec itself already documents it: **voluntariness does not neutralize the employment-law analysis.**

- Spec V2 explicitly rejects the "opt-in makes it safe" argument: admin-mediated opt-in fails "freely given" under EDPB 05/2020, and **§87(1)(6) BetrVG is triggered by monitoring *capability*, not by intent or consent** (`docs/legacy/Revealyst_Product_Spec_V2.md:157-158`). The feasibility stream independently confirmed both (WP29 2/2017: employee consent invalid as a GDPR basis; BAG case law: capability-based co-determination; auto-updates can re-trigger it).
- Consequence: the moment desktop-sourced person-level rows (active minutes, accept/reject, sub-daily histograms) render on a Team dashboard a manager can see, the system is "objectively capable of performance monitoring" — regardless of who clicked install. A works council can lawfully demand its removal; a German customer deploying (B) without a Betriebsvereinbarung is exposed, and Revealyst's "built to pass the works-council test" claim becomes an invariant-(b)-style overclaim on the compliance pages.
- So (B) still requires the full Team legal kit (DPIA addendum, LIA, works-council template). The opt-in framing *helps proportionality* — it is a genuine mitigating factor — but it does not remove the gate. **"Opt-in for individuals only" therefore does not deliver the legal simplification it intuitively promises, unless the data is also individuals-only on the read side — which is sub-case (C).**

### 5.3 The data-integrity problems in sub-case (B)

Even setting law aside, partial voluntary coverage inside a team damages the product's core promise:

- **Selection bias.** Opt-in populations skew toward enthusiasts. Team Fluency/Adoption scores computed over a mix of desktop-enriched enthusiasts and admin-API-only colleagues systematically flatter the opted-in and understate everyone else — a comparability distortion, which is exactly what the attribution ladder exists to prevent. The ladder doesn't currently model this: two `person`-level rows are indistinguishable even when one person's coverage is 3× richer. Honest handling needs a per-person *coverage* indicator (e.g., a new gap kind or a `sources` badge) — an ADR-gated contract change. [Finding + design gap]
- **Double-counting.** A person resolved from both an admin-API subject (e.g., Anthropic Console API-key actor) and a `claude_code_local` subject would contribute the same underlying usage twice to person-day rollups, since `metric_records` are keyed per *subject* and identities merge subjects into one person. Personal mode avoids this by using the local path *instead of* admin APIs; Team-mode (B) creates systematic overlap and needs explicit source-precedence/dedup rules per metric family. **[Open question — not verified how current rollups handle dual-source persons; must be answered before any (B) build.]**
- **Billing surprise.** `tracked_user` = person with ≥1 metric record (`src/contracts/tracked-user.ts`). An employee using only a personal AI account is invisible today; if they opt in, they *become a billable tracked user* the org never provisioned. The org's bill (and free-band consumption) is then driven by employees' individual choices — a support-ticket generator and a perverse incentive for orgs to discourage opt-in. Mitigable (e.g., desktop-sourced-only people surfaced-not-billed, mirroring the unresolved-subjects rule), but that's another contract decision. [Finding: billing mechanics verified; the dynamic is inference]
- **Permission model change.** Device tokens are minted today via session-authed org connections (`/api/connections/:id/agent-token`). (B) needs member-level self-service token minting inside a Team org — a real (if modest) authz surface change; the `--consent-identity` flag in the CLI shows per-individual consent granularity was already anticipated. [Finding]

### 5.4 Sub-case verdicts

- **(A) Personal-plan only — sound, and is effectively the recommended R1 step 1.** Full funnel value (the only way Pro/Max individuals get scored, continuous history past the ~30-day log window, real data behind shareable score cards and the anonymized-benchmark corpus), zero Team-side legal/comparability complications, minimum spend. Its cost is forfeiting Team fidelity — but per R1, the Team-fidelity story belongs to the OTel channel anyway, which is **not a desktop app** and survives this scenario's constraint untouched (org-owned, vendor-documented config; no Revealyst binary). If the scenario is read strictly as "no org-mandated per-machine collection of any kind," then Team mode keeps only admin-API data, and the Fluency components that need accept/reject/active-time stay gap-omitted — honest, but it concedes the Antenna-style fidelity differentiation.
- **(B) Opt-in feeding Team dashboards — a trap.** It looks like the low-friction middle path but inherits the full works-council gate (5.2) *plus* new selection-bias, double-count, and billing problems (5.3), while delivering patchy coverage. Not recommended in this form.
- **(C) Opt-in, self-view only — the defensible Team-adjacent variant. ← SELECTED (founder, 2026-07-09).** Desktop data enriches only the individual's private self-coaching view (the spec's existing frame: *"Individual view is opt-in and framed as self-coaching, never a manager surveillance leaderboard"*, `V2:159`), is excluded from team rollups, manager-visible surfaces in every visibility mode, and billing. Because no manager-readable output exists, the §87 "capability" argument is at its weakest and the GDPR story approaches genuine self-analytics; selection bias and comparability don't arise because nothing is compared. Product-wise it doubles as the conversion bridge: an employee who loves their private desktop-fed score is the champion for the org-level OTel rollout. Residual caution: the *upload* still lands in the org's tenant, so tenancy/visibility enforcement must be provable (an audit predicate over which surfaces may read desktop-sourced rows), and the works-council kit should still disclose the channel's existence. [Recommendation-grade judgment on verified constraints]

### 5.5 Decision and build gates *(updated — (C) selected by the founder, 2026-07-09)*

**Decision:** the desktop collector ships as **(C)** — individual-opt-in everywhere. Personal-plan members use it as their collector (subsuming (A)); Team-org members may opt in voluntarily, with desktop-sourced data confined to their private self-view. **(B)** (opt-in feeding team dashboards) is out of scope. Org-deployed endpoint agents (former R1 step 3) are retired from the roadmap. Team-visible fidelity data remains the org-owned OTel channel's job (R1 step 2), unaffected by this decision.

**Build gates — all four must be satisfied before the Team-org opt-in surface ships** (the Personal-plan companion is gated only by #2 and ordinary review):

1. **ADR for the self-view-only contract** (rule 1 — this touches frozen contracts). Must cover: (a) how desktop-sourced rows are marked and *provably* excluded from team rollups, benchmarks, every visibility mode's manager-readable surfaces, and shared-account heuristics — including an audit predicate that fails if any new read surface consumes them (the W2 gate-check lesson: new call sites forget guards their siblings had, and predicates pass vacuously unless updated); (b) surfaced-not-billed treatment of people who exist *only* via desktop opt-in (mirroring the unresolved-subjects rule, so an employee's personal choice never moves the org's bill); (c) member-level self-service device-token minting (today `/api/connections/:id/agent-token` is org-connection-scoped — the authz model needs a per-member grant); (d) the **event-level ingest schema** required by the §5.6 thin-collector architecture — content-free by shape (enums, numbers, bounded ids; allowlist semantics), versioned alongside or replacing the current aggregate `agentIngestRequestSchema`.
2. **Dual-source dedup answered.** Define source-precedence rules for a person visible to both an admin-API connector and the local agent, so the member's own self-view never double-counts a session/token — and document the rule where invariant (b) reviews can check it.
3. **Compliance and marketing copy updated to match the shipped shape** (W3-N rule: prose is a claim surface). The works-council kit discloses the channel's existence and its self-view-only boundary; the landing page's "No extension, no proxy" framing gains an accurate "optional personal companion, individual-controlled, self-view only" line derived from the ingest schema, not hand-written claims.
4. **In-product transparency panel** ("what this agent sees / where it goes"): pause, inspect-last-payload, and revoke from the member's own settings — the feature that makes the consent claim true in the UI, not just in prose.

**Sequencing note:** ship the Personal-plan companion first (gates #2 + release review only), then the Team-org opt-in surface once gates #1/#3/#4 land. The OTel receiver proceeds on its own track.

### 5.6 Architecture directive — thin collector, server-side processing *(founder, 2026-07-09)*

**Directive:** the desktop app is a lightweight connector: it collects relevant data and pushes it to the app for processing. No heavy on-device logic.

**What this changes vs. today's baseline.** The shipped `revealyst-agent` CLI is a *thick* client: it parses Claude Code JSONL, infers sessions, builds the 24-slot histograms and peak concurrency, applies dedup, and pushes *finished* daily metric rows (ADR 0002). Under the directive, that inversion flips: the client pushes fine-grained **events**, and the server aggregates them into `metric_records` + `subject_day_signals`. This is not a new pattern for the codebase — it is exactly how the Cursor connector already works: per-request events in, server-side normalization to daily rows and signals at `event` granularity. The desktop connector becomes symmetric with it, and with the planned OTel receiver (also a thin push into server-side processing). All three local/telemetry channels converge on one mental model: **dumb pipes into replayable server-side normalization.**

**Why the directive is right — it inverts the worst risk in this report.** The #1 ranked risk (F4/feasibility) is the format-and-pricing treadmill: Claude Code's JSONL changes roughly monthly, model pricing tables churn, and session-inference heuristics evolve. In a thick client every one of those changes requires shipping, signing, and fleet-updating a binary — and stale agents silently produce wrong numbers, colliding with invariant (b). In a thin client, all volatile logic (pricing, session inference, sidechain dedup, histogram/concurrency computation, new derived metrics) lives server-side, where a fix deploys in one release and — because event batches land as `raw_payloads`, same as every web connector — the server can **re-normalize history retroactively** via the existing delete-then-upsert restatement semantics. A parser bug fixed on Tuesday corrects last month's numbers without touching a single device. The standing maintenance estimate (~0.15–0.25 FTE) shifts from "fleet binary churn" to "ordinary server code," which this team's workflow handles far better. [Finding-grounded design judgment]

**The one responsibility that cannot move server-side: content stripping.** "Collect relevant data" must mean *content-free* data, and the filtering must happen on-device, because raw Claude Code JSONL (and every other local transcript store) contains full prompts, responses, file contents, and tool output. Pushing raw logs and filtering server-side would mean the content has already left the machine — which would simultaneously: (a) trip the no-prompt-content-in-Team-mode tripwire (rule 7); (b) falsify the load-bearing public claims — "No prompt content. Ever." on the landing page, the DPIA, and ADR 0002's guarantee that *"the server never receives log lines, prompt content, file paths, or tool output"* — a W3-N-class overclaim the moment it ships; (c) turn Revealyst's database into a prompt-content breach surface (the DeepSeek exposed-ClickHouse incident is the cautionary tale); and (d) forfeit the §5.2 proportionality argument that makes the Team-org opt-in defensible at all. So the thin client keeps exactly one piece of intelligence: an **allowlist projection** of each log event onto a content-free event schema — copy only known-safe fields (timestamps, model id, token counts, cost fields, tool name, decision enums, session/device identifiers), drop everything unknown. Allowlist, never blocklist: a new free-text field added upstream must be dropped by default, not leaked by default. This is cheap, and it is the *stable* part of the parser — field names change rarely even when the JSONL adds fields; when they do, a small client update follows, but the numbers stay correct in the meantime because unknown fields are ignored, not misread.

**Resulting split of responsibilities:**

| Client (thin, stable) | Server (all volatile logic) |
|---|---|
| Discover + watch local session stores (`~/.claude`, `~/.codex`, …) | Validate against the event-level ingest schema (shape-enforced: enums, numbers, bounded ids — no free text) |
| Allowlist-project events to the content-free schema | Land batches as `raw_payloads`; process via the existing Queues pipeline |
| Batch, compress, push with device token; retry/backoff | Sessionize, dedup (incl. the §5.5 gate-2 dual-source rules), price, aggregate to `metric_records` + `subject_day_signals` |
| Pause/inspect/revoke (transparency panel, gate 4) | Version the normalizer (`claude-code-local@<v>`); re-normalize history on fixes |

**Contract and effort impact.** The ingest surface needs an event-level schema alongside (or versioning) the current aggregate one — that folds into the §5.5 gate-1 ADR rather than adding a new gate. The transparency panel's "inspect last payload" becomes *more* convincing under this design: the user sees a list of timestamped, content-free events, which is a stronger consent artifact than a pre-summarized daily row. Client effort shrinks (watch + project + push is a small daemon); server effort grows modestly but reuses the connector pipeline (raw_payloads → queue → normalize) that already exists. Two flagged assumptions: event batches are larger than daily aggregates, so Workers request-body limits and queue batch sizing need the same ~1-week spike as the OTel receiver (R5.2 — run them together, since the receiver needs the identical event-normalization path); and on-device projection cost is assumed negligible (it is a field copy, not parsing-free — the client still reads JSONL line-by-line, it just doesn't *compute* anything).

**Boundary restated for the build workstream:** "lightweight" = no on-device aggregation, no on-device pricing, no on-device session logic. It does **not** mean raw-log upload. If a future requirement genuinely needs richer payloads, that is a new founder decision with a new privacy analysis — not an incremental widening of the event schema.

---

## Appendix — evidence stream summaries

Four parallel research streams produced the underlying evidence; their full outputs are preserved in the session transcript:

1. **Product spec & roadmap** — spec V3/V2, execution plan, 18 ADRs, landing copy, pricing constants.
2. **Capability map** — contracts, three live connectors + `claude_code_local`, 22 canonical metrics, attribution ladder, honesty-gap inventory, agent-ingest contract, `subject_day_signals` design.
3. **Desktop data sources** — per-tool local formats, stability grades, and the unique-to-desktop capability ranking (web-verified with citations).
4. **Feasibility & competitive** — stack comparison, signing/distribution costs, maintenance-treadmill evidence, competitor collection/pricing survey, EU employee-monitoring law, security posture (adversarially verified; two first-pass claims corrected).
