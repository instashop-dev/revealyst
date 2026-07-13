CREATE TABLE "renewal_reminder_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"renewal_date" date NOT NULL,
	"threshold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_reminder_state_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "renewal_reminder_state_conn_date_threshold_uq" UNIQUE("connection_id","renewal_date","threshold")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "renewal_date" date;--> statement-breakpoint
ALTER TABLE "renewal_reminder_state" ADD CONSTRAINT "renewal_reminder_state_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;