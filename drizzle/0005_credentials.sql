CREATE TABLE "connection_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ciphertext_b64" text NOT NULL,
	"iv_b64" text NOT NULL,
	"wrapped_dek_b64" text NOT NULL,
	"dek_iv_b64" text NOT NULL,
	"kek_version" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "connection_credentials_conn_kind_uq" UNIQUE("connection_id","kind")
);
--> statement-breakpoint
ALTER TABLE "connection_credentials" ADD CONSTRAINT "connection_credentials_org_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;