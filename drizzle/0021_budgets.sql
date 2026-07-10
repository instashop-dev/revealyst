CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"monthly_limit_cents" integer NOT NULL,
	"alert_thresholds" jsonb DEFAULT '[50,80,100]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "budgets_org_uq" UNIQUE("org_id"),
	CONSTRAINT "budgets_monthly_limit_positive" CHECK (monthly_limit_cents > 0)
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;