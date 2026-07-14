# 0039 — OTel proficiency markers + the measured capability tier

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** W7-8 (AI Capability Execution Plan, phase P8) — founder OTel
  fixture capture done (real `fixtures/otel/*.captured.json` landed, #220).

## Context

Through P2–P7, per-person capability mastery is hard-capped at the `directional`
confidence tier (uncalibrated proxies over admin-API metrics). Spec V4's two-tier
honesty law upgrades a capability to `measured` only once **higher-fidelity
markers** exist — signals no admin-API connector can emit (real active time, real
accept/reject). The Claude Code OpenTelemetry export is that source; the receiver
was gated on the founder capturing real payloads (W6-D), which has now happened.

This touches a frozen contract (`src/contracts/metrics.ts` — `CANONICAL_METRICS`
+ the family/unit enums) additively, so it is ADR-gated (rule 1).

## Decision

### Marker metrics (additive, mig 0034)

Add three OTel marker metric keys to `CANONICAL_METRICS` (+ the seeded
`metric_catalog`, in lockstep so the contract-drift test stays green) — a new
`markers` family and a `seconds` unit (both additive text-enum widenings, no
DDL):

- `otel_active_time` (markers/seconds) — measured active Claude Code time
  (`claude_code.active_time.total`, DELTA temporality → summed per day).
- `otel_edit_accepted` / `otel_edit_rejected` (markers/count) — real code-edit
  accept/reject decisions (`claude_code.code_edit_tool.decision`) — the
  ground-truth acceptance the connectors can only proxy.

`OTEL_MARKER_METRIC_KEYS` (in the contract) is the canonical marker set. Migration
`0034` also binds these markers to the capabilities OTel can measure
(`effective-prompting`, `ship-with-ai`, `agentic-delivery`) via `capability_signals`.

### The receiver

`POST /v1/metrics` (`src/app/v1/metrics/route.ts` → `ingestOtelMetrics`) and
`POST /v1/logs`. Device-token auth **reuses agent-ingest's scheme** verbatim
(`rva1.<orgId>.<connectionId>.<secret>`): the token identifies org + connection;
the subject (person) comes from the payload's `user.id`/`user.email`/
`developer.name`. A **pure decoder** (`src/lib/otel-ingest.ts`, tested against the
REAL captured fixtures per rule 2) handles the OTLP/HTTP-JSON quirks (string ints,
nanosecond-string timestamps) and emits aggregated marker records; the receiver
resolves subjects (idempotent upsert) and upserts `metric_records` on the frozen
natural key (a re-export restates, never double-appends). `/v1/logs` currently
accepts + acks (the markers used today come from the metrics stream; mining log
events — `tool_decision`, `mcp_server_connection` — is a documented follow-up).

### The measured tier

`src/scoring/capability-state.ts`: a capability with evidence for **≥ 2** of its
bound OTel markers (`MEASURED_MARKER_MIN`) renders `confidenceTier: "measured"`
instead of `directional`. Markers are **distinct metric keys** from the connector
metrics, so a marker and a connector-derived metric never double-count the same
event (the plan's "no cross-channel double-count"). Below the threshold, mastery
stays `directional`. This also activates the Growth-Journey band headline (W7-4
follow-up), which was gated on `measured`.

## Contracts affected

- **`src/contracts/metrics.ts`** (frozen) — additive `markers` family, `seconds`
  unit, 3 marker keys + `OTEL_MARKER_METRIC_KEYS`.
- **`src/db/schema.ts`** — `metric_catalog.unit` TS-enum widened by `seconds`
  (no DDL). Migration `0034_seed-otel-markers.sql` (data-only: catalog rows +
  capability bindings).
- New receiver routes + `src/lib/otel-ingest.ts` (pure decoder) +
  `src/lib/otel-receiver.ts`.
- `capability-state.ts` — the tier is now `directional | measured` (was capped).
- Not affected: the frozen score engine, `metric_records` shape (marker rows use
  the existing columns), credentials, `org-scope` public API. No new org-scoped
  table → no three-registration burden (markers land in the existing
  `metric_records`, already registered).

## Explicitly deferred (a SEPARATE gate)

**Role expansion (non-engineering roles)** stays deferred. The OTel gate is
cleared, but role packs need an *honest role-telemetry source* (M365 Copilot /
Google Workspace admin APIs — Spec V4 §16(3)), which does not exist. Shipping a
non-eng role pack without a real telemetry source would fabricate coverage
(invariant b), so it waits for that distinct gate.

## Consequences

- Capabilities with ≥2 corroborating OTel markers render `measured`, self-view-
  only, from real accept/reject + active time — the honest upgrade from
  directional, gated on evidence per person.
- The OTLP receiver is decode-tested against the founder's real payloads, so the
  attribute placement / value quirks are handled against ground truth, not
  guesses.
