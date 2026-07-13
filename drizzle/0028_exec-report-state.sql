CREATE TABLE "exec_report_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"exec_report_enabled" boolean DEFAULT true NOT NULL,
	"last_sent_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exec_report_state_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "exec_report_state_org_uq" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "exec_report_state" ADD CONSTRAINT "exec_report_state_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;