-- W7-8 OTel proficiency-marker metric-catalog additions + capability bindings
-- (ADR 0039). Data-only seed — no DDL (metric_catalog.family/.unit are plain
-- text; the new `markers` family + `seconds` unit are TS-only enum widenings).
-- Additive to the frozen catalog (contracts-v1); CANONICAL_METRICS is updated in
-- lockstep and the contracts test asserts the two never drift. Idempotent
-- (ON CONFLICT DO NOTHING). These keys are written ONLY by the OTel receiver
-- (/v1/metrics, /v1/logs) — never by an admin-API connector — and are the
-- corroborating markers that upgrade a capability from directional to measured.
INSERT INTO "metric_catalog" ("key", "family", "name", "description", "unit", "dim_kind") VALUES
('otel_active_time', 'markers', 'Active time (measured)', 'Whole seconds of measured active Claude Code time per day, from the OTel receiver (claude_code.active_time.total). A true active-time marker — not derivable from any admin-API connector; absence is never zero-filled.', 'seconds', NULL),
('otel_edit_accepted', 'markers', 'Code edits accepted (measured)', 'Code-edit tool decisions ACCEPTED per day, from the OTel receiver (claude_code.code_edit_tool.decision, decision=accept). The ground-truth acceptance the connectors can only proxy.', 'count', NULL),
('otel_edit_rejected', 'markers', 'Code edits rejected (measured)', 'Code-edit tool decisions REJECTED per day, from the OTel receiver (claude_code.code_edit_tool.decision, decision=reject). Paired with accepted to give a real acceptance rate.', 'count', NULL)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Bind markers to capabilities (metric bindings). A capability with evidence for
-- ≥2 of its bound markers renders `measured` (ADR 0039). Effective prompting +
-- shipping with AI are the capabilities OTel can measure with real accept/reject
-- + active time; agentic delivery gets active time as one corroborating marker.
INSERT INTO "capability_signals" ("capability_slug", "metric_key", "component_key") VALUES
  ('effective-prompting', 'otel_edit_accepted', NULL),
  ('effective-prompting', 'otel_edit_rejected', NULL),
  ('effective-prompting', 'otel_active_time', NULL),
  ('ship-with-ai', 'otel_edit_accepted', NULL),
  ('ship-with-ai', 'otel_active_time', NULL),
  ('agentic-delivery', 'otel_active_time', NULL)
ON CONFLICT ON CONSTRAINT "capability_signals_binding_uq" DO NOTHING;
