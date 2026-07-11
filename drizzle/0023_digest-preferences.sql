CREATE TABLE "digest_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"unsubscribe_token_hash" text,
	"last_sent_week" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_preferences_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "digest_preferences_org_user_uq" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "digest_preferences" ADD CONSTRAINT "digest_preferences_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_preferences" ADD CONSTRAINT "digest_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digest_preferences_unsubscribe_token_hash_idx" ON "digest_preferences" USING btree ("unsubscribe_token_hash");