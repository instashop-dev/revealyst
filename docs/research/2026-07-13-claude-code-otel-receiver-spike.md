# Claude Code OTel Receiver — De-risking Spike (W5-B)

**Date:** 2026-07-13 · **Author:** W5-B (AI-assisted single-ownership spike) ·
**Status:** ~~Research → go/no-go decision~~ **Decided GO and implemented** — the OTLP
receiver + measured tier shipped as W7 P8 (mig 0034,
[ADR 0039](../decisions/0039-otel-measured-tier.md)), decoded against the real captured
fixtures in `fixtures/otel/`. Kept as the point-in-time spike record. Original scope:
go/no-go for **W6-D** (Execution Plan V4 §3 W6-D;
AI Intelligence Plan §6 F3.1). Docs + fixtures only — no app source, tables,
migrations, or contracts changed. Supersedes the OTel notes in
`docs/connector-facts.md` §5 "OTel export" and
`docs/research/2026-07-11-manual-sync-vs-desktop-connector.md` §1.2 only where this
doc is more specific; both remain valid on everything else.

> **Scope reminder:** this is a *de-risking spike*, not a build. It answers the one
> open unknown (OTLP ingestion viability on workerd), fixes the wire format + auth
> scheme, designs the queue-batch → day-grain aggregation, and hands W6-D a decided
> shape + fixtures. **Live OTel payload capture is FOUNDER-GATED** (§9) — it needs
> the founder's own Claude Code run with `CLAUDE_CODE_ENABLE_TELEMETRY=1`, which is
> founder infra this workstream cannot perform. The fixtures shipped here are
> **hand-constructed synthetic** illustrations, clearly labelled as such.
>
> **Update 2026-07-14:** the founder-gated capture is done. §9 now has real
> `fixtures/otel/*.captured.json` and resolved NLV-OT1..OT5 — **one finding flips a
> design decision**: real metrics are **delta**, not cumulative, which invalidates
> §5's cumulative-max aggregation as written. See §9 "Results" for the full
> resolution and W6-D's two options.

---

## 0. Go / no-go — GO, with a mandated exporter config

**Decision: GO.** An OTLP receiver on Cloudflare Workers is viable within CPU and
request limits, **provided the founder configures the Claude Code exporter to speak
OTLP/HTTP (not gRPC) and — recommended — JSON encoding.** gRPC is a hard non-starter
on Workers (§2); OTLP/HTTP JSON is the pragmatic wire format (§3); the 128 KB queue
bound is handled by an R2/DB raw-payload pointer (§6); the frozen fact grain is
reachable by a cumulative-max→sum day aggregation that is idempotent under
at-least-once redelivery (§5). No frozen contract needs to change for the *transport*
— only the new metric key `active_time_seconds` and new *producers* for existing
acceptance/retry keys need W6-D's catalog+contract ADR (§7).

**Recommended shape for W6-D (one line each):**

| Decision | Recommendation | Why (see §) |
|---|---|---|
| Transport | OTLP/**HTTP** only; reject gRPC at the LB (Workers can't serve HTTP/2 gRPC) | §2 |
| Encoding | **`http/json`** mandated in onboarding copy; `http/protobuf` accepted as fallback via a small JS decoder | §3 |
| Routes | `POST /v1/metrics`, `POST /v1/logs` (OTLP default paths) | §3, §4 |
| HTTP response | **`200 OK`** with an (empty-`partial_success`) `Export<signal>ServiceResponse` body — NOT 202 | §4 |
| Auth | Device-token analogue in `OTEL_EXPORTER_OTLP_HEADERS: Authorization=Bearer rva1.<org>.<conn>.<secret>`; token→orgId, cheap-auth-before-parse | §4 |
| Async posture | Accept fast → enqueue a **pointer** to the stored raw batch → aggregate in the queue consumer | §5, §6 |
| Aggregation | Bucket data points by **UTC day** from `timeUnixNano`; per `(session.id, metricKey, dim)` take the **max cumulative** value, then **sum across sessions** into `(org, subject, metricKey, day, dim)`; idempotent restatement of the day | §5 |
| Privacy | Content flags **never set**; defensive **scrub at the boundary** drops `prompt`/`response`/`*_body`/`tool_input`/`tool_parameters` before anything persists (the third §13 enforcement point) | §8 |

**No-go conditions that would flip this** (none observed, but W6-D must re-check on
live capture): the exporter cannot be pointed at HTTP/JSON on the founder's platform
(e.g. a Bedrock/Vertex wrapper forcing gRPC); or live metric temporality turns out to
be **delta** and un-configurable, breaking redelivery idempotency (§5 mitigation
covers this but it changes the aggregation).

---

## 1. What `CLAUDE_CODE_ENABLE_TELEMETRY` emits (evidence)

Source: [Claude Code — Monitoring usage](https://code.claude.com/docs/en/monitoring-usage)
(accessed 2026-07-13). Corroborated against the existing `connector-facts.md` §5 OTel
notes (2026-07-04) — this spike extends them with the full attribute set and the
wire-format facts.

- **Two signals** are exported: **metrics** (`OTEL_METRICS_EXPORTER=otlp`) and
  **logs/events** (`OTEL_LOGS_EXPORTER=otlp`). Traces are a separate beta and out of
  scope for W6-D.
- **Export cadence:** metrics default `OTEL_METRIC_EXPORT_INTERVAL=60000` ms; logs
  default `OTEL_LOGS_EXPORT_INTERVAL=5000` ms. So a busy session produces *many small
  OTLP requests over time*, not one big upload — this shapes the aggregation (§5) and
  the batch-size math (§6).

### Metrics (8)
`claude_code.session.count`, `claude_code.lines_of_code.count`,
`claude_code.pull_request.count`, `claude_code.commit.count`,
`claude_code.cost.usage` (USD), `claude_code.token.usage` (tokens),
`claude_code.code_edit_tool.decision` (count), `claude_code.active_time.total` (s).

**Standard metric attributes (all):** `session.id`, `organization.id`, `user.id`,
`user.email`, `terminal.type`, plus opt-in `app.version` / `app.entrypoint` /
`user.account_uuid` / `user.account_id`.
**Metric-specific attributes we care about:**
- `token.usage`: `type` ∈ {input, output, cacheRead, cacheCreation}, `model`,
  `query_source` ∈ {main, subagent, auxiliary}.
- `cost.usage`: `model`, `query_source`.
- `lines_of_code.count`: `type` ∈ {added, removed}, `model`.
- `code_edit_tool.decision`: `tool_name` ∈ {Edit, Write, NotebookEdit},
  `decision` ∈ {accept, reject}, `source`, `language`.
- `active_time.total`: `type` ∈ {user, cli}.
- `session.count`: `start_type` ∈ {fresh, resume, continue, agents_view}.

### Events / logs (the ones W6-D reads)
`claude_code.tool_decision` (**the only true accept/reject signal**: `tool_name`,
`decision` ∈ {accept, reject}, `source`), `claude_code.tool_result`
(`tool_name`, `success`, `duration_ms`), `claude_code.api_request`
(`model`, `cost_usd`, `duration_ms`, token counts), `claude_code.api_error`
(`attempt` — the retry count), `claude_code.api_retries_exhausted`
(`total_attempts`, `total_retry_duration_ms`), `claude_code.user_prompt`
(`prompt_length`; **`prompt` redacted unless `OTEL_LOG_USER_PROMPTS=1`**).
**Standard event attributes (all):** `session.id`, `organization.id`, `user.id`,
`user.email`, `terminal.type`, `event.name`, `event.timestamp`, `event.sequence`,
`prompt.id`.

### Content-bearing fields (the denylist — §8)
`user_prompt.prompt` (needs `OTEL_LOG_USER_PROMPTS=1`),
`assistant_response.response` (needs `OTEL_LOG_ASSISTANT_RESPONSES=1`),
`api_request_body.body` / `api_response_body.body` (needs `OTEL_LOG_RAW_API_BODIES`),
`tool_result.tool_input` / `tool_parameters` / `tool_result.error`,
`tool_decision.tool_parameters` (all need `OTEL_LOG_TOOL_DETAILS=1`). **Revealyst
never sets any of these flags AND scrubs the fields defensively (§8).**

---

## 2. gRPC is a hard non-starter on Workers — reject it at the edge

Claude Code's exporter **defaults to `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`**
([monitoring-usage](https://code.claude.com/docs/en/monitoring-usage), 2026-07-13).
Cloudflare Workers **cannot serve inbound gRPC**: gRPC requires HTTP/2 bidirectional
streaming, which workerd does not implement — tracked open in
[cloudflare/workerd#6455](https://github.com/cloudflare/workerd/issues/6455)
(accessed 2026-07-13); even *outbound* unary gRPC from a Worker is not yet
implemented. Cloudflare's edge can *proxy* gRPC to an origin
([gRPC connections](https://developers.cloudflare.com/network/grpc-connections/)),
but that requires a real gRPC origin server — which a Worker is not.

**Consequence:** the receiver only ever accepts **OTLP/HTTP**. The founder MUST
override the default in the exporter config (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`
or `http/protobuf`, or the per-signal `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` /
`OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`). This is a **mandatory onboarding-copy line**, not
an optional tuning knob — with the default gRPC the exporter silently fails to reach
the receiver. W6-D's connections-page setup snippet must set it explicitly.

---

## 3. Wire format: OTLP/HTTP **JSON** is the pragmatic choice, protobuf as fallback

OTLP/HTTP offers two encodings, both valid input to the same routes
([OTLP spec](https://opentelemetry.io/docs/specs/otlp/), accessed 2026-07-13):
- `http/json` — `Content-Type: application/json`, the protobuf **JSON mapping**
  (numeric enums, `asInt` as a *string*, `*UnixNano` as strings).
- `http/protobuf` — `Content-Type: application/x-protobuf`, binary.

**Recommendation: mandate `http/json`; accept `http/protobuf` as a fallback.**

Rationale for workerd:
- **JSON decode is effectively free on workerd.** `JSON.parse` is native V8 (C++),
  not user JS, so it does not burn the metered CPU budget the way a pure-JS protobuf
  decoder would. Workers give **30 s CPU per queue-consumer invocation by default,
  raisable to 300 s** on the Paid plan, plus a 15 min wall-clock ceiling
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/);
  [higher CPU limits changelog](https://developers.cloudflare.com/changelog/post/2025-03-25-higher-cpu-limits/),
  accessed 2026-07-13) — but the *accept* path should stay tiny regardless (§5), and
  JSON keeps it tiny with zero dependencies.
- **Protobuf decode is *feasible but costs bundle + CPU.*** A pure-JS decoder
  (`protobufjs` / `@bufbuild/protobuf` with the OTLP `.proto`s) runs on workerd and,
  given the small per-request OTLP batches here (60 s metrics / 5 s logs flushes, not
  multi-MB), would fit the CPU budget. But it adds a codegen'd dependency and a
  non-trivial decode for no functional gain over JSON. It is the **fallback** for a
  founder platform that can only emit protobuf.
- **Both encodings deserialize to the identical logical shape** (`resourceMetrics[]`
  / `resourceLogs[]`), so W6-D's aggregation code is written **once** against the
  decoded object; only the thin decode step differs. Fixtures (§ `fixtures/otel/`)
  are given in JSON; the protobuf binary is the same message, byte-encoded.

Routes are the OTLP defaults: **`POST /v1/metrics`** and **`POST /v1/logs`** (the
exporter appends these to `OTEL_EXPORTER_OTLP_ENDPOINT`).

---

## 4. Auth + accept path — mirror `agent-ingest`, but respond OTLP-correctly

The receiver mirrors the Manual Sync ingest (`src/lib/agent-ingest.ts`) as its
template — same device-token trust model, same **cheap-auth-BEFORE-parse** ordering —
with one deviation forced by OTLP semantics.

### Auth: device token in the OTLP header
The OTLP exporter supports arbitrary auth headers via
`OTEL_EXPORTER_OTLP_HEADERS` (documented example `Authorization=Bearer <token>`;
[monitoring-usage](https://code.claude.com/docs/en/monitoring-usage), 2026-07-13).
This maps **1:1** onto the existing device-token scheme
(`rva1.<orgId>.<connectionId>.<secret>`, `parseAgentToken` +
`timingSafeEqualStr`, `src/lib/agent-ingest.ts:62-92`):

1. Parse the bearer token → `orgId` + `connectionId` (cheap, no body touched).
2. `forOrg(db, token.orgId).connections.get(connectionId)`; require
   `authKind === "device_token"` (or a new `otel_token` kind — a W6-D `authKind`
   question, see §10). Reject to a single opaque 401 for every auth-shaped failure.
3. Verify the AES-GCM-sealed secret via `withCredential` — the AAD binds
   `orgId:connectionId:kind`, so a token replayed against a foreign connection fails
   to decrypt. **Org scope is the token's own `orgId`; the payload's
   `organization.id` attribute is NEVER trusted for tenancy** — it is at most a
   cross-check (log a gap on mismatch), exactly as agent-ingest never trusts
   body-supplied org.
4. Only *after* auth do we read/enqueue the body (no unauthenticated decode of an
   attacker-supplied OTLP blob).

Identity resolution: `user.email` / `user.id` attributes resolve to a `tracked_user`
through the existing subject-resolution path **with explicit consent**, identical to
the local-log channel — never fabricate a person subject from an unresolved actor.

### Response: 200 OK, not 202
The Execution Plan's shorthand is "**202-accept → queue-batch**", describing the
*async posture* (accept fast, aggregate later). **On the wire the receiver MUST return
`200 OK`, not 202.** The OTLP spec defines success as **`HTTP 200 OK` with an
`Export<signal>ServiceResponse` body** (an empty `partial_success` = full success);
it does **not** define 202, and exporters treat only 200 as clean success —
`429/502/503/504` are retried with backoff / `Retry-After`
([OTLP spec](https://opentelemetry.io/docs/specs/otlp/), 2026-07-13). Returning a
non-200 (or a 202 some SDKs don't whitelist) triggers **client-side retry → duplicate
delivery**, which then leans entirely on our aggregation idempotency (§5). So:

- On accept: persist the raw batch (§6), enqueue the pointer, return **`200`** with
  body `{}` (JSON) / empty `ExportMetricsServiceResponse` (protobuf) and the matching
  `Content-Type`. The "accept" is fast but still *durable* (raw stored + enqueued)
  before we 200 — a 200 the client can't retry must mean we won't lose the batch.
- On auth failure: `401`. On malformed body: `400` (the exporter will drop, not
  retry indefinitely). On our own transient failure to persist/enqueue: a **retryable
  `503`** so the exporter re-sends rather than dropping data.

The internal shape is still "accept → queue → aggregate"; only the status line is
corrected to OTLP's 200.

---

## 5. Aggregation into the frozen grain — cumulative-max → sum by UTC day

**The core design problem:** the local-log channel does a **delete-then-upsert**
restatement of a whole window (`agent-ingest.ts:179-201`) because it re-summarizes the
*entire* window each sync. OTel is the opposite: a **continuous stream of small
deltas** arriving every 5–60 s, at-least-once, possibly redelivered by both the
exporter (§4) and the queue. Blindly delete-then-upserting per OTLP batch would erase
earlier data points for the same day; blindly summing every batch would double-count
on redelivery. Neither works directly.

**Recommended design — idempotent cumulative rollup:**

1. **Accept stage (request path):** authenticate (§4), store the raw decoded batch to
   the raw-payload pointer store (§6), enqueue **one queue message = one pointer**,
   return 200. No aggregation here — the request path stays sub-millisecond-cheap.
2. **Aggregate stage (queue consumer):** for each pointed-to batch, walk every data
   point / log record and bucket by **UTC calendar day** derived from
   `timeUnixNano` / `event.timestamp` (`"one chunk → one UTC day"`; a batch spanning
   midnight fans out to two day buckets). For each
   `(session.id, canonical_metric_key, dim)`:
   - **Counters (`session.count`, `token.usage`, `cost.usage`, `lines_of_code`,
     `code_edit_tool.decision`, `active_time.total`) are OTLP *cumulative* sums by
     default.** Store the **max cumulative value observed for that session on that
     day** (last-writer-wins by value, which is redelivery-safe: reprocessing an old
     or duplicate batch can only re-assert a value ≤ the current max). Then the day's
     metric value = **Σ over sessions** of that per-session max.
   - Persist the day's aggregate to `(org, subject, metricKey, day, dim)` by the
     **same delete-then-upsert restatement** agent-ingest uses — but the value being
     restated is *recomputed from all batches seen for that (session, day)*, so it is
     **monotonic and idempotent**, not additive-per-message.
   - `subject_day_signals` (24-slot hour histogram + peak concurrency) is populated
     from event `timeUnixNano` distribution across the day — session activity events
     give the hour buckets; overlapping `session.id`s give peak concurrency.
3. **Post-commit:** enqueue a `score-recompute` for the org/day **after** the
   transaction commits and only for a non-empty batch — verbatim the agent-ingest
   guard (`agent-ingest.ts:236-259`), so a redelivered empty batch can't amplify into
   full-org recomputes.

**Why cumulative-max is the right call over delta:** delta temporality would make the
consumer purely additive (sum every delta), but OTLP gives data points **no dedup
id**, so an at-least-once redelivery double-counts with no defence. Cumulative + max
is inherently idempotent under redelivery — the safer posture for a queue with 100
retries. **W6-D must confirm on live capture** whether Claude Code emits cumulative
(SDK default) or delta, and whether
`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` is set; the fixtures here mark
`aggregationTemporality: 2` (CUMULATIVE) as the assumed-default (NLV-OT1).

**Canonical mapping (proposals for W6-D — see §7 for the contract/ADR consequences):**

| OTel source | dim | Canonical key |
|---|---|---|
| `token.usage {type:input}` | `""` + `model=<id>` for `model_tokens` | `tokens_input` (+ `model_tokens`) |
| `token.usage {type:output}` | as above | `tokens_output` (+ `model_tokens`) |
| `token.usage {type:cacheRead}` | `""` | `tokens_cache_read` |
| `token.usage {type:cacheCreation}` | `""` | `tokens_cache_write` |
| `cost.usage` | `""` | `spend_cents` (native vendor USD → cents; NOT `_estimated`) — **verify at ADR: keep estimated label?** |
| `session.count` | `""` | `sessions` |
| `commit.count` / `pull_request.count` | `""` | `commits` / `pull_requests` |
| `lines_of_code.count {type:added/removed}` | `""` | `lines_added` / `lines_removed` |
| `code_edit_tool.decision {decision:accept/reject}` | `""` | `edit_actions_accepted` / `edit_actions_rejected` |
| `active_time.total {type:user}` | `""` | **`active_time_seconds` (NEW key — §7)** |
| `api_error.attempt>1` / `api_retries_exhausted` | `""` | `retries` |
| `tool_result` / `tool_decision` `tool_name` | `feature=<tool>` | `feature_used` |

---

## 6. The 128 KB queue bound → raw-payload pointer batching

Cloudflare Queues cap an individual message at **128 KB** (≈100 bytes of that is
internal metadata); `sendBatch` allows up to **100 messages or 256 KB total**;
a consumer receives up to **100 messages per invocation**; **5,000 msg/s** per queue;
up to **100 retries** per message
([Queues limits](https://developers.cloudflare.com/queues/platform/limits/),
accessed 2026-07-13). Cloudflare's own guidance: **store payloads larger than the
limit in R2 and enqueue a reference.**

**Design:** the queue message is **never the OTLP batch** — it is a **pointer**:
```
{ kind: "otel-batch", orgId, connectionId, rawPayloadId, signal: "metrics"|"logs", receivedAt }
```
The raw batch itself lands in the existing `raw_payloads` landing zone (DB) — or R2
for large batches — **after boundary scrubbing (§8)**, keyed by `rawPayloadId`, with
the same expiry/purge machinery (`purge-raw`) already in `poller/messages.ts`. This
keeps every queue message well under 128 KB regardless of batch size, makes the
aggregation **replayable** (re-run from `rawPayloadId`), and gives the accept path a
single small write + enqueue.

Two realistic sizings, both comfortably under the bound *even if we inlined* — but the
pointer removes the question entirely:
- **Metrics batch (60 s flush):** a handful of metrics × a few attribute sets ≈
  low single-digit KB. Would fit inline; pointer still preferred for replayability.
- **Logs batch (5 s flush) on a busy session:** dozens of events, each with the
  standard attribute block — can approach tens of KB and, on a burst, exceed 128 KB.
  The pointer is **required** here.

New queue = **create it in BOTH `deploy.yml` AND the `ci.yml` preview-deploy job**
(standing gotcha: a consumer referencing a non-existent queue fails
`wrangler versions upload` and reds every PR preview). This is a W6-D build step, not
a spike step — flagged so it isn't forgotten.

---

## 7. Proposed new metric keys — PROPOSALS ONLY for W6-D's catalog+contract ADR

**Nothing in this spike adds a key.** `CANONICAL_METRICS` (`src/contracts/metrics.ts`)
and its seed migration (`drizzle/0007`) are frozen; new keys are an ADR-gated
catalog+contract change in lockstep (the drift test enforces it). These are the
proposals W6-D's ADR should carry:

1. **`active_time_seconds` — genuinely NEW.** No existing key represents hands-on
   active time. Source: `claude_code.active_time.total {type:user}`. Proposed catalog
   entry: `{ family: "active_time" (new family) | "sessions", unit: "seconds" (new
   unit), dimKind: null }`. This is the flagship "real active time" signal OTel
   uniquely provides. *Honesty:* it floors to 0 on no rows like other plain metrics;
   never fabricated for a channel that doesn't emit it.
2. **`edit_actions_accepted` / `edit_actions_rejected` — keys ALREADY EXIST; OTel is
   their first real producer.** `code_edit_tool.decision` is the only source of *true*
   accept/reject (the local-log channel can only proxy — `connector-facts.md` §5).
   **No new key needed** — but the ADR should record OTel as the authoritative
   producer and confirm the honesty stance (absence ≠ measured zero for the
   *acceptance ratio*; per the scoring-engine rule a ratio component omits when one
   side is absent).
3. **`retries` — key ALREADY EXISTS; OTel is its first real producer.** Source:
   `api_error.attempt` / `api_retries_exhausted.total_attempts`. No new key; producer
   note only.
4. **`spend_cents` vs `spend_cents_estimated` — ADR decision, not a new key.**
   `cost.usage` is a vendor-emitted USD figure (more authoritative than the local
   channel's token×price estimate). The ADR must decide whether OTel cost lands as
   `spend_cents` (measured) or stays `_estimated` — I lean `spend_cents` **with a
   provenance note**, but it is a labelling/honesty call for the founder + W6-D, not
   a spike call.

Anything beyond these (context-usage as a *directional* signal, tool taxonomy
richness) is W6-D/W6-E scope and rides the `feature_used` dim, not new keys.

---

## 8. Privacy — the THIRD §13 enforcement point (content NEVER persisted)

The no-prompt-content architecture already has two enforcement points on the
local-log channel: the on-device allowlist parser (`parse.ts:1-12`, "THE PRIVACY LINE
LIVES HERE") and the server `dim` bound (`agent-ingest.ts:132-152`). The OTel receiver
is the **third** — and it is different in kind: the raw OTLP payload arrives at *our*
edge, so scrubbing is **server-side at the boundary**, before anything is stored.

**Design (for W6-D to implement; spike-level):**
- **Content flags are never set** — the receiver's onboarding copy never instructs
  `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_RAW_API_BODIES`,
  or `OTEL_LOG_TOOL_DETAILS`. Default Claude Code redacts prompt/response/body/tool
  content without these flags.
- **Defensive boundary scrub (do not trust the client to have redacted).** Before the
  raw batch is written to the pointer store (§6), a **denylist scrubber** strips, by
  attribute key, every content-bearing field regardless of whether a flag was set:
  `prompt`, `response`, `body`, `body_ref`, `tool_input`, `tool_parameters`,
  `error` (tool detail), and any `*_body*`. Only **allowlisted structural
  attributes** survive into `raw_payloads` (ids, timestamps, numeric usage, enums,
  `model`, decision/source/type strings, counts). Same posture as the local parser,
  moved to the ingress.
- **`model` is vendor free text** → reuse the `sanitizeModel` charset+length clamp
  (`parse.ts:75-82`) and the server `dim` bound (≤128 chars, no control chars) before
  `model` becomes a `dim`. An OTLP attribute is an exfil surface exactly like a log's
  `message.model`.
- **Scrub is CI-tested in W6-D** (spec §16 / plan W6-D testing): a fixture-replay
  test asserting no content field ever reaches `raw_payloads` or `metric_records`.
  The synthetic fixtures here deliberately include a `user_prompt` event with
  `prompt_length` but **no `prompt`** to exercise the "already redacted" path, and a
  clearly-marked hostile fixture would be added by W6-D to exercise the "flag set
  anyway → scrubbed" path.

This satisfies rule-7 (no prompt-content ingestion) and the DPIA/landing
"No prompt content. Ever." claim for the OTel channel, by *shape* + *boundary scrub*,
not by trusting exporter config.

---

## 9. Fixture capture — **FOUNDER-GATED** (this workstream cannot perform it)

Live OTLP payload capture requires running the founder's own Claude Code with
telemetry on, pointed at a capture endpoint. That is founder infra (a real Claude
Code session, real credentials, a reachable collector). **This spike ships
hand-constructed synthetic fixtures only** (`fixtures/otel/`, clearly labelled). The
founder (or W6-D, once the founder has run it) captures real payloads with:

```bash
# 1. Stand up a throwaway capture collector that logs raw OTLP bodies.
#    Simplest: an otelcol with a debug/file exporter, OR a tiny local HTTP
#    endpoint that writes each POSTed body to disk. Point Claude Code at it:

export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json          # MANDATORY: not the grpc default (§2/§3)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318   # OTLP/HTTP default port; routes /v1/metrics, /v1/logs
export OTEL_METRIC_EXPORT_INTERVAL=10000              # flush faster so capture is quick
export OTEL_LOGS_EXPORT_INTERVAL=2000
# DO NOT set OTEL_LOG_USER_PROMPTS / OTEL_LOG_ASSISTANT_RESPONSES /
# OTEL_LOG_RAW_API_BODIES / OTEL_LOG_TOOL_DETAILS — content must stay redacted.

# 2. Use Claude Code normally for ~5–10 min: edit files (accept AND reject a few
#    edits to capture code_edit_tool.decision both ways), run bash, spawn a
#    subagent, trigger at least one api_error/retry if possible.

# 3. Record, per captured POST: the request PATH (/v1/metrics vs /v1/logs), the
#    Content-Type, the Authorization header shape, and the raw JSON body.
```

**What to record and fold back into `fixtures/otel/` + this doc (resolves the NLVs):**
- **NLV-OT1** — metric **aggregation temporality**: cumulative (assumed) or delta?
  (Decides §5's max-vs-sum.)
- **NLV-OT2** — are `organization.id` / `user.id` / `session.id` **resource**
  attributes or **datapoint/logRecord** attributes? (Fixtures assume resource-level
  identity + datapoint-level metric dims; receiver must read whichever is real.)
- **NLV-OT3** — real attribute *values* for `model`, `terminal.type`, `query_source`,
  and the exact `code_edit_tool.decision` attribute set on this Claude Code version.
- **NLV-OT4** — real per-session/per-day **batch sizes** (validates the §6 sizing;
  confirms whether logs batches can exceed 128 KB in practice).
- **NLV-OT5** — does the founder's platform (direct API vs Bedrock/Vertex) actually
  honour `http/json`, or force gRPC/protobuf? (The one no-go trip from §0.)

### Results — resolved 2026-07-14 (real founder capture)

Live capture completed: 63 substantial `fixtures/otel/{metrics,logs}-*.captured.json`
files from a real Claude Code session (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`
against a local `scripts/otel-capture.mjs` collector). **Privacy check: clean** — no
`prompt`/`response`/`tool_input`/`tool_parameters`/raw-body content in any file
(`user_prompt.prompt` and `assistant_response.response` both read `<REDACTED>`,
confirming the client-side redaction the receiver design depends on). Identity
attributes (`user.email`, `user.id`, `organization.id`, plus custom
`developer.name`/`team` resource attrs) are present as designed and are exactly what
the boundary scrubber (§8) must be scoped around, not a leak.

| # | Question | **Resolved answer** |
|---|---|---|
| OT1 | Aggregation temporality | **DELTA** (`aggregationTemporality: 1`, `isMonotonic: true` on every sum) — **not** the cumulative default this spike assumed. **This invalidates §5's cumulative-max aggregation design** (see below). |
| OT2 | Identity attribute placement | **Datapoint/logRecord-level**, not resource-level. `resource.attributes` only carries `developer.name`, `team`, `host.arch`, `os.type`, `os.version`, `service.name=claude-code`, `service.version`. |
| OT3 | Real attribute values | `model="claude-sonnet-5"`. **`terminal.type` never appears** (0 occurrences — drop it from any required-attribute assumption). `query_source` on metrics = `{main, auxiliary}` (not `subagent` as documented); on the `api_request` log event it's a *different* value space, `{repl_main_thread, away_summary}`. `code_edit_tool.decision` attrs: `decision`, `source`, `tool_name`, `language` + standard identity. |
| OT4 | Batch sizes | Metrics ~19 KB / 5-6 metrics / up to 9 datapoints typical (max observed 27.8 KB); logs 4-17 KB / 1-4 logRecords. **All comfortably under the 128 KB queue bound** even before the §6 pointer indirection. |
| OT5 | `http/json` honored end-to-end | **Yes** — every captured file is valid JSON matching `ExportMetricsServiceRequest`/`ExportLogsServiceRequest`, with `asInt`/`*UnixNano` as strings and enums as numbers, exactly per the JSON mapping. |

**Coverage vs the §1 documented signal list:** 5 of 8 metrics appeared
(`cost.usage`, `token.usage`, `active_time.total`, `lines_of_code.count`,
`code_edit_tool.decision`; missing `session.count`, `commit.count`,
`pull_request.count` — no git operations in the capture session). 4 of 6 documented
log/event types appeared (`tool_decision`, `tool_result`, `api_request`,
`user_prompt`; missing `api_error`/`api_retries_exhausted` — no retry occurred).
**Three undocumented event types showed up and are not in §1's list:**
`assistant_response`, `permission_mode_changed`, `mcp_server_connection` — W6-D
should decide whether any of these need a canonical mapping.

**§0/§5 impact — the one real blocker:** the go/no-go decision itself still holds
(OTLP/HTTP JSON on workerd is confirmed viable end-to-end, OT5 above), but **§5's
"cumulative-max → sum" aggregation must be redesigned before W6-D freezes it** — real
data is delta, which is additive and has no dedup id, so naive summing
double-counts under at-least-once redelivery exactly the way §5 warned cumulative
would *not*. W6-D's options: (a) design an idempotent delta aggregation (e.g. a
per-batch dedup key derived from `(session.id, metric, timeUnixNano)` persisted
alongside the running sum), or (b) set
`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` in the mandatory
onboarding config and re-verify with a follow-up capture that the SDK honors it.
Not yet captured: a session with git commits/PRs (for the 3 missing metrics) and an
API retry (for `api_error`/`api_retries_exhausted`) — low priority, can ride a
future capture rather than blocking W6-D's aggregation redesign.

---

## 10. Open questions handed to W6-D (not blockers)

- **`authKind`:** reuse `device_token` for the OTel connection, or add an
  `otel_token` kind? (Affects the `connections.get` guard in §4; a small
  schema/enum question for W6-D's ADR — `connection_credentials` shape is unchanged
  either way, it's the same base64 envelope.)
- **Connection provisioning UX:** the connections page must mint the token and render
  the full exporter env block (§9) with the mandatory `http/json` protocol line.
- **Both-channels dedup:** a founder running local-log Manual Sync AND OTel on the
  same machine double-counts unless W6-A's dual-source dedup rails merge first (plan
  W6-D risk). Not a spike concern; noted for sequencing.
- **New queue in both workflows** (§6) — build step, easy to forget.

---

## Change log
- 2026-07-13: Initial spike (W5-B). Wire-format + auth + aggregation + batching +
  scrub design decided; go/no-go = **GO** with `http/json` mandated. All external
  claims cited (Claude Code monitoring-usage, OTLP spec, workerd#6455, Cloudflare
  Queues/Workers limits, all accessed 2026-07-13). Fixtures are synthetic; live
  capture is founder-gated (§9) and resolves NLV-OT1..OT5 before W6-D freezes its
  aggregation.
- 2026-07-14: Founder-gated live capture done. 63 real `fixtures/otel/*.captured.json`
  files landed; all five NLV-OT unknowns resolved (§9 "Results"). Privacy check
  clean. **NLV-OT1 came back delta, not the assumed cumulative** — §5's
  cumulative-max aggregation needs a redesign or a temporality-preference override
  before W6-D freezes it; everything else in §0's go/no-go stands unchanged.
