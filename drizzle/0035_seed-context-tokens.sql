-- TEL-012 context-window usage signal (ADR 0042, founder decision D11).
-- Data-only seed — no DDL (metric_catalog.family/.unit are plain text; both
-- `tokens` values already exist, so there is no enum widening at all). Additive
-- to the frozen catalog (contracts-v1); CANONICAL_METRICS is updated in lockstep
-- and the contracts test asserts the two never drift. Idempotent (ON CONFLICT
-- DO NOTHING).
--
-- HONESTY NOTE (rule 2 / ADR 0042): unlike the ADR-0039 OTel markers, NO producer
-- writes this key yet. There is no `context*` field in any captured OTel fixture,
-- so this is NOT an OTel marker (absent from OTEL_MARKER_METRIC_KEYS) and never
-- upgrades a capability to `measured`. Its intended source is the Anthropic usage
-- report `context_window` dimension (docs/connector-facts.md) — documented but not
-- yet harvested, and its emitter is gated on a real recorded payload. Until then
-- the key exists as honest vocabulary only: with no rows, the capability engine
-- skips it (no evidence → no row), never zero-filling it.
INSERT INTO "metric_catalog" ("key", "family", "name", "description", "unit", "dim_kind") VALUES
('context_tokens', 'tokens', 'Context tokens used', 'Tokens carried in the AI model''s context window per request — how much of the available context a person actually uses. Intended source: the Anthropic usage report context_window dimension (not yet harvested; emitter fixture-gated). Directional-only; absence is never zero-filled.', 'tokens', NULL)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Bind to cost-efficient-usage (metric binding). Context length directly drives
-- per-request cost/value, so this is the natural home. cost-efficient-usage
-- already carries three signals (output_per_spend, engagement_per_spend,
-- spend_cents), so this fourth, currently-dataless binding is purely additive:
-- with no context_tokens rows it contributes no evidence and leaves the
-- capability's computed mastery byte-identical until an emitter lands.
INSERT INTO "capability_signals" ("capability_slug", "metric_key", "component_key") VALUES
  ('cost-efficient-usage', 'context_tokens', NULL)
ON CONFLICT ON CONSTRAINT "capability_signals_binding_uq" DO NOTHING;
