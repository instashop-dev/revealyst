CREATE TYPE "public"."subject_kind" AS ENUM('person', 'api_key', 'service_account', 'workspace', 'project', 'account');--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auth_kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"org_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"method" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identities_subject_id_person_id_pk" PRIMARY KEY("subject_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "subject_kind" NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "subjects_conn_kind_external_uq" UNIQUE("connection_id","kind","external_id")
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_org_subject_fk" FOREIGN KEY ("org_id","subject_id") REFERENCES "public"."subjects"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_org_vendor_idx" ON "connections" USING btree ("org_id","vendor");--> statement-breakpoint
CREATE INDEX "identities_org_person_idx" ON "identities" USING btree ("org_id","person_id");--> statement-breakpoint
CREATE INDEX "subjects_org_email_idx" ON "subjects" USING btree ("org_id","email");