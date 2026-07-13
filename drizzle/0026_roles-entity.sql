CREATE TABLE "role_assignments" (
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role_slug" text NOT NULL,
	"assigned_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_org_id_person_id_pk" PRIMARY KEY("org_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_assignments_org_role_idx" ON "role_assignments" USING btree ("org_id","role_slug");--> statement-breakpoint
-- Engineering-role reference seed (W6-B, ADR 0030). Closed launch set; a
-- global reference table like metric_catalog (drizzle/0007). Idempotent:
-- ON CONFLICT DO NOTHING, so replays (dev-db, tests, deploy) are safe.
-- Post-launch role changes are ADR-gated data migrations. W6-C's
-- recommendation-catalog `applicable_roles` FKs these slugs.
INSERT INTO "roles" ("slug", "label", "sort") VALUES
	('backend', 'Backend', 10),
	('frontend', 'Frontend', 20),
	('fullstack', 'Full-stack', 30),
	('mobile', 'Mobile', 40),
	('platform', 'Platform', 50),
	('data', 'Data', 60),
	('ml', 'Machine learning', 70),
	('sre', 'SRE / DevOps', 80)
ON CONFLICT ("slug") DO NOTHING;