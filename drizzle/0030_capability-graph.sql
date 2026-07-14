CREATE TABLE "capabilities" (
	"slug" text PRIMARY KEY NOT NULL,
	"domain_slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"summary" text NOT NULL,
	"workflow" text,
	"playbook" text,
	"learning_path" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_dependencies" (
	"capability_slug" text NOT NULL,
	"requires_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_dependencies_capability_slug_requires_slug_pk" PRIMARY KEY("capability_slug","requires_slug"),
	CONSTRAINT "capability_dependencies_no_self_edge_ck" CHECK ("capability_dependencies"."capability_slug" <> "capability_dependencies"."requires_slug")
);
--> statement-breakpoint
CREATE TABLE "capability_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_slug" text NOT NULL,
	"metric_key" text,
	"component_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_signals_binding_uq" UNIQUE NULLS NOT DISTINCT("capability_slug","metric_key","component_key"),
	CONSTRAINT "capability_signals_one_binding_ck" CHECK (("capability_signals"."metric_key" IS NOT NULL) <> ("capability_signals"."component_key" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendation_catalog" ADD COLUMN "target_capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_domain_slug_domains_slug_fk" FOREIGN KEY ("domain_slug") REFERENCES "public"."domains"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_dependencies" ADD CONSTRAINT "capability_dependencies_capability_slug_capabilities_slug_fk" FOREIGN KEY ("capability_slug") REFERENCES "public"."capabilities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_dependencies" ADD CONSTRAINT "capability_dependencies_requires_slug_capabilities_slug_fk" FOREIGN KEY ("requires_slug") REFERENCES "public"."capabilities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_signals" ADD CONSTRAINT "capability_signals_capability_slug_capabilities_slug_fk" FOREIGN KEY ("capability_slug") REFERENCES "public"."capabilities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_signals" ADD CONSTRAINT "capability_signals_metric_key_metric_catalog_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_catalog"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ─── W7-1 capability-graph seed (ADR 0035) ───
-- Global reference data, seeded in-migration like roles (0026) and the
-- recommendation catalog (0029); ON CONFLICT DO NOTHING so replays (dev-db,
-- tests, deploy) are safe. The v0 Engineering set: every capability_signals
-- binding points at a LIVE metric_catalog key OR a SCORE_GLOSSARY component
-- (asserted by tests/capability-catalog.test.ts), and the dependency edges
-- form a shallow acyclic DAG rooted at ai-coding-foundations.
INSERT INTO "domains" ("slug", "label", "sort") VALUES
  ('engineering', 'Engineering', 10)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "capabilities" ("slug", "domain_slug", "version", "label", "summary", "sort") VALUES
  ('ai-coding-foundations', 'engineering', 1, 'Make AI part of daily work', 'Reach for an AI tool as a normal part of your day, not just once in a while.', 10),
  ('feature-breadth', 'engineering', 1, 'Use a range of AI features', 'Get comfortable with more of what your AI tools can do, instead of leaning on one feature.', 20),
  ('consistent-daily-use', 'engineering', 1, 'Build a steady daily habit', 'Use AI across more of your working days, so it becomes a reliable habit rather than an occasional burst.', 30),
  ('effective-prompting', 'engineering', 1, 'Get more suggestions accepted', 'Frame requests so the AI''s suggestions land more often and need less rework.', 40),
  ('agentic-delivery', 'engineering', 1, 'Let AI agents do more of the work', 'Hand larger, multi-step tasks to AI agents and let them carry more of the work.', 50),
  ('cost-efficient-usage', 'engineering', 1, 'Get good value for AI spend', 'Keep the value you get from AI high relative to what it costs.', 60),
  ('ship-with-ai', 'engineering', 1, 'Ship real work with AI', 'Turn AI help into shipped changes — commits and pull requests, not just chat.', 70),
  ('code-review-with-ai', 'engineering', 1, 'Use AI in code review', 'Bring AI into reviewing changes, so feedback is faster and more thorough.', 80),
  ('model-selection', 'engineering', 1, 'Pick the right model for the job', 'Choose the model that fits each task, balancing quality against cost.', 90)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "capability_signals" ("capability_slug", "metric_key", "component_key") VALUES
  ('ai-coding-foundations', NULL, 'active_days'),
  ('ai-coding-foundations', 'active_day', NULL),
  ('feature-breadth', NULL, 'tool_coverage'),
  ('feature-breadth', NULL, 'breadth'),
  ('feature-breadth', 'feature_used', NULL),
  ('consistent-daily-use', NULL, 'depth'),
  ('consistent-daily-use', 'sessions', NULL),
  ('effective-prompting', NULL, 'effectiveness'),
  ('effective-prompting', 'suggestions_accepted', NULL),
  ('effective-prompting', 'suggestions_offered', NULL),
  ('agentic-delivery', 'agent_sessions', NULL),
  ('agentic-delivery', 'agent_requests', NULL),
  ('agentic-delivery', 'agent_active', NULL),
  ('cost-efficient-usage', NULL, 'output_per_spend'),
  ('cost-efficient-usage', NULL, 'engagement_per_spend'),
  ('cost-efficient-usage', 'spend_cents', NULL),
  ('ship-with-ai', 'commits', NULL),
  ('ship-with-ai', 'pull_requests', NULL),
  ('ship-with-ai', 'lines_added', NULL),
  ('code-review-with-ai', 'pull_requests', NULL),
  ('code-review-with-ai', 'feature_used', NULL),
  ('model-selection', 'model_requests', NULL),
  ('model-selection', 'model_tokens', NULL)
ON CONFLICT ON CONSTRAINT "capability_signals_binding_uq" DO NOTHING;--> statement-breakpoint
INSERT INTO "capability_dependencies" ("capability_slug", "requires_slug") VALUES
  ('feature-breadth', 'ai-coding-foundations'),
  ('consistent-daily-use', 'ai-coding-foundations'),
  ('effective-prompting', 'feature-breadth'),
  ('agentic-delivery', 'feature-breadth'),
  ('cost-efficient-usage', 'consistent-daily-use'),
  ('ship-with-ai', 'effective-prompting'),
  ('code-review-with-ai', 'ship-with-ai'),
  ('model-selection', 'cost-efficient-usage')
ON CONFLICT ("capability_slug", "requires_slug") DO NOTHING;--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{ai-coding-foundations}' WHERE "org_id" IS NULL AND "slug" = 'adoption-active-days';--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{feature-breadth}' WHERE "org_id" IS NULL AND "slug" = 'adoption-tool-coverage';--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{feature-breadth}' WHERE "org_id" IS NULL AND "slug" = 'fluency-breadth';--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{consistent-daily-use}' WHERE "org_id" IS NULL AND "slug" = 'fluency-depth';--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{effective-prompting}' WHERE "org_id" IS NULL AND "slug" = 'fluency-effectiveness';--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{cost-efficient-usage}' WHERE "org_id" IS NULL AND "slug" = 'efficiency-output-per-spend';--> statement-breakpoint
UPDATE "recommendation_catalog" SET "target_capabilities" = '{cost-efficient-usage}' WHERE "org_id" IS NULL AND "slug" = 'efficiency-engagement-per-spend';
