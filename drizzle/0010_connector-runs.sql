CREATE TABLE "connector_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"window_start" date,
	"window_end" date,
	"attempt" integer DEFAULT 1 NOT NULL,
	"subjects_seen" integer,
	"records_upserted" integer,
	"signals_upserted" integer,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "connector_runs_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_runs_org_conn_started_idx" ON "connector_runs" USING btree ("org_id","connection_id","started_at");