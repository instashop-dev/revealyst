# Non-engineering role packs — design spec

- **Status:** Draft / groundwork. The scaffolding is built (ADR 0054, mig 0044);
  activation is gated. See ledger **D-TCI-8** and gate **D-DA-5**
  (`docs/product-signoffs.md`).
- **Owner:** P8-NE (non-engineering role-pack groundwork)
- **Purpose:** answer the founder's question — *"can we extract data from the
  desktop connector for non-engineering roles?"* — with an honest, buildable plan.
  This is the artifact the **desktop-agent workstream builds toward**: it maps
  every proposed non-engineering capability to the desktop-agent signal(s) that
  would feed it, and flags which of those signals **do not exist yet**.

> **The hard line (invariant b).** Non-engineering capabilities have **no live
> telemetry today**. Every connector is a developer tool; all 29
> `CANONICAL_METRICS` are coding families; the non-eng telemetry gate is
> OQ-003/OQ-004. Nothing in this spec binds a non-eng capability to a signal that
> doesn't honestly exist, and nothing makes a non-eng capability render a computed
> score. They render **"not yet measured / needs the desktop agent"** until the
> desktop agent emits real signals. This is honest scaffolding, not fake data.

---

## 1. Why the desktop agent is the answer (and vendor APIs are not)

Vendor **admin APIs** (GitHub, Cursor, Anthropic, OpenAI console) report
developer-tool usage — commits, PRs, tokens, seats. There is **no admin API**
that reports how a marketer used AI to draft a campaign or how a salesperson used
AI to research an account. Those signals only exist on the **person's device**,
in how they interact with AI assistants (Claude Code, ChatGPT desktop, Copilot in
M365, etc.).

The **resident desktop agent** (`docs/Revealyst_Desktop_Agent_Execution_Plan.md`)
is the only plausible honest source. Under **D-DA-5** (ratified 2026-07-17), the
on-device extractor may now **read prompt TEXT on-device and emit only
metadata** — bounded enums and counts, never the text, never excerpts. That is
the mechanism that turns "what kind of work is this person doing with AI" into a
content-free, privacy-preserving signal.

**What still binds, hard:** the no-prompt-content-ingestion tripwire binds the
**server** — raw text must never leave the device. The on-device classification
boundary and the emitted-shape allowlist need their **own ADR in the desktop
workstream** before anything text-reading ships (D-DA-5 note).

---

## 2. The universal 7-dimension model (TCI §4.1)

TCI proposes seven *universal* capability dimensions that apply to any knowledge
worker, independent of role. Their honest computability today:

| # | Dimension | Role-agnostic? | Computable today? | Needs the agent? |
|---|---|---|---|---|
| 1 | **Adoption** — do you reach for AI, and how regularly | Yes | **Yes** — `active_day` / session counts already flow for any agent-covered tool | No (for agent-covered tools) |
| 2 | **Workflow Integration** — is AI woven into real work | Yes | Partial — coding has commits/PRs; non-coding needs app/tool-usage breadth | Yes (non-coding) |
| 3 | **Learning Velocity** — do you adopt new features/models over time | Yes | Partial — internally derived from adoption/breadth trend | Mostly no |
| 4 | **Iteration** — do you refine AI output across turns | Yes | Partial — session grouping exists; per-task depth needs classification | Yes (depth) |
| 5 | **Verification** — do you check/test AI output | Yes | Coding only — OTel edit-accept/reject markers exist; non-coding verification does not | Yes (non-coding) |
| 6 | **Communication** — clarity/structure of prompts | Yes | **No** — needs prompt-text reading | Yes (D-DA-5) |
| 7 | **Thinking** — reasoning quality / decomposition | Yes | **No** — needs prompt-text reading | Yes (D-DA-5) |

**Read of the table:** dimensions 1–5 are **role-agnostic** and range from
already-computable (Adoption) to partially-computable to agent-gated.
Communication and Thinking were flatly unmeasurable before D-DA-5 (they require
reading prompt content); D-DA-5's on-device classification is what puts them in
reach — as **directional** proxies (see §5), never calibrated scores.

**Adoption is the one universal capability bindable to an existing role-agnostic
signal (`active_day`).** It is the natural first activation once domain-scoping
lands (ADR 0054 §Deferred). The proof pack in this spec deliberately leaves even
Adoption unbound in the seed, to keep the honesty guarantee and the engineering
byte-identity crisp until the desktop workstream is ready.

---

## 3. What a resident agent can honestly emit

Grounded in `src/lib/agent-collection-schema.ts` (today's content-free allowlist)
and the D-DA-5 override. Every signal below is **content-free** — a count, a
bucket, or a bounded enum. Raw text never leaves the device.

### 3a. Signals that exist today (content-free, tool-agnostic)

These flow for **any** person running an agent-covered AI tool, regardless of
role — they are the honest Adoption/Integration substrate:

- **`active_day`** — a calendar day on which the person used AI. (Adoption.)
- **session counts / session overlap** — how many distinct working sessions,
  and concurrency, bucketed on-device. (Adoption / Integration.)
- **hour-of-day histogram** — coarse time-of-day buckets. (Integration.)
- **token counts, model id** — volume + which model. (Efficiency / model choice.)

### 3b. Signals D-DA-5 unlocks (on-device classification → metadata) — **NOT built**

These are the desktop workstream's **build target**. Each is a bounded enum or
count derived from reading prompt text **on-device only**:

- **`task_category_count[category]`** — each prompt classified on-device into a
  bounded task-category enum (e.g. `research`, `ideation`, `drafting`,
  `summarization`, `analysis`, `review`, `coding`, `planning`), emitted as
  per-day counts per category. **The keystone non-eng signal.** *Does not exist.*
- **`tool_usage_count[tool]` / tool breadth** — which on-device tools / apps /
  MCP tools the person invoked (e.g. a browser-research tool, an image
  generator), as counts. Coding has a `feature_used` analogue; non-eng app usage
  *does not exist* (no M365/Workspace telemetry).
- **`iteration_depth`** — refinement turns per task within a session (follow-ups
  that revise a prior answer), as a bucketed count. *Does not exist* (session
  counts exist; per-task depth needs classification).
- **`verification_behavior_count`** — on-device signals that the person checked
  AI output: asked for sources, requested a fact-check, ran a test, accepted vs
  rejected an edit. Coding has OTel edit-accept/reject markers; non-eng
  verification behaviours *do not exist*.

### 3c. Never emitted (the standing boundary)

Prompt text, assistant replies, tool inputs/outputs, file paths, document
contents, per-model dollar splits. (`AGENT_NEVER_COLLECTED` + the
no-prompt-content-ingestion tripwire.)

---

## 4. The role packs (TCI §4.2)

Seven packs: **Product, Marketing, Sales, Customer Success, HR, Finance,
Operations.** For each capability: the plain-English label, the desktop-agent
signal(s) that would feed it, and the honest confidence tier it could earn.

**Legend — signal status:**
- 🟢 **exists** (content-free, today) · 🟡 **D-DA-5 build target** (on-device
  classification, not built) · 🔴 **no honest source even with the agent** (would
  need a data source that doesn't exist — e.g. CRM/M365 outcome data).

**Confidence tier** (see §5): non-eng capabilities top out at **directional**
until dedicated corroborating markers exist; most are **not-measured** today.

### 4.1 Marketing — the seed proof pack (mig 0044)

| Capability (plain English) | Feeding signal(s) | Status | Tier if built |
|---|---|---|---|
| Research your audience with AI | `task_category_count[research]`, tool breadth | 🟡 | directional |
| Shape campaign ideas with AI | `task_category_count[ideation]`, iteration depth | 🟡 | directional |
| Draft marketing copy with AI | `task_category_count[drafting]`, iteration depth | 🟡 | directional |
| Repurpose content with AI | `task_category_count[summarization/drafting]`, tool breadth | 🟡 | directional |
| Work through search tasks with AI | `task_category_count[research/analysis]` | 🟡 | directional |
| Create visuals with AI | `tool_usage_count[image-gen]` | 🟡 | directional |
| Make sense of results with AI | `task_category_count[analysis]`, verification behaviours | 🟡 | directional |

*Campaign performance outcomes (CTR, conversions) are 🔴 — they need marketing-
platform data Revealyst does not ingest and would fabricate if scored.*

### 4.2 Product

| Capability | Feeding signal(s) | Status |
|---|---|---|
| Research users and problems with AI | `task_category_count[research]` | 🟡 |
| Draft specs and PRDs with AI | `task_category_count[drafting]`, iteration depth | 🟡 |
| Summarize feedback with AI | `task_category_count[summarization]` | 🟡 |
| Explore trade-offs with AI | `task_category_count[analysis/planning]`, iteration depth | 🟡 |
| Prototype ideas with AI | `tool_usage_count`, coding signals (if PM builds) | 🟡 |

### 4.3 Sales

| Capability | Feeding signal(s) | Status |
|---|---|---|
| Research accounts with AI | `task_category_count[research]` | 🟡 |
| Draft outreach with AI | `task_category_count[drafting]`, iteration depth | 🟡 |
| Personalize at scale with AI | `task_category_count[drafting]`, tool breadth | 🟡 |
| Prep for calls with AI | `task_category_count[summarization/planning]` | 🟡 |
| Deal / pipeline outcomes | CRM data | 🔴 |

### 4.4 Customer Success

| Capability | Feeding signal(s) | Status |
|---|---|---|
| Draft customer replies with AI | `task_category_count[drafting]` | 🟡 |
| Summarize accounts and tickets with AI | `task_category_count[summarization]` | 🟡 |
| Find answers in docs with AI | `task_category_count[research]`, tool breadth | 🟡 |
| Spot at-risk accounts with AI | `task_category_count[analysis]` | 🟡 |
| Retention / CSAT outcomes | support-platform data | 🔴 |

### 4.5 People / HR

| Capability | Feeding signal(s) | Status |
|---|---|---|
| Draft job posts and comms with AI | `task_category_count[drafting]` | 🟡 |
| Summarize candidates and notes with AI | `task_category_count[summarization]` | 🟡 |
| Answer policy questions with AI | `task_category_count[research]`, tool breadth | 🟡 |
| Plan programs with AI | `task_category_count[planning]`, iteration depth | 🟡 |

### 4.6 Finance

| Capability | Feeding signal(s) | Status |
|---|---|---|
| Analyze numbers with AI | `task_category_count[analysis]` | 🟡 |
| Draft reports and memos with AI | `task_category_count[drafting]`, iteration depth | 🟡 |
| Check work with AI | `verification_behavior_count` | 🟡 |
| Answer finance questions with AI | `task_category_count[research]` | 🟡 |

### 4.7 Operations

| Capability | Feeding signal(s) | Status |
|---|---|---|
| Document processes with AI | `task_category_count[drafting]` | 🟡 |
| Automate routine work with AI | `tool_usage_count`, coding/scripting signals | 🟡 |
| Summarize and route requests with AI | `task_category_count[summarization]` | 🟡 |
| Analyze operational data with AI | `task_category_count[analysis]` | 🟡 |

---

## 5. Confidence tiers (honest labelling)

The mastery engine (`src/scoring/capability-state.ts`) uses four tiers, reused
verbatim: `measured`, `modeled`, `directional`, `not_measured`.

- **`not_measured`** — no bound signal or no evidence → **no row at all**. This
  is every non-eng capability **today** (they bind zero signals). Rendered as the
  honest forming/empty state, never a 0.
- **`directional`** — an uncalibrated proxy. This is the **ceiling** for non-eng
  capabilities even after the agent ships: `task_category_count` is a genuine but
  uncalibrated signal of "did AI work of this kind," not a calibrated mastery.
- **`measured`** — reserved for capabilities with evidence for **≥2 bound
  corroborating markers** (the OTel edit-accept/reject precedent, ADR 0039). No
  non-eng markers exist, so **no non-eng capability can reach `measured`** until
  dedicated behavioural markers are defined and captured. Do not promise it.

The engine already enforces this: it caps at `directional` unless the marker
condition holds, and emits **no row** without evidence. Non-eng packs inherit the
guarantee for free.

---

## 6. Architecture readiness (what Part B built) & what's deferred

**Built now (ADR 0054, mig 0044) — safe-by-default, nothing renders live:**

- `roles.domain_slug` — the person → role → domain → capabilities link.
- Seven non-eng **domains** + one assignable **role** per pack, `is_active=false`
  ("registered, not yet live" — the Copilot/`NLV_PENDING_VENDORS` precedent).
- The **Marketing proof pack** — seven capability *definitions* bound to **zero**
  signals, `is_active=false`, product-defined (W3-N provenance).
- **Proof the engine is honesty-safe** — `tests/capability-noneng-honesty.test.ts`
  pins that an unbound capability yields no row even under rich evidence, and that
  a bound capability's data never spills into an unbound sibling.

**Deferred to the desktop-agent activation PR (gated, do NOT force):**

1. **Domain-scope the graph read** — filter the in-memory graph to the person's
   role's domain in the reducer (engineering default), so a non-eng person is
   evaluated against their pack and `nextCapability` doesn't cross domains. Only
   then may a domain be flipped `is_active=true`. (One extra batched read;
   person-count-independent. Engineering byte-identity holds trivially.)
2. **Bind pack signals** — add `capability_signals` rows once the D-DA-5 emitter
   produces the §3b signals; needs the desktop feature-signal-contract ADR.
3. **Role-aware forming copy** — an honest "AI maturity for [pack] needs the
   desktop app" note; the existing forming empty state is already honest interim.

---

## 7. Build sequence for the desktop workstream

1. **Desktop feature-signal-contract ADR** (D-DA-5 boundary) — define the
   on-device task-category enum + the emitted metadata shape (counts/enums only);
   extend `AGENT_COLLECTION_FIELDS` + `CANONICAL_METRICS` with the new
   content-free signal keys.
2. **Capture real fixtures** (rule 2) of the new emission on a founder device.
3. **Bind + activate the first pack** (Marketing) — add `capability_signals`
   rows, land the domain-scoping reducer change, flip the domain/role/capabilities
   `is_active=true`, and add the role-aware forming copy. Migration-equivalence
   guard must keep the engineering output byte-identical.
4. **Ratify D-TCI-8** and roll out the remaining six packs pack-by-pack, each
   gated on real captured signal for its capabilities — never a hollow pack.
