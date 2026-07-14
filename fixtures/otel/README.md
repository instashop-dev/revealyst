# `fixtures/otel/` — Claude Code OTLP receiver fixtures (W5-B spike)

Fixtures for the Claude Code OpenTelemetry receiver (**W6-D**). They let W6-D wire the
`/v1/metrics` and `/v1/logs` routes + queue-batch aggregation against a decided shape
**before** any live payload capture exists.

> **Full design + go/no-go:**
> [`docs/research/2026-07-13-claude-code-otel-receiver-spike.md`](../../docs/research/2026-07-13-claude-code-otel-receiver-spike.md).
> Read it first — this README only covers the fixture contract + capture procedure.

## ⚠️ These fixtures are SYNTHETIC (hand-constructed), not captured

Every file with `.synthetic.json` in its name is **hand-written and illustrative**.
The **attribute values are invented**; only the **shapes and names** are real —
they follow the OTLP/HTTP JSON protobuf-mapping and the Claude Code metric/event
names documented at
<https://code.claude.com/docs/en/monitoring-usage> (accessed 2026-07-13).

Real captured payloads do **not** exist yet because capture is **founder-gated**
(needs the founder's own Claude Code run with telemetry enabled — see below). When
they are captured, drop them in as `*.captured.json` and resolve the `NLV-OT*`
unknowns in the spike doc §9.

## Directory contract

| File | OTLP message | Wire route | Encoding |
|---|---|---|---|
| `metrics-export-request.synthetic.json` | `ExportMetricsServiceRequest` | `POST /v1/metrics` | OTLP/HTTP JSON |
| `logs-export-request.synthetic.json` | `ExportLogsServiceRequest` | `POST /v1/logs` | OTLP/HTTP JSON |

Naming convention (for when captures land):
- `*.synthetic.json` — hand-constructed illustration (current files). Never treat as
  ground truth for attribute placement/values.
- `*.captured.json` — real founder capture, content-redacted. These become the
  ground truth and drive the W6-D replay tests.
- The top-level `_fixture` key in each file is **metadata for humans/tests** and is
  NOT part of the OTLP message — a decoder must read `resourceMetrics` /
  `resourceLogs` and ignore `_fixture`.

### Encoding note (JSON vs protobuf)
Fixtures are given in **OTLP/HTTP JSON** because that is the **recommended/mandated**
exporter encoding for this receiver (spike §3 — `JSON.parse` is native on workerd;
gRPC is impossible, spike §2). The identical logical message can arrive as
**`http/protobuf`** (`Content-Type: application/x-protobuf`) — same
`resourceMetrics[]` / `resourceLogs[]` structure, just byte-encoded; W6-D's optional
protobuf path decodes it to the same object the JSON path produces. No separate
protobuf *fixture* is shipped (a binary blob is not reviewable); if W6-D needs one,
encode these JSON files through the OTLP `.proto`s. Note the JSON mapping quirks the
decoder must handle: integer values are **strings** (`"asInt": "48213"`,
`"intValue": "12"`), `*UnixNano` fields are **strings**, and enums are **numbers**
(`aggregationTemporality: 2` = CUMULATIVE, `severityNumber: 9` = INFO).

## What the fixtures deliberately exercise

- **Metrics** (`metrics-export-request.synthetic.json`): `session.count`,
  `token.usage` (input/output/cacheRead, each with `model` + `query_source`),
  `cost.usage`, `code_edit_tool.decision` (**both accept AND reject** data points —
  the true accept/reject signal), `active_time.total {type:user}` (the proposed NEW
  `active_time_seconds` key), `lines_of_code.count` (added/removed), `commit.count`.
  All under one `session.id` on one UTC day so the §5 "max cumulative per session →
  sum across sessions → one UTC-day bucket" aggregation has a concrete input.
- **Logs** (`logs-export-request.synthetic.json`): `user_prompt` (**with
  `prompt_length` but NO `prompt`** — redacted-content path), `tool_decision`
  ×2 (accept + reject), `tool_result`, `api_error` (`attempt: 2` → the `retries`
  producer). Identity + session attributes present for subject resolution.

**Privacy:** no fixture contains any content field. W6-D should ADD a hostile fixture
(a record that *does* carry `prompt` / `tool_input` / `body` as if a content flag were
set) to prove the boundary scrubber (spike §8) strips it before persistence — the
scrub test is CI-gated in W6-D.

## Capture procedure — FOUNDER-GATED

This spike cannot capture real payloads: it needs a real Claude Code session on the
founder's machine with telemetry pointed at a capture endpoint (founder infra). The
exact procedure (verbatim in the spike doc §9):

```bash
# Point Claude Code's OTel exporter at a throwaway local OTLP/HTTP collector that
# logs each raw POST body (e.g. otelcol with a file/debug exporter, or a tiny HTTP
# server that writes bodies to disk).

export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json          # MANDATORY — override the grpc default (spike §2/§3)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318   # OTLP/HTTP default; routes /v1/metrics, /v1/logs
export OTEL_METRIC_EXPORT_INTERVAL=10000              # flush faster for a quick capture
export OTEL_LOGS_EXPORT_INTERVAL=2000
# DO NOT set OTEL_LOG_USER_PROMPTS / OTEL_LOG_ASSISTANT_RESPONSES /
# OTEL_LOG_RAW_API_BODIES / OTEL_LOG_TOOL_DETAILS — content must stay redacted.

# Then use Claude Code ~5–10 min: edit files (accept AND reject edits), run bash,
# spawn a subagent, and if possible trigger an api_error/retry.
```

**Record, per captured POST:** the PATH (`/v1/metrics` vs `/v1/logs`), the
`Content-Type`, the `Authorization` header shape, and the raw JSON body. Land the
bodies here as `*.captured.json` and resolve the spike-doc §9 unknowns —
particularly **NLV-OT1** (metric aggregation temporality: cumulative vs delta) and
**NLV-OT2** (whether `organization.id`/`user.id`/`session.id` are resource- or
datapoint-level attributes), both of which the synthetic fixtures only *assume*.
