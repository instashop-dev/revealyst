CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trialing', 'past_due', 'paused', 'canceled');--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"paddle_subscription_id" text NOT NULL,
	"paddle_customer_id" text,
	"status" "subscription_status" NOT NULL,
	"price_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"paddle_occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_paddle_subscription_id_unique" UNIQUE("paddle_subscription_id"),
	CONSTRAINT "subscriptions_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_org_idx" ON "subscriptions" USING btree ("org_id");