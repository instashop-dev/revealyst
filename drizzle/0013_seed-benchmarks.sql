-- Published-benchmark seed rows (W2-I). All rows land as status='draft' —
-- placeholder figures from general industry commentary, NOT yet verified
-- against a founder-confirmed primary source. Panels/docs must treat 'draft'
-- rows as provisional and filter to 'verified' before presenting them as
-- authoritative (see docs/score-definitions.md).
INSERT INTO "benchmarks"
  ("score_slug", "component_key", "segment", "metric_label", "value", "value_unit", "range_low", "range_high", "source_name", "source_url", "notes", "status")
VALUES
(
  'fluency', 'effectiveness', 'overall',
  'Copilot suggestion acceptance rate',
  30, 'percent', NULL, NULL,
  'GitHub Copilot',
  'https://github.blog/',
  'General industry citation (~30% acceptance rate, GitHub blog commentary circa 2023-2024); needs founder-verified primary source before publish.',
  'draft'
),
(
  'adoption', NULL, 'overall',
  'Weekly active AI-tool usage among developers',
  NULL, 'percent', 60, 80,
  'Worklytics / Section AI adoption benchmark',
  NULL,
  'Placeholder range from public AI-adoption survey commentary; needs founder-verified citation before publish.',
  'draft'
),
(
  'adoption', NULL, 'enterprise',
  'Enterprise AI tool adoption rate',
  NULL, 'percent', 55, 75,
  'Worklytics / Section AI adoption benchmark',
  NULL,
  'Placeholder enterprise-segment range from public AI-adoption survey commentary; needs founder-verified citation before publish.',
  'draft'
);
