-- ai_tool_used metric key (Recommendation #7, ADR 0057). Data-only seed — no
-- DDL: metric_catalog.family/.unit/.dim_kind are plain text columns (the drizzle
-- text-enum on dim_kind is TS-only), and `active_users`/`flag` already exist. The
-- new dim_kind value `tool` needs no enum widening at the DB level — only the
-- seed row + the CANONICAL_METRICS entry, which the contracts test asserts never
-- drift. Additive to the frozen catalog (contracts-v1). Idempotent
-- (ON CONFLICT DO NOTHING).
--
-- HONESTY NOTE (rule 2 / ADR 0057): `ai_tool_used` is a content-free, native-app
-- presence signal from the resident desktop agent — app identity only, from a
-- CLOSED enum (never a window title, command line, or free string). It is NOT an
-- OTel marker (absent from OTEL_MARKER_METRIC_KEYS), so a capability bound to it
-- caps at `directional`, never `measured` (ADR 0039). App presence is native-app-
-- only and browser-blind (ADR 0055 §1.3), so it materially under-counts real AI
-- use — a coarse breadth signal, honestly. The live emitter is D-DA-8-gated (the
-- connection-scoped window-delete), so no producer writes this key today; with no
-- rows the capability engine skips it (no evidence → no row), never zero-filling.
INSERT INTO "metric_catalog" ("key", "family", "name", "description", "unit", "dim_kind") VALUES
('ai_tool_used', 'active_users', 'AI app in use', 'A known AI desktop app was seen running on this UTC day (value 1; dim = tool, a closed AI-app enum e.g. claude-desktop, chatgpt-desktop). Content-free app-presence from the resident desktop agent — app identity only, never window titles, command lines, or prompt/response content. Native-app-only and browser-blind, so it under-counts browser-based AI use. Directional-only (not an OTel marker); absence is never zero-filled.', 'flag', 'tool')
ON CONFLICT ("key") DO NOTHING;
