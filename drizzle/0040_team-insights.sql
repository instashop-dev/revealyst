CREATE TYPE "public"."team_insight_category" AS ENUM('capability_gap', 'plateau', 'concentration', 'low_adoption', 'data_incomplete', 'positive_growth');--> statement-breakpoint
CREATE TYPE "public"."team_insight_severity" AS ENUM('info', 'opportunity', 'attention');--> statement-breakpoint
CREATE TYPE "public"."team_insight_status" AS ENUM('new', 'viewed', 'dismissed');--> statement-breakpoint
CREATE TABLE "team_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"category" "team_insight_category" NOT NULL,
	"severity" "team_insight_severity" NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"params" jsonb NOT NULL,
	"period_start" date NOT NULL,
	"status" "team_insight_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_insights_natural_uq" UNIQUE NULLS NOT DISTINCT("org_id","team_id","category","subject")
);
--> statement-breakpoint
ALTER TABLE "team_insights" ADD CONSTRAINT "team_insights_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_insights_org_status_idx" ON "team_insights" USING btree ("org_id","status");