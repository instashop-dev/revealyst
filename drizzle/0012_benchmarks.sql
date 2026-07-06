CREATE TABLE "benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score_slug" text NOT NULL,
	"component_key" text,
	"segment" text DEFAULT 'overall' NOT NULL,
	"metric_label" text NOT NULL,
	"value" numeric(10, 4),
	"value_unit" text DEFAULT 'normalized_0_100' NOT NULL,
	"range_low" numeric(10, 4),
	"range_high" numeric(10, 4),
	"source_name" text NOT NULL,
	"source_url" text,
	"published_date" date,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "benchmarks_slug_component_segment_idx" ON "benchmarks" USING btree ("score_slug","component_key","segment");