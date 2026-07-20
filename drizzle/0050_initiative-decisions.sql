CREATE TYPE "public"."initiative_decision_event" AS ENUM('launched', 'noted', 'completed', 'stopped');--> statement-breakpoint
CREATE TABLE "initiative_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"initiative_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"event" "initiative_decision_event" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "initiative_decisions" ADD CONSTRAINT "initiative_decisions_org_initiative_fk" FOREIGN KEY ("org_id","initiative_id") REFERENCES "public"."initiatives"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_decisions_org_initiative_idx" ON "initiative_decisions" USING btree ("org_id","initiative_id");