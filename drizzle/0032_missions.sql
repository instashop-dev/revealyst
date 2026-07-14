CREATE TABLE "mission_progress" (
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"mission_slug" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_progress_org_id_person_id_mission_slug_pk" PRIMARY KEY("org_id","person_id","mission_slug")
);
--> statement-breakpoint
CREATE TABLE "mission_steps" (
	"mission_slug" text NOT NULL,
	"step_order" integer NOT NULL,
	"capability_slug" text NOT NULL,
	"target_mastery" numeric(6, 4) NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_steps_mission_slug_step_order_pk" PRIMARY KEY("mission_slug","step_order")
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_mission_slug_missions_slug_fk" FOREIGN KEY ("mission_slug") REFERENCES "public"."missions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_steps" ADD CONSTRAINT "mission_steps_mission_slug_missions_slug_fk" FOREIGN KEY ("mission_slug") REFERENCES "public"."missions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_steps" ADD CONSTRAINT "mission_steps_capability_slug_capabilities_slug_fk" FOREIGN KEY ("capability_slug") REFERENCES "public"."capabilities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_progress_org_person_idx" ON "mission_progress" USING btree ("org_id","person_id");--> statement-breakpoint
-- ─── W7-5 missions seed (ADR 0037) ───
-- Global reference data, seeded in-migration like capabilities (0030). ON
-- CONFLICT DO NOTHING so replays are safe. Each step binds to a LIVE capability
-- (0030) and a stepping-stone target BELOW the mastered threshold (0.6), so a
-- mission step is an achievable milestone, not a demand for full mastery.
INSERT INTO "missions" ("slug", "title", "summary", "sort") VALUES
  ('get-started-with-ai', 'Get started with AI', 'Make an AI tool a normal part of your working day.', 10),
  ('delegate-to-an-agent', 'Delegate to an AI agent', 'Hand a real, multi-step task to an AI agent and let it do the work.', 20),
  ('ship-work-with-ai', 'Ship real work with AI', 'Turn AI help into a change you actually ship.', 30)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "mission_steps" ("mission_slug", "step_order", "capability_slug", "target_mastery", "label") VALUES
  ('get-started-with-ai', 1, 'ai-coding-foundations', 0.5, 'Reach for an AI tool on more of your working days'),
  ('delegate-to-an-agent', 1, 'agentic-delivery', 0.4, 'Hand a multi-step task to an AI agent'),
  ('ship-work-with-ai', 1, 'effective-prompting', 0.5, 'Get your AI suggestions accepted more often'),
  ('ship-work-with-ai', 2, 'ship-with-ai', 0.4, 'Turn that AI help into a shipped change')
ON CONFLICT ("mission_slug", "step_order") DO NOTHING;
