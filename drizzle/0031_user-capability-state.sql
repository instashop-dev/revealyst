CREATE TABLE "user_capability_state" (
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"capability_slug" text NOT NULL,
	"mastery" numeric(6, 4) NOT NULL,
	"confidence" numeric(6, 4) NOT NULL,
	"confidence_tier" text NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"last_evidence_at" date,
	"staleness" integer DEFAULT 0 NOT NULL,
	"next_capability" text,
	"components" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_capability_state_org_id_person_id_capability_slug_pk" PRIMARY KEY("org_id","person_id","capability_slug")
);
--> statement-breakpoint
ALTER TABLE "user_capability_state" ADD CONSTRAINT "user_capability_state_capability_slug_capabilities_slug_fk" FOREIGN KEY ("capability_slug") REFERENCES "public"."capabilities"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_capability_state" ADD CONSTRAINT "user_capability_state_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_capability_state_org_person_idx" ON "user_capability_state" USING btree ("org_id","person_id");--> statement-breakpoint
CREATE INDEX "user_capability_state_org_capability_idx" ON "user_capability_state" USING btree ("org_id","capability_slug");