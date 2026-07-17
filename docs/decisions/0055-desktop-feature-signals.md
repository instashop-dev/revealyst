# 0055 — Desktop feature-signal contract (content-free non-eng signals + the on-device classification boundary)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Desktop Agent execution plan (T5.2, Wave M5); founder decision
  **D-DA-5** (ratified 2026-07-17 — the on-device extractor may read prompt TEXT
  and emit ONLY metadata: bounded enums/counts, never text, never excerpts);
  founder decision **D-TCI-8** (non-eng role packs in scope as scaffolding); the
  feature-signal-contract ADR that **ADR 0054 §Deferred item 2** and the non-eng
  spec (`docs/product/noneng-role-packs-spec.md` §7.1) were waiting for.

## Context

The founder asked the fleet to "start collecting non-developer data." Every
connector today is a developer tool (Claude Code + the Claude export importer);
every `CANONICAL_METRICS` key is a developer-tool family (coding/agentic/OTel —
none is a non-eng signal); there is **no admin API anywhere**
that reports how a marketer, salesperson, or PM used AI. Those signals only exist
on the **person's device**, in how they interact with AI assistants. The resident
desktop agent (`desktop-agent/`, Tauri) is the only plausible honest source, and
**D-DA-5** now permits it to read prompt text **on-device** and emit only
content-free metadata.

ADR 0054 built the non-eng scaffolding (role→domain link, seven pending domains,
a Marketing proof pack bound to **zero** signals) and explicitly deferred *"bind
the pack signals … needs its own feature-signal-contract ADR (plan T5.2)."* This
is that ADR. It has **two jobs**:

1. **Part 1 — an honest viability assessment.** Before defining any signal, state
   plainly what a Tauri desktop agent can *actually* read on a machine, given the
   **hard `no browser extension/proxy` tripwire** (CLAUDE.md, rule 7 — unqualified,
   unlike the Team-mode-scoped prompt-content tripwire). The founder needs the
   truth about how much non-dev data is really reachable, not a fantasy.
2. **Part 2 — the feature-signal contract.** Define the content-free metric keys
   the agent *may* emit, the closed task-category enum, the on-device
   classification boundary, and the enforcement the eventual build must carry.

**This ADR authorizes the contract; it builds no classifier and no migration.**
The `no-prompt-content-ingestion` tripwire that binds the **server** is unchanged:
raw text, excerpts, and free strings never leave the device. The desktop agent
also lives in **one enrollment context only — the person's own Personal workspace**
(D-DA-2, ratified 2026-07-17), so everything below is self-view-only; team value
flows through the established aggregation paths, and manager per-person visibility
stays separately gated (D-TCI-1/ADR 0045).

---

## Part 1 — Honest viability assessment

**Bottom line up front.** Non-developer data collection via the desktop agent is
**thin today, and stays thin until native desktop AI apps both proliferate for
non-dev roles and expose readable local prompt logs.** The scaffolding (ADR 0054)
is correct and the contract below is worth ratifying, but activation will be
**data-starved**, because the majority of non-developer AI use happens in the
**browser** — where the hard tripwire forbids us to look. This is a real product
constraint, recorded honestly, not a temporary engineering gap.

### 1.1 The hard constraint — the browser tripwire

Most non-developer AI use in 2026 is browser-based: **ChatGPT web, Claude web,
Gemini, Perplexity, and Microsoft Copilot in M365 web.** A desktop agent that does
not hook the browser sees a browser as a **single opaque application**: the OS
reports "Chrome is in the foreground," never "the user is in a ChatGPT tab." The
`no browser extension/proxy` tripwire is unqualified and is on the **never-cut**
side of the pressure list (CLAUDE.md, rule 7). Therefore **browser-mediated AI use
is structurally unobservable to this agent** — no content, no attribution, not even
coarse active-time. This is the dominant term, and it is a permanent gap under the
current tripwire, not something the contract below can close.

### 1.2 What native desktop AI apps persist locally

Grounded in what each app is known to do on-device, with uncertainty flagged
honestly (we do not overclaim a readable local store we have not verified):

| Native app | Writes readable local prompt text? | Honest assessment |
|---|---|---|
| **Claude Code (CLI)** | **Yes** — JSONL session logs in a local data dir | Already the agent's source. A **developer** tool — out of non-eng scope. |
| **Claude desktop app** (Electron) | **Unknown / unstable.** May keep an Electron cache (leveldb/IndexedDB) under app-support; conversations are server-authoritative. | Not a documented or stable contract; version-dependent. Treat as **not a reliable source** until verified against a real captured fixture (rule 2). |
| **ChatGPT desktop app** | **Unknown / likely nothing stably readable.** History is server-side; any local cache is undocumented and unstable. | Do **not** assume readable prompts. **Likely nothing usable.** |
| **Copilot in installed M365 desktop apps** (Word/Excel/Outlook) | **No usable local prompt log.** Copilot calls cloud services; the Office apps don't persist third-party-readable Copilot transcripts. | **Effectively unreadable → gap.** (Copilot in M365 *web* is browser → tripwire.) |
| **Perplexity / Gemini desktop** | **Unknown / likely nothing readable.** Primarily web/mobile surfaces. | Treat as **not a source.** |
| GitHub Copilot / Cursor in IDE | Some local logs exist | **Developer** tools — out of non-eng scope. |

**Read of the table:** the *only* app that reliably writes readable local prompt
text today is a **developer** tool (Claude Code). For **non-developer** roles the
set of native apps that (a) exist on a typical work machine and (b) expose a
stable, parseable local prompt log is **approximately empty right now.**

### 1.3 OS-level signals available without a browser hook

Without reading any content and without a browser hook, an OS-level probe can
honestly observe **coarse tool adoption/breadth**:

- **Which AI apps are installed** — enumerate installed applications (macOS
  `/Applications`, Windows registry/Start-menu/Program Files). Content-free;
  identity only.
- **Which native AI apps are running / foreground / coarse active-time** — process
  enumeration + foreground-app polling. Content-free; **app identity only, never
  window titles** (a title can carry document/prompt content — excluded).

These are genuine but **coarse**, and **browser-blind**: they capture "the person
opened/used native AI app X," not the browser-tab AI use that dominates non-dev
work. So even the adoption signal materially under-counts non-dev AI usage.

### 1.4 Conclusion — collectability ranking

Ranking the non-eng spec's proposed signals (`docs/product/noneng-role-packs-spec.md`
§3b) by **real** collectability today:

- **(a) Collectable now** — content-free, no prompt read, no browser hook:
  **native-AI-app adoption / breadth / coarse active-time** (`ai_tool_used`, and
  the existing `active_day`/`sessions` substrate for agent-covered tools). This is
  the honest near-term substrate — but it is **thin** (browser-blind, native-app-only)
  and it enumerates a **new OS probe surface** that needs its own honest disclosure.
- **(b) Collectable only where a native app exposes a readable local prompt log**
  — the D-DA-5 on-device-classification signals (`task_category`,
  `iteration_depth`, `verification_behavior`). The *mechanism* is buildable and
  privacy-safe; the *data source* for **non-dev** roles is **near-empty today**
  (§1.2). So these keys are defined and authorized here, but they will render
  `not_measured` / no-row for non-dev people until such a native, log-exposing app
  is present and a real fixture is captured (rule 2). **Narrow, not near-term.**
- **(c) NOT collectable without crossing the browser tripwire** — the **majority**
  of non-developer AI use (ChatGPT/Claude/Gemini/Copilot on the web). Declared a
  **permanent gap under the current tripwire. NOT built.** Revisiting it would be a
  separate, founder-level tripwire decision, out of scope here.

**What this means for the non-eng packs (ADR 0054, D-TCI-8):** the packs are right
to ship `is_active=false`, bound to zero signals, rendering the honest forming
state. Activating a pack should wait for a **real captured signal** for its
capabilities (spec §7 build sequence), which — per §1.2 — may be a while for
browser-first roles. The contract below makes activation *possible and honest*; it
does not make the data *appear*.

---

## Part 2 — The feature-signal contract

### 2.1 New content-free metric keys

Authorized additions to `CANONICAL_METRICS` (`src/contracts/metrics.ts`) and the
seeded `metric_catalog`, following the existing family/unit/dimKind conventions.
One new **family** (`worktype`) and two new **dimKind** values (`tool`,
`task_category`) — additive, mirroring how ADR 0022 added `agentic` and ADR 0039
added `markers`.

| Key | Family | Unit | dimKind | dim carries | Collectability (Part 1) |
|---|---|---|---|---|---|
| `ai_tool_used` | `active_users` | `flag` | `tool` | a **bounded AI-app enum** (e.g. `claude-desktop`, `chatgpt-desktop`) | **(a) now** — OS app presence/foreground, content-free, browser-blind |
| `task_category` | `worktype` (new) | `count` | `task_category` | a **closed task-category enum** (§2.2) | **(b) narrow** — D-DA-5 classifier; needs a native readable log |
| `iteration_depth` | `worktype` (new) | `count` | *(null)* | — (per-day count of refinement turns) | **(b) narrow** — D-DA-5 classifier |
| `verification_behavior` | `worktype` (new) | `count` | *(null)* | — (per-day count of verification actions) | **(b) narrow** — D-DA-5 classifier |

Notes on the conventions:

- Keys are `snake_case` nouns; per-item counts use `unit: count` with the item in
  the `dim` (mirrors `model_requests`/`feature_used`), **not** a `_count` suffix —
  so the spec's `task_category_count[category]` notation becomes key `task_category`
  + `unit: count` + `dim: <category>`.
- `ai_tool_used` sits in the **adoption** family (`active_users`) beside
  `active_day`: `active_day` = "used AI at all today," `ai_tool_used[tool]` =
  "used this AI app today." It is the one **(a)-tier** key here.
- The three `worktype` keys are all outputs of the same on-device classification
  pass — *what kind* of work (`task_category`), *how iteratively*
  (`iteration_depth`), *how carefully* (`verification_behavior`) — hence one new
  family describing the content-free **type/shape of AI work**.
- **Confidence ceiling:** none of these keys defines an OTel marker. They are NOT
  added to `OTEL_MARKER_METRIC_KEYS`, so a capability bound to them can reach at
  most **`directional`**, never `measured` (the ≥2-marker rule, ADR 0039 / spec
  §5). No non-eng capability can render a calibrated score. Enforced by the engine
  today; nothing here weakens it.

### 2.2 The closed task-category enum

`task_category`'s `dim` is a **closed, exhaustive** enum — the on-device classifier
maps each prompt to exactly one of these, and **anything unclassifiable falls to
`other`, never to the raw text**:

`research` · `ideation` · `drafting` · `summarization` · `analysis` · `review` ·
`coding` · `planning` · `other`

(The first eight are the spec §3b set; `other` is the mandatory catch-all so the
classifier never needs a free-string escape hatch.) The `ai_tool_used` `tool` dim
is likewise a **closed** app enum, extended only by ADR — a device may never emit
an out-of-set tool label.

### 2.3 The on-device classification boundary (D-DA-5)

The classifier the eventual build ships MUST mirror the `count_text` pattern
already in `desktop-agent/src-tauri/src/extract/counts.rs`:

1. **On-device, in-process, borrow-and-drop.** The classifier borrows prompt-like
   content the connector already holds, derives a single closed-enum category (and
   any counts), and **lets the borrow end**. No substring is stored, copied,
   forwarded, or returned — exactly as `count_text` returns only two integers.
2. **Closed-enum output type.** The classifier's return type is a **closed Rust
   enum** (like `sanitize_model` clamps to a safe charset by construction) — there
   is **no code path** by which a raw or free-form string becomes the emitted
   `dim`. Unclassifiable → `other`.
3. **Counts and bounded enums only leave the device.** The emitted shape is: a
   category enum label + a per-day count, an iteration-depth count, a
   verification count, an app enum label + a per-day flag. Numbers and bounded
   ASCII enum labels — the exact shape the existing validator already permits.
4. **The emitted-shape allowlist is exhaustive and fail-closed on BOTH sides.**

### 2.4 Enforcement + tests the build must carry

The build is not authorized to merge without all of these (they extend, not
replace, the existing fail-closed pipeline):

- **On-device (Rust) — the privacy validator quarantines anything off-allowlist.**
  Each new *sent* field gets an allowlist row (§2.5); `desktop-agent/src-tauri/src/
  privacy/validator.rs` already quarantines any non-allowlisted key
  (`UnknownField`), any `sent:false` key (`NonSendableField`), and any non-scalar /
  over-long / non-ASCII value (`FreeTextValue`). **Additive requirement:** the
  category/tool `dim` must also be checked against its **closed enum** — an
  in-range-length but out-of-set label (e.g. a smuggled snippet ≤64 ASCII chars)
  must quarantine, not pass. A test must prove an out-of-enum category string is
  rejected.
- **On-device (Rust) — a rich-prompt yields only category counts.** A test feeding
  a long, content-rich prompt through the classifier asserts the output is **only**
  a category enum + counts, and that no substring of the input appears anywhere in
  the candidate payload (the `count_text` borrow-and-drop guarantee, extended to
  classification). Lives beside `desktop-agent/src-tauri/src/extract/tests.rs`.
- **Server — `agent-collection-schema.ts` rejects text-shaped payloads, fail-closed.**
  The app-side allowlist (`src/lib/agent-collection-schema.ts`) gains the new rows;
  the CLI mirror (`packages/revealyst-agent/src/allowlist.ts`) stays byte-identical
  (pinned by `tests/agent-cli-contract.test.ts`). The `/api/agent/ingest` path must
  reject any field not on the allowlist and any `task_category`/`tool` dim not in
  the closed enum — a server test must prove a text-shaped payload on the new keys
  is rejected, matching the on-device validator's posture.
- **Contract drift stays green.** `tests/contracts.test.ts` asserts
  `metric_catalog` seed keys `≡ METRIC_KEYS` **bidirectionally** — so the seed
  migration and the `CANONICAL_METRICS` addition MUST land in the **same** PR
  (§2.5). A new-family/new-dimKind row must round-trip through the drift assertion.
- **Public transparency page.** `/legal/what-we-collect` reads
  `AGENT_COLLECTION_FIELDS`, so the new rows must carry honest, plain-English
  `purpose` copy (a claim surface — W3-N; swept like the ADR-0054 pack summaries).

### 2.5 Frozen-contract implications (authorized here; the seed is downstream)

New `CANONICAL_METRICS` keys, a new `METRIC_FAMILIES` member (`worktype`), and new
`dimKind` union values (`tool`, `task_category`) are all changes to **frozen
contracts** (`src/contracts/metrics.ts` + `src/db/schema/*` + `drizzle/**`) — this
ADR authorizes them (rule 1).

**Deliberately NOT built in this ADR:** the seed migration, the `CANONICAL_METRICS`
edit, the allowlist rows, and the classifier. Because the drift test is
**bidirectional** (§2.4), editing `CANONICAL_METRICS` without the matching seed row
(or vice-versa) reds the suite — so both must move **together**, in the downstream
build PR, **after** the key set below is ratified, so the seed matches the
ratified set exactly. Doing it ADR-first (per the task's guidance) keeps the seed
from drifting ahead of the decision. The migration takes the next free number at
PR time (verify `ls drizzle/*.sql` then — the parallel desktop stream is active).

## Contracts affected

- **`src/contracts/metrics.ts`** (authorized, not edited here) — `+worktype`
  family; `+ai_tool_used/task_category/iteration_depth/verification_behavior` keys;
  `dimKind` union `+tool,+task_category`. NOT added to `OTEL_MARKER_METRIC_KEYS`.
- **`src/db/schema/*` + `drizzle/**`** (authorized, not edited here) — the seed
  migration mirroring the keys above (next number at PR time).
- **`src/lib/agent-collection-schema.ts`** + **`packages/revealyst-agent/src/
  allowlist.ts`** (authorized, not edited here) — new `sent:true` rows for the
  emitted fields, kept byte-identical by the CLI-contract test.
- **Not affected:** `tracked_user` semantics, the credential shape, the tenancy
  contract (`forOrg` — these are global-reference catalog keys, no new org-scoped
  table, no new registration), `docs/connector-facts.md` (this adds ZERO vendor
  connectors), and the mastery engine (the `directional` ceiling and no-evidence→
  no-row honesty are reused verbatim — nothing here weakens them).

## Cross-links

- **D-DA-5** (ledger, ratified 2026-07-17) — the on-device-read / metadata-only
  override this contract implements. This ADR is the "own ADR in the desktop
  workstream" that row required before any text-reading ships.
- **D-DA-9** (ledger, new — this ADR) — the feature-signal contract is now
  specified; the classifier build, the seed, and pack activation are the
  authorized downstream steps.
- **D-TCI-8** (ledger) + **`docs/product/noneng-role-packs-spec.md`** §3b/§7 — the
  non-eng packs whose activation depends on these keys existing and being bound.
- **ADR 0054** §Deferred item 2 — the deferred "bind the pack signals … needs its
  own feature-signal-contract ADR" this ADR discharges (definition only; binding
  is still the activation PR).
- **Desktop plan T5.2 / M5** (`docs/Revealyst_Desktop_Agent_Execution_Plan.md`) —
  the feature-signal-ADR line; supersedes T5.2's tentative key names
  (`workflowType`/`complexityBand`) with the spec-§3b-grounded set above.
- **ADR 0039** — the marker/`measured` tier these keys deliberately do **not** join
  (the `directional` ceiling for non-eng, spec §5).

## Recommended downstream sequence

1. **Ratify the key set** (this ADR + the D-DA-9 ledger row).
2. **Build PR:** add the four keys to `CANONICAL_METRICS` + the seed migration (same
   PR, drift-test-green) + the allowlist rows (CLI byte-identical) + the
   `/legal/what-we-collect` copy.
3. **Classifier PR (Rust):** the borrow-and-drop closed-enum classifier + the
   validator closed-enum check + the two Rust tests (§2.4); **capture a real
   fixture** on a founder device (rule 2) before any live emission.
4. **Activation PR (per pack, gated):** land the ADR-0054 §Deferred domain-scoping
   read, add `capability_signals` binding the pack's capabilities to these keys,
   flip the pack `is_active=true`, add role-aware forming copy — **only for a pack
   with a real captured signal** (spec §7.4). Marketing first.

## Consequences

- The desktop workstream has a **ratified, honest contract** to build the D-DA-5
  classifier against; ADR 0054's deferred binding is unblocked (as a definition).
- The founder has the **honest picture**: the near-term collectable substrate is
  thin native-app adoption (a); task-category classification is buildable but
  data-starved for non-dev roles (b); the bulk of non-dev AI use is browser-based
  and blocked by an unqualified tripwire (c). Activation is possible and honest,
  but will render `not_measured` for most non-dev people until native, log-exposing
  AI apps arrive — recorded here rather than discovered at activation time.
- The privacy posture is unchanged and reinforced: raw text never leaves the
  device; the emitted shape is counts + closed enums; enforcement is fail-closed on
  both the device and the server; the `directional` ceiling holds.
