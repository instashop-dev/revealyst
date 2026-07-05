-- Global score-definition presets, v1 (W0-C frozen shapes; W2-I calibrates
-- against real W1 data by minting NEW versions — v1 rows are immutable).
-- org_id NULL = visible to every org. Components are zod-validated data
-- (src/contracts/scores.ts), NOT a DSL. Idempotent via the
-- NULLS NOT DISTINCT unique (org_id, slug, version).
INSERT INTO "score_definitions" ("org_id", "slug", "version", "name", "subject_level", "components", "status") VALUES
(NULL, 'adoption', 1, 'AI Adoption Score', 'team', '[
  {"key": "active_days", "metric": "active_day", "aggregation": "active_days", "weight": 0.5, "normalization": {"min": 0, "max": 20}},
  {"key": "tool_coverage", "metric": "feature_used", "aggregation": "distinct_dims", "weight": 0.5, "normalization": {"min": 0, "max": 6}}
]'::jsonb, 'active'),
(NULL, 'fluency', 1, 'AI Fluency Score', 'team', '[
  {"key": "breadth", "metric": "feature_used", "aggregation": "distinct_dims", "weight": 0.33, "normalization": {"min": 0, "max": 8}},
  {"key": "depth", "metric": "active_day", "aggregation": "active_days", "weight": 0.33, "normalization": {"min": 0, "max": 20}},
  {"key": "effectiveness", "ratio": {"numerator": {"metric": "suggestions_accepted", "aggregation": "sum"}, "denominator": {"metric": "suggestions_offered", "aggregation": "sum"}}, "weight": 0.34, "normalization": {"min": 0, "max": 0.5}}
]'::jsonb, 'active'),
(NULL, 'efficiency', 1, 'AI Efficiency Score', 'team', '[
  {"key": "output_per_spend", "ratio": {"numerator": {"metric": "suggestions_accepted", "aggregation": "sum"}, "denominator": {"metric": "spend_cents", "aggregation": "sum"}}, "weight": 0.5, "normalization": {"min": 0, "max": 0.2}},
  {"key": "engagement_per_spend", "ratio": {"numerator": {"metric": "active_day", "aggregation": "active_days"}, "denominator": {"metric": "spend_cents", "aggregation": "sum"}}, "weight": 0.5, "normalization": {"min": 0, "max": 0.01}}
]'::jsonb, 'active')
ON CONFLICT ("org_id", "slug", "version") DO NOTHING;
