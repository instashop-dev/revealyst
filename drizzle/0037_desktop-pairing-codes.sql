CREATE TABLE "desktop_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"pairing_id" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_hash" text NOT NULL,
	"consented_user_id" text NOT NULL,
	"device_display_name" text NOT NULL,
	"platform" text NOT NULL,
	"architecture" text NOT NULL,
	"agent_version" text NOT NULL,
	"installation_id" uuid NOT NULL,
	"connection_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_pairing_codes_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "desktop_pairing_codes_pairing_id_uq" UNIQUE("pairing_id")
);
--> statement-breakpoint
ALTER TABLE "desktop_pairing_codes" ADD CONSTRAINT "desktop_pairing_codes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_pairing_codes" ADD CONSTRAINT "desktop_pairing_codes_consented_user_id_user_id_fk" FOREIGN KEY ("consented_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_pairing_codes" ADD CONSTRAINT "desktop_pairing_codes_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;