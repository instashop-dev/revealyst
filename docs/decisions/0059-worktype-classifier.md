# 0059 — On-device work-type classifier (the D-DA-5 build)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Desktop Agent execution plan (T5.2, Wave M5); founder decision
  **D-DA-5** (ratified 2026-07-17 — the on-device extractor may read prompt TEXT
  and emit ONLY metadata: bounded enums/counts, never text, never excerpts) and
  the feature-signal contract **D-DA-9** (ADR 0055).

> **Governance note — read this first (rule 4, no self-certified gates).**
> D-DA-9 was **PAUSED by the founder on 2026-07-17** (`docs/product-signoffs.md`):
> after reviewing the honest viability picture (most non-dev AI use is
> browser-based and permanently unobservable under the `no browser
> extension/proxy` tripwire), the founder paused the downstream build — "no key
> set is ratified, no code ships, no classifier reads prompt text." **This ADR
> proceeds only because that pause was subsequently LIFTED: the founder cleared
> the D-DA-5/D-DA-9 gate for this workstream (Recommendation #9) on 2026-07-18.**
> The resume is recorded on the D-DA-9 ledger row and is flagged there for
> founder ratification. This ADR does not, and cannot, self-authorize past that
> pause — if the resume is not what the founder intended, this build must not
> merge. Everything below assumes the gate is genuinely cleared.

This ADR builds the classifier ADR 0055 §Part 2 authorized (definition only) but
deliberately did not build.

## Context

ADR 0055 ratified the `worktype` feature-signal contract — the closed
task-category enum, the three metric keys, and the on-device classification
boundary — but built no classifier, no migration, and no allowlist row. This
ADR is ADR 0055's downstream step 3 ("Classifier PR (Rust): the borrow-and-drop
closed-enum classifier + the validator closed-enum check + the two Rust tests").

The classifier reads the human's prompt text **on your own computer** and turns
it into a small, closed set of labels and counts. The words you type are never
stored, copied, logged, forwarded, or sent — only the label and the counts
leave. This is the first place the resident desktop agent reads prompt content
for *meaning* (the existing `count_text` only measured length). Because that
crosses a real line, this ADR also corrects an in-app privacy claim that would
otherwise become false (see "Honesty-claim change" below).

## Decision

### 1. The closed task-category enum (frozen)

`task_category`'s value is one of a **closed, exhaustive** set. Anything the
classifier cannot place falls to `other` — never to raw text:

`research · ideation · drafting · summarization · analysis · review · coding ·
planning · other`

Defined once as `TASK_CATEGORY_IDS` in `src/contracts/metrics.ts` (frozen
contract) and crossed to the Rust device through the generated allowlist
artifact (`closedEnums.task_category`), so the two ends can never drift.

### 2. Three new `worktype` metric keys (frozen; seed migration 0046)

Added to `CANONICAL_METRICS` + the seeded `metric_catalog` in the SAME PR (the
contracts drift test is bidirectional):

| Key | Family | Unit | dimKind | dim carries |
|---|---|---|---|---|
| `task_category` | `worktype` (new) | `count` | `task_category` (new) | a value from the closed task-category enum |
| `iteration_depth` | `worktype` | `count` | *(null)* | — (per-day count of refinement turns) |
| `verification_behavior` | `worktype` | `count` | *(null)* | — (per-day count of verification actions) |

`worktype` is a new `METRIC_FAMILIES` member; `task_category` is a new `dimKind`
union value. Additive, mirroring how ADR 0057 added the `tool` dimKind.

### 3. The classifier is deterministic, on-device, borrow-and-drop

The Rust classifier (`desktop-agent/src-tauri/src/extract/classify.rs`) mirrors
`count_text`'s discipline exactly:

1. **Deterministic heuristics only** — a fixed keyword/priority table, no cloud
   call, no network, no ML model (DA-FEAT-003; the ML classifier stays deferred
   until heuristics prove insufficient).
2. **Borrow-and-drop** — it borrows the `&str` the extractor already holds,
   derives its result, and lets the borrow end. No substring is stored, copied,
   logged, or returned.
3. **Closed-Rust-enum return type** — the classifier returns
   `enum TaskCategory { Research, …, Other }`, never a `String`. There is no code
   path by which a raw or free-form string becomes the emitted `dim`.

### 4. Closed-enum validation on BOTH ends, fail-closed

Reusing ADR 0057's machinery:

- **Device (Rust)** — the payload validator already quarantines any
  non-allowlisted key, any `sent:false` key, and any non-scalar / over-long /
  non-ASCII value. `task_category` additionally declares a **closed enum**
  (crossed via the generated artifact), so an in-range-length but out-of-set
  label (a smuggled snippet ≤64 ASCII chars) quarantines as `out_of_enum_value`,
  never enqueued.
- **Server** — `agent-ingest.ts` gets a closed-enum backstop for the
  `task_category` metric key (`isValidTaskCategoryDim`), the twin of
  `isValidAiToolDim`. An in-length-range but out-of-enum `dim` is a 400, never a
  stored dim.

### 5. Wired-not-live (rule 2 + the ai_tools precedent)

The classifier runs in the extractor path and its output passes the fail-closed
privacy validator **by construction** (proven by tests). It is **not yet emitted
to the wire**: ADR 0055's sequence requires capturing a **real fixture on a
founder device (rule 2) before any live emission**, and the pack-activation
binding is a separate gated PR (ADR 0055 step 4). So this PR ships the mechanism
complete and privacy-validated but does not forward `worktype` to the live
`claude_code` batch — exactly as `ai_tools` (ADR 0057) is complete but held out
of `run_cycle` pending its own gate.

### 6. Confidence ceiling unchanged

None of the three keys is an OTel marker (absent from `OTEL_MARKER_METRIC_KEYS`),
so a capability bound to them caps at `directional`, never `measured`
(ADR 0039). This ADR does not weaken that.

## Honesty-claim change (W3-N — the important one)

Before this ADR the agent genuinely never READ prompt text; ADR 0057 shipped the
standing line `agentNeverReadsPrompts()` /
`STANDING_PRIVACY_LINE = "We read counts, timing, model names, and which AI apps
are open — never your prompts."` **After this ADR that "never your prompts" claim
is false** — the agent now reads prompt text on-device to classify it.

The true, durable guarantee is different from what it was, and must be stated
plainly:

- **Old (now false):** the agent never *reads* your prompts.
- **New (true):** your prompts are read **only on your computer** to sort your
  work into a simple task category, and the **words never leave this
  computer / are never uploaded**.

Concretely, this PR:

- renames `agentNeverReadsPrompts()` → **`agentNeverUploadsPrompts()`** — same
  fail-closed derivation (the line shows only while EVERY sent field carries a
  bounded `sentValueShape`; a future free-text sent field withholds it), but the
  guarantee it licenses is now "never uploaded", not "never read";
- rewrites `STANDING_PRIVACY_LINE` to
  **"Your prompts never leave this computer. We only send counts, timing, model
  names, which AI apps you use, and the kind of task."** — honest (the guarantee
  is about leaving, not reading), plain, and complete (it owns the new
  task-category signal alongside the others, invariant b);
- reframes `/legal/what-we-collect`'s "Never read at all" section to **"Never
  leaves your computer"**, and adds an honest, plain disclosure that the words
  you type are read on your machine to work out counts and a task category, then
  dropped — they never leave;
- corrects the `scope-claims.ts` line "only counts and structure are ever read"
  (now false) to the honest "read on your computer … never leave your device".

The distinction — **read on-device vs uploaded** — is made crystal clear to a
beginner everywhere the claim appears.

## Contracts affected

- **`src/contracts/metrics.ts`** — `+worktype` family; `+task_category`,
  `+iteration_depth`, `+verification_behavior` keys; `+task_category` dimKind;
  `TASK_CATEGORY_IDS` + `TASK_CATEGORY_DIM_PREFIX` + `isValidTaskCategoryDim`.
  NOT added to `OTEL_MARKER_METRIC_KEYS`.
- **`drizzle/0046_seed-worktype-metrics.sql`** — the data-only seed mirroring the
  three keys (contracts drift test is bidirectional → same PR).
- **`src/lib/agent-collection-schema.ts`** + **`packages/revealyst-agent/src/
  allowlist.ts`** — three new `sent:true` rows (`task_category` → `closed_enum`,
  `iteration_depth`/`verification_behavior` → `count`), kept byte-identical by
  `tests/agent-cli-contract.test.ts`; the generated `allowlist.json` regenerated.
- **Not affected:** `tracked_user` semantics, the credential shape, and the
  tenancy contract — these are global-reference catalog keys riding the existing
  `metric_records` table. **No new org-scoped table**, so no `SCOPED_READS` /
  account-deletion registration (the three-place rule does not apply). No new
  vendor connector, so `docs/connector-facts.md` is untouched. The mastery
  engine's `directional` ceiling and no-evidence→no-row honesty are reused
  verbatim.

## Cross-links

- **ADR 0055** — the feature-signal contract this ADR builds (steps 1–2 → this
  is step 3).
- **ADR 0057** — the `ai_tool_used` closed-enum precedent this reuses end-to-end
  (validator backstop, generated-artifact enum crossing, `sentValueShape`).
- **ADR 0039** — the `measured` tier these keys deliberately do not join.
- **D-DA-5 / D-DA-9** (ledger) — the on-device-read override + the feature-signal
  contract being discharged.

## Consequences

- The desktop agent can classify work type entirely on-device with a
  structurally content-free output; prompt text never leaves the machine.
- The in-app privacy claim is now accurate for the first time an agent reads
  prompt content: it promises the words never leave, not that they are never
  read.
- Live emission + pack activation remain gated on a real captured fixture
  (rule 2) and the separate activation PR — the mechanism is built and proven
  privacy-safe, not switched on.
