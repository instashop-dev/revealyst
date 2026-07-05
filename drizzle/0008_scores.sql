CREATE TYPE "public"."score_subject_level" AS ENUM('person', 'team', 'org');--> statement-breakpoint
CREATE TABLE "score_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"subject_level" "score_subject_level" NOT NULL,
	"components" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_definitions_org_slug_version_uq" UNIQUE NULLS NOT DISTINCT("org_id","slug","version")
);
--> statement-breakpoint
CREATE TABLE "score_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"subject_level" "score_subject_level" NOT NULL,
	"person_id" uuid,
	"team_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"period_grain" text NOT NULL,
	"value" numeric(10, 4) NOT NULL,
	"attribution" "attribution_level" NOT NULL,
	"components" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_results_upsert_uq" UNIQUE NULLS NOT DISTINCT("org_id","definition_id","subject_level","person_id","team_id","period_start","period_end"),
	CONSTRAINT "score_results_subject_shape" CHECK ((subject_level = 'person' AND person_id IS NOT NULL AND team_id IS NULL) OR (subject_level = 'team' AND team_id IS NOT NULL AND person_id IS NULL) OR (subject_level = 'org' AND person_id IS NULL AND team_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "score_definitions" ADD CONSTRAINT "score_definitions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_definition_id_score_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."score_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;