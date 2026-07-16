# 0042 — TEL-012 context-window usage signal (`context_tokens`)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Founder decision **D11** (2026-07-16, `docs/product-signoffs.md`):
  "build the context-window usage signal now" — overriding the Closure Execution
  Plan §6 default that moved TEL-012 to Future.

## Context

TEL-012 is the last outstanding V1 telemetry key: a signal for *how much of the
AI model's context window a person uses*. The Closure Execution Plan §T4.2 framed
it as an **OTel context marker** (with the Anthropic `context_window` group-by as a
second corroborating source), and left "build now vs. formally Future" to founder
decision D11. D11 is now **build it**.

Adding a canonical metric key touches a frozen contract
(`src/contracts/metrics.ts` — `CANONICAL_METRICS`), so it is ADR-gated (rule 1),
exactly as ADR 0022 and ADR 0039 were.

### An honesty constraint that changes the shape (rule 2)

Before building, we checked the ground truth. **No captured payload contains a
context-window field:**

- `fixtures/otel/*.captured.json` — zero `context` / `context_window` /
  `context_length` attributes anywhere. The real captured OTel metric names are
  `claude_code.{active_time.total, code_edit_tool.decision, cost.usage,
  lines_of_code.count, token.usage}`; none carries a context-size attribute.
- The Anthropic usage report **does** document a `context_window` `group_by`
  dimension (`docs/connector-facts.md`), but it is **not** implemented in the
  connector (`src/connectors/anthropic/types.ts`/`normalize.ts` never read it) and
  appears in **no** recorded Anthropic fixture (`fixtures/connectors/anthropic_console/*`).

So T4.2's "OTel context marker" framing cannot be honored honestly: there is no
OTel context marker to decode, and fabricating a fixture to test one against
violates rule 2. This ADR therefore **deviates** from T4.2 on the metric's shape.

## Decision

### The key (additive, mig 0035)

Add ONE canonical metric to `CANONICAL_METRICS` (+ the seeded `metric_catalog`, in
lockstep so the contract-drift test stays green — `tests/contracts.test.ts`,
`tests/facts.test.ts`):

- `context_tokens` — family `tokens`, unit `tokens`, `dimKind: null`. **No enum
  widening** (both `tokens` values already exist). Tokens carried in the model's
  context window per request.

It is a **connector-family signal, NOT an OTel marker**: deliberately absent from
`OTEL_MARKER_METRIC_KEYS`, so it never participates in the ≥2-marker `measured`-tier
upgrade (ADR 0039). Its honest intended source is the Anthropic usage report
`context_window` dimension.

Migration `0035_seed-context-tokens.sql` also binds it to `cost-efficient-usage`
via `capability_signals` (context length directly drives per-request cost/value).
That capability already carries three signals (`output_per_spend`,
`engagement_per_spend`, `spend_cents`), so the fourth binding is **purely
additive**: with no `context_tokens` rows, the engine contributes no evidence for
it and the capability's computed mastery is byte-identical to before.

### Honest no-data behavior (the "exists honestly" objective)

No producer writes `context_tokens` today. `src/scoring/capability-state.ts`
guarantees this renders honestly: a signal with no evidence is skipped
(`computeOne` `continue` on no evidence), and a capability with no evidence at all
returns `null` (no row) — it is **never zero-filled**. So the key exists as honest
vocabulary, wired and ready, without ever displaying a fabricated number.

### The emitter is the fixture-gated follow-up (NOT built here)

Wiring an actual producer — harvesting the Anthropic `context_window` group-by into
`context_tokens` records — is deferred until a **real recorded Anthropic payload**
carrying that dimension exists (rule 2), mirroring how ADR 0039's markers waited on
the founder's real OTel capture (#220). This ADR ships the vocabulary + binding
layer only. When a real fixture lands, the emitter is a connector-normalize change
tested against it, no further contract change.

## Contracts affected

- **`src/contracts/metrics.ts`** (frozen) — one additive key `context_tokens`
  (`tokens`/`tokens`/null). No new family/unit; `OTEL_MARKER_METRIC_KEYS`
  unchanged (deliberately — this is not a marker).
- **`metric_catalog`** — one seed row; **`capability_signals`** — one binding
  (`cost-efficient-usage` → `context_tokens`). Migration `0035_seed-context-tokens.sql`
  (data-only, idempotent, no DDL).
- **Not affected:** the frozen score engine, `metric_records` shape (a future
  emitter uses existing columns), credentials, `org-scope` public API, the
  `measured`-tier logic. `metric_catalog` and `capability_signals` are **global
  reference tables** (`org_id` NULL) — like `roles`/`metric_catalog` they are
  exempt from the `tests/tenant-isolation.test.ts` SCOPED_READS and
  `src/db/account-deletion.ts` purge registrations (per ADR 0035's
  three-registration note), so no new registration is required.

## Consequences

- The V1 telemetry vocabulary is complete: `context_tokens` exists, is bound to a
  capability, and is contract-mirrored — with a proven no-fabrication guarantee
  until a real emitter lands.
- A future session can wire the Anthropic `context_window` harvest against a real
  recorded fixture without touching this contract again.
- Because it is not an OTel marker, it cannot on its own move a capability to
  `measured` — it can only ever add `directional` evidence, which is the honest
  ceiling for an admin-API-derived context signal.
