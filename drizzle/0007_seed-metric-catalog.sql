-- Level-1 metric catalog seed (W0-C frozen contract item 7 / gate item 3).
-- Canonical V1 keys; post-freeze changes are ADR-gated data migrations.
-- Idempotent: ON CONFLICT DO NOTHING, so replays (dev-db, tests, deploy)
-- are safe. Rates are computed from numerator/denominator keys and never
-- stored; engaged days and DAU/WAU/MAU derive from active_day (D12).
INSERT INTO "metric_catalog" ("key", "family", "name", "description", "unit", "dim_kind") VALUES
('active_day', 'active_users', 'Active day', 'Subject had any activity on this UTC day (value 1). Engaged days and DAU/WAU/MAU are query-time aggregations over this flag — never stored as separate facts.', 'flag', NULL),
('sessions', 'sessions', 'Sessions', 'Distinct sessions per day. Gap on GitHub Copilot IDE (CLI only) and OpenAI (no session concept); synthesized from event timestamps on Cursor.', 'count', NULL),
('prompts', 'prompts', 'Prompts / messages', 'User-initiated prompts or messages per day (interaction counts; API request counts where that is all the vendor exposes).', 'count', NULL),
('tokens_input', 'tokens', 'Input tokens', 'Uncached input tokens per day.', 'tokens', NULL),
('tokens_output', 'tokens', 'Output tokens', 'Output tokens per day.', 'tokens', NULL),
('tokens_cache_read', 'tokens', 'Cache-read tokens', 'Cache-read input tokens per day.', 'tokens', NULL),
('tokens_cache_write', 'tokens', 'Cache-write tokens', 'Cache-creation input tokens per day.', 'tokens', NULL),
('spend_cents', 'spend', 'Spend', 'Vendor-authoritative cost in USD cents (cost reports / billing APIs). Never mixed with estimates — see spend_cents_estimated.', 'usd_cents', NULL),
('spend_cents_estimated', 'spend', 'Estimated spend', 'Derived spend in USD cents (tokens x price list, or vendor per-user estimates). Labeled estimated by key; UI must not present it as billing truth.', 'usd_cents', NULL),
('model_requests', 'model_mix', 'Requests by model', 'Requests per day per model (dim = model).', 'count', 'model'),
('model_tokens', 'model_mix', 'Tokens by model', 'Total tokens per day per model (dim = model).', 'tokens', 'model'),
('suggestions_offered', 'acceptance', 'Suggestions offered', 'Completion-funnel denominator: suggestions / generations shown per day.', 'count', NULL),
('suggestions_accepted', 'acceptance', 'Suggestions accepted', 'Completion-funnel numerator: suggestions accepted per day. Acceptance rate is computed, never stored.', 'count', NULL),
('edit_actions_accepted', 'acceptance', 'Edit actions accepted', 'Agent/edit tool actions accepted per day (Claude tool_actions, Cursor tab funnel).', 'count', NULL),
('edit_actions_rejected', 'acceptance', 'Edit actions rejected', 'Agent/edit tool actions rejected per day.', 'count', NULL),
('retries', 'acceptance', 'Retries', 'Retried requests per day. Documented gap on most vendors — rows are simply absent (never fabricated).', 'count', NULL),
('feature_used', 'feature_usage', 'Feature used', 'Feature engaged on this day (value 1; dim = feature, e.g. chat_panel, mcp, subagents).', 'flag', 'feature'),
('commits', 'output_shipped', 'Commits', 'Commits attributed to AI tooling per day (vendor-reported, e.g. commits_by_claude_code).', 'count', NULL),
('pull_requests', 'output_shipped', 'Pull requests', 'Pull requests attributed to AI tooling per day (vendor-reported).', 'count', NULL),
('lines_added', 'output_shipped', 'Lines added', 'Lines of code added per day (vendor-reported).', 'lines', NULL),
('lines_removed', 'output_shipped', 'Lines removed', 'Lines of code removed per day (vendor-reported).', 'lines', NULL),
('lines_suggested', 'output_shipped', 'Lines suggested', 'Lines of code suggested per day (completion funnel; LoC acceptance ratio is computed, never stored).', 'lines', NULL)
ON CONFLICT ("key") DO NOTHING;
