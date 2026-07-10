-- V1.5 agentic + credits metric-catalog additions (ADR 0018 / Spec V3 §8.3,
-- §10.1). Data-only seed — no DDL (metric_catalog.family is plain text and
-- .unit is a TS-only text enum, so the new `agentic` family and `credits`
-- unit need no column change). Additive to the frozen catalog (contracts-v1);
-- CANONICAL_METRICS in src/contracts/metrics.ts is updated in lockstep and a
-- contract test asserts the two never drift.
--
-- Idempotent: ON CONFLICT DO NOTHING, so replays (dev-db, tests, deploy) are
-- safe. Agentic rows are populated only where a vendor genuinely reports the
-- agent signal (Copilot agent/CLI/coding-agent fields, Cursor agentRequests,
-- Claude Code sessions) — never fabricated (invariant b). ai_credits is
-- vendor-reported Copilot AI Credits (a native credits unit, NOT dollars);
-- any cents conversion is derived and lands on spend_cents_estimated.
INSERT INTO "metric_catalog" ("key", "family", "name", "description", "unit", "dim_kind") VALUES
('agent_sessions', 'agentic', 'Agent sessions', 'Agent/CLI sessions per day (Copilot CLI sessions; Claude Code sessions). Distinct from generic sessions — these are agent-mediated. Absent for vendors with no agent-session concept, never zero-filled.', 'count', NULL),
('agent_requests', 'agentic', 'Agent requests', 'Agent-mode requests per day (Cursor agentRequests; Copilot agent-mode + CLI requests). A gap where a vendor has no agent request count (e.g. Claude Code) — rows are simply absent.', 'count', NULL),
('agent_active', 'agentic', 'Agent used', 'Subject used an agentic feature on this UTC day (value 1). The cross-vendor agentic-adoption flag: Copilot used_agent/coding-agent, Cursor agent requests, Claude Code activity.', 'flag', NULL),
('ai_credits', 'spend', 'AI credits', 'GitHub Copilot AI Credits consumed per day (usage-based billing, vendor-reported). A native credits unit — NOT a dollar amount; a cents conversion would be derived/estimated (spend_cents_estimated) and labeled, never billing truth. Available only from 2026-06-19; earlier days are absence, never zero.', 'credits', NULL)
ON CONFLICT ("key") DO NOTHING;
