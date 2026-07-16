import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orgs, subscriptionStatusEnum } from "./core";

// Paddle subscription / entitlement state (W3-M, ADR 0009). One row per Paddle
// subscription, org-scoped. Effective plan is DERIVED from `status` (see the
// enum) — there is no plan column to keep in sync with Paddle. Personal/free
// orgs never get a row. `paddle_subscription_id` is globally unique so the
// webhook upsert is idempotent regardless of delivery order. The billed
// `quantity` is the frozen tracked_user count (src/contracts/tracked-user.ts);
// this table stores the last value Paddle confirmed, never redefines it.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    paddleSubscriptionId: text("paddle_subscription_id").notNull().unique(),
    paddleCustomerId: text("paddle_customer_id"),
    status: subscriptionStatusEnum("status").notNull(),
    priceId: text("price_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    // The Paddle event's `occurred_at` — event time, NOT row-write time.
    // Webhook deliveries are not ordered, so the upsert applies an event only
    // when it is newer than the stored one (see applyPaddleSubscriptionEvent),
    // and entitlement resolution orders on this. `updated_at` stays row-write
    // time so a metering quantity write never reorders the entitlement.
    paddleOccurredAt: timestamp("paddle_occurred_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("subscriptions_org_id_id_uq").on(t.orgId, t.id),
    index("subscriptions_org_idx").on(t.orgId),
  ],
);

// Spend Governance (W4-V, ADR 0020). One org monthly spend budget + the
// alert thresholds (percent-of-budget crossings surfaced in-app). One row
// per org — the unique(org_id) constraint makes "set budget" a clean upsert
// and there is never more than one budget to reconcile. NOT a spend ledger:
// observed month-to-date spend is derived at read time from the existing
// spend_cents / spend_cents_estimated metric_records (compute-on-read, no
// background job, no persisted alert state). alert_thresholds are integer
// percents (e.g. [50, 80, 100]); the honesty framing (day-grain vendor data,
// observed-burn crossings) lives in the rendered copy, never in this table.
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Monthly spend ceiling in USD cents, matching metric_records spend_cents.
    monthlyLimitCents: integer("monthly_limit_cents").notNull(),
    // Percent-of-budget crossings that raise an in-app alert, ascending.
    // Mirrors DEFAULT_ALERT_THRESHOLDS (src/lib/spend-governance.ts) — schema is
    // a leaf module and can't import lib code without a circular dependency, so
    // keep the two literals in sync.
    alertThresholds: jsonb("alert_thresholds")
      .$type<number[]>()
      .notNull()
      .default([50, 80, 100]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Anchor for composite tenant FKs, per D1a — kept even without child
    // tables so the shape matches every other org-scoped table.
    unique("budgets_org_id_id_uq").on(t.orgId, t.id),
    // One budget per org: the set() upsert conflict target.
    unique("budgets_org_uq").on(t.orgId),
    check("budgets_monthly_limit_positive", sql`monthly_limit_cents > 0`),
  ],
);

// Budget-alert crossing state (W5-I, ADR 0029) — the compare-and-set that
// stops the threshold-alert EMAIL re-firing on every poll. ONE row per
// (org, month): `highest_alerted_threshold` is the highest percent-of-budget
// threshold already emailed for that calendar month. NOT a spend ledger and
// NOT the budget config (that's `budgets`) — purely delivery de-dup state,
// mirroring digest_preferences.last_sent_week. The sender compare-and-sets
// this BEFORE sending (claim-then-send), so an at-least-once poll redelivery
// that re-crosses the same threshold is a no-op and a threshold emails exactly
// once per (org, month, threshold). `month_key` is "YYYY-MM" (UTC), so a new
// month starts a fresh row and the monthly budget's thresholds re-alert.
// Cascade-deleted with the org (org_id) — like budgets/digest_preferences, it
// carries no data that must outlive the workspace.
export const budgetAlertState = pgTable(
  "budget_alert_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Calendar month the crossings are tracked for, "YYYY-MM" (UTC). Text (not
    // a date) because it is a bucket key, compared only for equality.
    monthKey: text("month_key").notNull(),
    // Highest percent-of-budget threshold already emailed this month. 0 means
    // nothing emailed yet; the CAS only advances it upward (never re-alerts a
    // threshold at or below the stored value within the same month).
    highestAlertedThreshold: integer("highest_alerted_threshold")
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Anchor for composite tenant FKs, per D1a — kept even without child
    // tables so the shape matches every other org-scoped table.
    unique("budget_alert_state_org_id_id_uq").on(t.orgId, t.id),
    // One crossing-state row per (org, month): the CAS upsert conflict target.
    unique("budget_alert_state_org_month_uq").on(t.orgId, t.monthKey),
  ],
);
