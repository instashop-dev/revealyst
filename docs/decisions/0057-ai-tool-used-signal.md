# 0057 — `ai_tool_used`: the content-free "which AI desktop apps are in use" signal

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Desktop Agent workstream; founder decision **D-DA-5** (on-device
  read → metadata-only emit) and the founder gate-clearance for
  **Recommendation #7** (the one buildable-now, content-free non-eng signal).
- **Builds on:** **ADR 0055** (the feature-signal contract) §2.1/§2.2, which ranks
  `ai_tool_used` as the single **(a)-tier — collectable now** key (OS app presence,
  content-free, browser-blind) and authorizes it as a new `CANONICAL_METRICS` key.
  ADR 0055 defined the contract; this ADR is the **build** for the `ai_tool_used`
  slice only (it does NOT build the D-DA-5 prompt-text classifier — `task_category`
  / `iteration_depth` / `verification_behavior` stay authorized-but-unbuilt).

## Context

Every metric key today is a developer-tool family. Recommendation #7 asks for the
first honest, content-free signal of *which AI desktop apps a person actually uses*
— a breadth/adoption signal for any role, not just engineering. The **only** honest
source is the resident desktop agent (`desktop-agent/`, Tauri): it can enumerate
running processes on the machine and match them, **by app identity alone**, against a
**closed** list of known AI desktop apps. It reads **no** window titles, **no**
process command lines, **no** file paths — nothing but "is a process whose executable
name is one of these known AI apps running right now". Browser-mediated AI use
(ChatGPT web, Claude web, Gemini, Copilot in M365 web) stays structurally invisible
under the unqualified `no browser extension/proxy` tripwire (ADR 0055 §1.1) — this
signal is deliberately native-app-only and therefore **coarse** (ADR 0055 §1.3).

## Decision

Add ONE new content-free metric key, `ai_tool_used`, whose `dim` carries a value from
a **closed AI-app enum**. A device may **never** emit an out-of-enum label; an
in-length-range but out-of-set value is treated as a smuggled snippet and quarantined
(server) / rejected (device). The enforcement is **fail-closed on BOTH ends**.

### The metric key (ADR 0055 §2.1)

| Key | Family | Unit | dimKind | dim carries |
|---|---|---|---|---|
| `ai_tool_used` | `active_users` | `flag` | `tool` (new) | a bounded, closed AI-app enum id |

- It sits in the **adoption** family beside `active_day`: `active_day` = "used AI at
  all today"; `ai_tool_used[tool]` = "this known AI app was seen running today" (value
  `1`). One new `dimKind` value, `tool` (additive, mirroring how `model`/`feature`
  were added).
- **Confidence ceiling.** `ai_tool_used` is **NOT** an OTel marker — it is NOT added
  to `OTEL_MARKER_METRIC_KEYS`. A capability bound to it can reach at most
  **`directional`**, never `measured` (the ≥2-marker rule, ADR 0039). Nothing here
  weakens that; the engine enforces it. Do not claim `measured` for any app-presence
  capability.

### The closed AI-app enum (`AI_TOOL_IDS`, extended only by ADR)

Defined once in the frozen contract (`src/contracts/metrics.ts`) as the single source
of truth, and crossed to the Rust agent via the generated allowlist JSON (plan law 5,
no TS import in the crate):

`chatgpt-desktop` · `claude-desktop` · `copilot-desktop` · `perplexity-desktop`

These are native AI **desktop** apps that ship a detectable executable. Each maps
on-device to a small set of known executable base names (macOS app name / Windows
`.exe` base), matched **case-insensitively and exactly** (not substring) to reduce
false positives. The Claude Code CLI is deliberately **excluded** — it is a developer
tool already measured by its own connector, not a native chat app. Extending the enum
(a new app id) is a future ADR + a `capability_signals` binding, never an ad-hoc
device change.

### Emitted shape + the borrow-and-drop discipline

- The device probes running processes, reads **only** each process's executable name
  (`process.name()`), matches it against the closed registry, and **drops the borrow**
  — no name is stored, forwarded, or returned beyond the closed-enum match result. The
  per-day emitted record is `{ metricKey: "ai_tool_used", dim: "tool=<app-id>", value:
  1, attribution }`, and its privacy-gate candidate event is `{ "ai_tool_used":
  "<app-id>", rawPromptIncluded: false, rawResponseIncluded: false }`. Numbers + a
  bounded closed-enum label only — the exact shape the existing validator permits, now
  with the added closed-enum check.

### Closed-enum enforcement on BOTH ends (ADR 0055 §2.4, the fail-closed pattern)

- **Device (Rust).** `desktop-agent/src-tauri/src/privacy/validator.rs` already
  quarantines non-allowlisted keys, `sent:false` keys, and free-text-shaped values.
  **Added:** a field whose allowlist entry declares a closed enum (here `ai_tool_used`)
  must carry a value **in** that enum, or it quarantines with a new, content-free
  reason `out_of_enum_value`. The closed enum is read from the same generated
  `allowlist.json` the crate already embeds. A Rust test proves an out-of-enum label
  is rejected and that a content-rich string never survives.
- **Server (TS).** `src/lib/agent-ingest.ts` bounds every `dim` (length + control
  chars). **Added:** a record whose `metricKey` is `ai_tool_used` must carry a `dim` of
  exactly `tool=<id>` with `id ∈ AI_TOOL_IDS`, else the batch is a 400. A server test
  proves a text-shaped / out-of-enum `ai_tool_used` dim is rejected, matching the
  device posture.

## Contracts affected (rule 1)

- **`src/contracts/metrics.ts`** (frozen) — `+ai_tool_used` in `CANONICAL_METRICS`
  (`active_users`/`flag`/`dimKind:"tool"`); `dimKind` union `+"tool"`; new
  `AI_TOOL_IDS` closed enum + `isValidAiToolDim()` helper. NOT added to
  `OTEL_MARKER_METRIC_KEYS`.
- **`src/db/schema/tracking.ts` `metric_catalog.dim_kind`** (frozen) — enum widened
  `["model","feature"]` → `["model","feature","tool"]` (TS-only text-enum widening; no
  DDL — the value is plain text, exactly like the `credits`/`seconds` unit widenings).
- **`drizzle/0045_seed-ai-tool-used-metric.sql`** — the seed row mirroring
  `CANONICAL_METRICS` (the contracts drift test asserts the two never diverge, so the
  seed and the constant land in the SAME PR).
- **`src/lib/agent-collection-schema.ts`** + **`packages/revealyst-agent/src/
  allowlist.ts`** — one new `sent:true` row, `ai_tool_used` (byte-identical mirror,
  pinned by `tests/agent-cli-contract.test.ts`). It is the FIRST allowlist field
  collected by the **Rust desktop agent** rather than the CLI's Claude Code log
  parser, so the CLI's `parse.ts`-read check exempts it (documented desktop-collected
  set) — its read is proven by the Rust collector's own tests instead.
- **`scripts/generate-agent-allowlist-json.mjs`** + **`desktop-agent/src-tauri/
  generated/allowlist.json`** — the generator now also emits a `closedEnums` map
  (`{ ai_tool_used: [...AI_TOOL_IDS] }`) so the Rust validator reads the closed set
  from the same single source (drift-pinned byte-for-byte).
- **Not affected:** `tracked_user` semantics, the credential shape, the tenancy
  contract (`forOrg`) — `ai_tool_used` is a global-reference catalog key and rides the
  existing `metric_records` table under the existing device-token connection, so **no
  new org-scoped table, no new tenant-isolation / account-deletion registration**.
  `docs/connector-facts.md` is unchanged (zero new vendor connectors).

## Which surfaces re-sync

- `/legal/what-we-collect` and the in-app transparency panel render from the allowlist
  mirror — the new honest row surfaces automatically ("which AI apps are open, not what
  you do in them").
- `src/connectors/scope-claims.ts` `claude_code_local` gains the "can/can't measure"
  line for app presence (the desktop agent pushes through that connection).
- The capability engine and mastery ceiling are unchanged (directional-only; no-evidence
  → no-row honesty reused verbatim).

## Live-emission gate (D-DA-8) — the collector ships COMPLETE but DORMANT

The server ingest window-delete is **connection-scoped**
(`deleteWindowForConnection`), and the desktop agent pushes every local source through
**one** device-token connection. The Claude Code connector re-emits its full trailing
window only when its file manifest changes; on an unchanged cycle it emits nothing. A
**second** local source (this app-presence collector) pushing its own narrow window on
such a cycle would make the server delete-then-upsert erase the Claude Code
connector's overlapping-day metrics — the exact **D-DA-8** hazard for which the Claude
export importer already ships **projection-only** (no live enqueue).

Therefore this PR ships the collector **complete and privacy-validated** (it is a real
`SourceConnector` whose candidate events pass the fail-closed validator, proven by a
`collect_and_enqueue` Rust test) but does **NOT** wire it into the live `run_cycle`
loop. Live activation is gated on the D-DA-8 server-side change (making the
window-delete source-connector-scoped, a frozen ingest+scoring change) — the same gate
the export importer waits on. The privacy boundary and the closed-enum contract are
fully delivered and enforced now; only the live emission is deferred, honestly.

## Consequences

- The first content-free, role-agnostic **adoption-breadth** signal exists, enforced
  fail-closed on both ends: only a bounded closed-enum app id can ever leave the
  device — no window titles, no command lines, no free text, no prompt/response
  content.
- The confidence ceiling holds: app presence is `directional`, never `measured`.
- The collector is ready; live emission is D-DA-8-gated, recorded here rather than
  discovered at activation time.

## Cross-links

- **ADR 0055** — the feature-signal contract this discharges for `ai_tool_used`.
- **ADR 0039** — the `measured` tier this key deliberately does not join.
- **ADR 0025 / D-DA-8** — the connection-scoped window-delete that gates live
  multi-source emission (see `docs/product-signoffs.md`).
- **D-DA-5** — the on-device-read / metadata-only override.
