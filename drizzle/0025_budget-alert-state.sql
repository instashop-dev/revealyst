CREATE TABLE "budget_alert_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"month_key" text NOT NULL,
	"highest_alerted_threshold" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alert_state_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "budget_alert_state_org_month_uq" UNIQUE("org_id","month_key")
);
--> statement-breakpoint
ALTER TABLE "budget_alert_state" ADD CONSTRAINT "budget_alert_state_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;