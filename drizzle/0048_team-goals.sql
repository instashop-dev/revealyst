CREATE TYPE "public"."goal_status" AS ENUM('active', 'met', 'archived');--> statement-breakpoint
CREATE TABLE "team_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"metric_slug" text NOT NULL,
	"baseline" integer,
	"target" integer NOT NULL,
	"review_date" date NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_goals" ADD CONSTRAINT "team_goals_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_goals_active_team_uq" ON "team_goals" USING btree ("org_id","team_id") WHERE "team_goals"."status" = 'active' and "team_goals"."team_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "team_goals_active_org_uq" ON "team_goals" USING btree ("org_id") WHERE "team_goals"."status" = 'active' and "team_goals"."team_id" is null;--> statement-breakpoint
CREATE INDEX "team_goals_org_status_idx" ON "team_goals" USING btree ("org_id","status");