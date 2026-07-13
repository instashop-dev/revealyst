CREATE TYPE "public"."rec_interaction_state_kind" AS ENUM('snoozed', 'dismissed', 'tried');--> statement-breakpoint
CREATE TABLE "rec_interaction_state" (
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rec_id" text NOT NULL,
	"state" "rec_interaction_state_kind" NOT NULL,
	"acted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snooze_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rec_interaction_state_org_id_person_id_rec_id_pk" PRIMARY KEY("org_id","person_id","rec_id")
);
--> statement-breakpoint
ALTER TABLE "rec_interaction_state" ADD CONSTRAINT "rec_interaction_state_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rec_interaction_state_org_person_idx" ON "rec_interaction_state" USING btree ("org_id","person_id");