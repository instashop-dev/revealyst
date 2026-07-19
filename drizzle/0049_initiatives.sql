CREATE TYPE "public"."initiative_outcome" AS ENUM('improved', 'unchanged', 'worsened', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."initiative_status" AS ENUM('draft', 'active', 'in_review', 'completed', 'stopped');--> statement-breakpoint
CREATE TABLE "initiative_participants" (
	"org_id" uuid NOT NULL,
	"initiative_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_participants_initiative_id_person_id_pk" PRIMARY KEY("initiative_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"template_slug" text,
	"capability_slug" text,
	"score_slug" text,
	"baseline" integer,
	"target" integer NOT NULL,
	"review_date" date NOT NULL,
	"status" "initiative_status" DEFAULT 'active' NOT NULL,
	"outcome" "initiative_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiatives_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "initiative_participants" ADD CONSTRAINT "initiative_participants_org_initiative_fk" FOREIGN KEY ("org_id","initiative_id") REFERENCES "public"."initiatives"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_participants" ADD CONSTRAINT "initiative_participants_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_participants_org_person_idx" ON "initiative_participants" USING btree ("org_id","person_id");--> statement-breakpoint
CREATE INDEX "initiatives_org_status_idx" ON "initiatives" USING btree ("org_id","status");