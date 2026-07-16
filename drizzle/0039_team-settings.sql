CREATE TABLE "team_settings" (
	"org_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"managers_see_individual_cost" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_settings_org_id_team_id_pk" PRIMARY KEY("org_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;