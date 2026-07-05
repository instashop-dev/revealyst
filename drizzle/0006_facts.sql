CREATE TYPE "public"."attribution_level" AS ENUM('person', 'key_project', 'account');--> statement-breakpoint
CREATE TABLE "metric_catalog" (
	"key" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"dim_kind" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_records" (
	"org_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"day" date NOT NULL,
	"dim" text DEFAULT '' NOT NULL,
	"connection_id" uuid NOT NULL,
	"value" numeric(24, 6) NOT NULL,
	"attribution" "attribution_level" NOT NULL,
	"source_connector" text NOT NULL,
	"raw_payload_id" uuid,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_records_org_id_subject_id_metric_key_day_dim_pk" PRIMARY KEY("org_id","subject_id","metric_key","day","dim")
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"kind" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject_day_signals" (
	"org_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"day" date NOT NULL,
	"hours" smallint[],
	"peak_concurrency" smallint,
	"source_granularity" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_day_signals_org_id_subject_id_day_pk" PRIMARY KEY("org_id","subject_id","day"),
	CONSTRAINT "subject_day_signals_hours_24" CHECK (hours IS NULL OR cardinality(hours) = 24)
);
--> statement-breakpoint
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_metric_key_metric_catalog_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_catalog"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_org_subject_fk" FOREIGN KEY ("org_id","subject_id") REFERENCES "public"."subjects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_day_signals" ADD CONSTRAINT "subject_day_signals_org_subject_fk" FOREIGN KEY ("org_id","subject_id") REFERENCES "public"."subjects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_records_org_metric_day_idx" ON "metric_records" USING btree ("org_id","metric_key","day");--> statement-breakpoint
CREATE INDEX "raw_payloads_expires_idx" ON "raw_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "raw_payloads_org_conn_fetched_idx" ON "raw_payloads" USING btree ("org_id","connection_id","fetched_at");