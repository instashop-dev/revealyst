CREATE TABLE "recommendation_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"score_slug" text NOT NULL,
	"component_key" text NOT NULL,
	"signal_group" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"applicable_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"applicable_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_signals" jsonb NOT NULL,
	"benefit" text NOT NULL,
	"difficulty" text NOT NULL,
	"confidence" text NOT NULL,
	"learning_resources" text[] DEFAULT '{}'::text[] NOT NULL,
	"related_workflows" text[] DEFAULT '{}'::text[] NOT NULL,
	"insight_kind" text NOT NULL,
	"suggested_action_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_catalog_org_slug_version_uq" UNIQUE NULLS NOT DISTINCT("org_id","slug","version"),
	CONSTRAINT "recommendation_catalog_benefit_ck" CHECK ("recommendation_catalog"."benefit" IN ('high','medium','low')),
	CONSTRAINT "recommendation_catalog_difficulty_ck" CHECK ("recommendation_catalog"."difficulty" IN ('low','medium','high')),
	CONSTRAINT "recommendation_catalog_confidence_ck" CHECK ("recommendation_catalog"."confidence" IN ('high','medium','low')),
	CONSTRAINT "recommendation_catalog_action_type_ck" CHECK ("recommendation_catalog"."suggested_action_type" IN ('link-out','in-product-setting','vendor-deep-link'))
);
--> statement-breakpoint
ALTER TABLE "recommendation_catalog" ADD CONSTRAINT "recommendation_catalog_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Recommendation catalog seed, v1 (W6-C, ADR 0033) — the 7-entry static
-- coaching map (src/lib/coaching-recommendations.ts) migrated to seeded
-- reference data, content copied VERBATIM (title/body/signalGroup + the W5-E
-- metadata). org_id NULL = global preset (visible to every org, like score
-- presets). `slug` is the stable rec id (== the static map `id`, ==
-- rec_interaction_state.rec_id). `required_signals` is structured data over the
-- CLOSED comparator vocabulary (measured · normalized-below 40 · min-weight
-- 0.2) — the exact gating the static evaluator applied inline. Idempotent via
-- the NULLS NOT DISTINCT unique (org_id, slug, version), so replays (dev-db,
-- tests, deploy) are safe. Post-launch changes mint a NEW version row (rows are
-- immutable per version); growing the catalog is a reviewed, fact-checked PR.
INSERT INTO "recommendation_catalog" (
  "org_id", "slug", "version", "score_slug", "component_key", "signal_group",
  "title", "body", "required_signals", "benefit", "difficulty", "confidence",
  "insight_kind", "suggested_action_type"
) VALUES
(NULL, 'adoption-active-days', 1, 'adoption', 'active_days', 'active-days',
 'Make AI part of the daily routine',
 'The active-days part of Adoption is measuring low. Adoption grows when AI tools get reached for on more days, not just more within a single day. A common starting point is routing one recurring task — a standup summary, a first-draft email, a code-review comment — through an AI tool each day.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'high', 'low', 'high', 'adoption', 'in-product-setting'),
(NULL, 'adoption-tool-coverage', 1, 'adoption', 'tool_coverage', 'feature-breadth',
 'Broaden which AI features get used',
 'The tool-coverage part of Adoption is measuring low, which usually means usage leans on one or two features. Trying an additional connected feature — chat, inline completion, or an agent mode — for a task it fits is a common way to widen coverage.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'medium', 'low', 'high', 'adoption', 'in-product-setting'),
(NULL, 'fluency-breadth', 1, 'fluency', 'breadth', 'feature-breadth',
 'Explore more of what the connected tools can do',
 'The breadth part of Fluency is measuring low. Reaching for more distinct features across the connected tools — rather than one narrow use — is what moves it. Picking one unused feature and finding a real task for it is a common approach.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'medium', 'medium', 'high', 'adoption', 'link-out'),
(NULL, 'fluency-depth', 1, 'fluency', 'depth', 'active-days',
 'Use AI on more days, not just more per day',
 'The depth part of Fluency — how many days had any activity — is measuring low. More regular, day-to-day use tends to build steadier habits than occasional bursts, so spreading AI use across more days is a common way to raise it.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'high', 'low', 'high', 'adoption', 'in-product-setting'),
(NULL, 'fluency-effectiveness', 1, 'fluency', 'effectiveness', 'effectiveness',
 'Look at why suggestions are being turned down',
 'The effectiveness part of Fluency — how often AI suggestions get accepted — is measuring low. Reviewing the kinds of tasks where suggestions get rejected, and adjusting how those tasks are framed to the tool, is a common way to raise acceptance.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'high', 'medium', 'medium', 'effectiveness-verification', 'link-out'),
(NULL, 'efficiency-output-per-spend', 1, 'efficiency', 'output_per_spend', 'output-per-spend',
 'Weigh accepted output against what''s being spent',
 'The output-per-spend part of Efficiency is measuring low. That can mean low acceptance or high spend relative to accepted output — comparing the accepted-suggestion counts against the billed spend for each tool is a common place to start.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'medium', 'medium', 'medium', 'spend', 'vendor-deep-link'),
(NULL, 'efficiency-engagement-per-spend', 1, 'efficiency', 'engagement_per_spend', 'engagement-per-spend',
 'Check active engagement against what''s being spent',
 'The engagement-per-spend part of Efficiency is measuring low. Reviewing whether the tools with the most spend are the ones people are actually active in — and rightsizing seats or plans that see little use — is a common way to improve it.',
 '{"comparators":[{"kind":"measured"},{"kind":"normalized-below","value":40},{"kind":"min-weight","value":0.2}]}'::jsonb,
 'high', 'medium', 'high', 'spend', 'vendor-deep-link')
ON CONFLICT ("org_id", "slug", "version") DO NOTHING;
