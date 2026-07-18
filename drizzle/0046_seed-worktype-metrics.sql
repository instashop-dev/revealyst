-- worktype metric keys (on-device work-type classifier, ADR 0055 / 0059,
-- D-DA-5). Data-only seed — no DDL: metric_catalog.family/.unit/.dim_kind are
-- plain text columns (the drizzle text-enum on dim_kind is TS-only), and the
-- new family value `worktype` + the new dim_kind value `task_category` need no
-- enum widening at the DB level — only the seed rows + the CANONICAL_METRICS
-- entries, which the contracts test asserts never drift (bidirectionally, so
-- these rows and the CANONICAL_METRICS additions MUST land in the same PR).
-- Additive to the frozen catalog (contracts-v1). Idempotent (ON CONFLICT DO
-- NOTHING).
--
-- HONESTY NOTE (rule 2 / ADR 0055 / 0059): these three keys are the output of
-- the resident desktop agent's on-device work-type classifier. It reads prompt
-- text ON THE DEVICE only, classifies it with deterministic heuristics into a
-- CLOSED enum, and emits ONLY the bounded label + counts — the words never leave
-- the machine (borrow-and-drop, exactly like count_text). `task_category`'s dim
-- carries a value from the closed enum (TASK_CATEGORY_IDS: research, ideation,
-- drafting, summarization, analysis, review, coding, planning, other);
-- unclassifiable falls to `other`, never raw text. None of the three is an OTel
-- marker (absent from OTEL_MARKER_METRIC_KEYS), so a capability bound to them
-- caps at `directional`, never `measured` (ADR 0039). Native-app-only and
-- data-starved for non-dev roles today (ADR 0055 §1), and live emission is gated
-- on a real captured fixture (rule 2) — so no producer writes these keys yet;
-- with no rows the capability engine skips them (no evidence -> no row), never
-- zero-filled.
INSERT INTO "metric_catalog" ("key", "family", "name", "description", "unit", "dim_kind") VALUES
('task_category', 'worktype', 'Kind of task', 'How many prompts of each work KIND this UTC day (dim = task_category, a closed work-type enum e.g. research, drafting, coding; unclassifiable falls to other). Derived by the resident desktop agent''s on-device work-type classifier, which reads prompt text ON-DEVICE only and emits ONLY the closed-enum label + count -- the words never leave the machine. Directional-only (not an OTel marker); absence is never zero-filled.', 'count', 'task_category'),
('iteration_depth', 'worktype', 'Refinement turns', 'Per-day count of refinement/follow-up prompts that revise an earlier answer, detected on-device from prompt text (borrow-and-drop; only the count leaves, never the words). Directional-only (not an OTel marker); absence is never zero-filled.', 'count', NULL),
('verification_behavior', 'worktype', 'Checking AI output', 'Per-day count of prompts that check AI output (asked to verify, cite a source, test, or confirm), detected on-device from prompt text (borrow-and-drop; only the count leaves, never the words). Directional-only (not an OTel marker); absence is never zero-filled.', 'count', NULL)
ON CONFLICT ("key") DO NOTHING;
