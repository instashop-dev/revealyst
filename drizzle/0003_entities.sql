CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"pseudonym" text NOT NULL,
	"display_name" text,
	"email" text,
	"auth_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "people_org_pseudonym_uq" UNIQUE("org_id","pseudonym")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"org_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_person_id_pk" PRIMARY KEY("team_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "teams_org_name_uq" UNIQUE("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "kind" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "bootstrap_user_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "visibility_mode" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_org_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_org_email_uq" ON "people" USING btree ("org_id","email") WHERE "people"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_org_auth_user_uq" ON "people" USING btree ("org_id","auth_user_id") WHERE "people"."auth_user_id" is not null;--> statement-breakpoint
CREATE INDEX "team_members_org_person_idx" ON "team_members" USING btree ("org_id","person_id");--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_bootstrap_user_id_user_id_fk" FOREIGN KEY ("bootstrap_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_bootstrap_user_id_unique" UNIQUE("bootstrap_user_id");--> statement-breakpoint
UPDATE "orgs" SET "kind" = 'system' WHERE "id" = '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
UPDATE "orgs" SET "bootstrap_user_id" = sub."user_id" FROM (SELECT DISTINCT ON ("user_id") "user_id", "org_id" FROM "org_members" ORDER BY "user_id", "created_at") sub WHERE "orgs"."id" = sub."org_id" AND "orgs"."kind" = 'personal';
