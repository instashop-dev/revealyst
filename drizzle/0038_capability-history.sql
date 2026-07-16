CREATE TABLE "team_capability_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"capability_slug" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"represented_count" integer NOT NULL,
	"total_count" integer NOT NULL,
	"mastered_count" integer NOT NULL,
	"developing_count" integer NOT NULL,
	"confidence_tier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_capability_history_period_uq" UNIQUE NULLS NOT DISTINCT("org_id","team_id","capability_slug","period_start")
);
--> statement-breakpoint
ALTER TABLE "team_capability_history" ADD CONSTRAINT "team_capability_history_capability_slug_capabilities_slug_fk" FOREIGN KEY ("capability_slug") REFERENCES "public"."capabilities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_capability_history" ADD CONSTRAINT "team_capability_history_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_capability_history_org_capability_period_idx" ON "team_capability_history" USING btree ("org_id","capability_slug","period_start");