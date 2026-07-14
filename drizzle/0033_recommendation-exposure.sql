CREATE TABLE "recommendation_exposure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rec_id" text NOT NULL,
	"surface" text NOT NULL,
	"shown_at" date NOT NULL,
	"experiment_key" text,
	"variant" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_exposure_dedupe_uq" UNIQUE("org_id","person_id","rec_id","surface","shown_at")
);
--> statement-breakpoint
ALTER TABLE "recommendation_exposure" ADD CONSTRAINT "recommendation_exposure_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendation_exposure_org_person_idx" ON "recommendation_exposure" USING btree ("org_id","person_id");