import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { orgs } from "./core";

// Weekly digest delivery preferences (F2.2, ADR 0024). One row per (org, user):
// which admins/owners have opted into the weekly digest email, the stable
// hash of their one-click unsubscribe token (plaintext lives only in the email
// URL — mirrors share_links), and the ISO week last sent so a redelivered
// queue message can compare-and-set instead of double-sending. Cascade-deleted
// with the org (org_id) AND with the user account (user_id). A member who LEAVES
// or is REMOVED (not an account delete, so neither FK fires) keeps no dangling
// preference either — src/db/membership.ts deletes this row in the same
// transaction as the membership (P7), so a re-invite can't resurrect a stale
// subscription. NOT a send log: exactly one row per person per org, upserted;
// delivery history is not retained here.
export const digestPreferences = pgTable(
  "digest_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Whether this person receives the weekly digest. The LANE default for an
    // ABSENT row (personal owner = on, team admin = off) lives in the sender
    // (src/poller/digest.ts), not this column: once a row exists it is the
    // explicit truth. Default true so an opt-in write is a plain insert.
    digestEnabled: boolean("digest_enabled").notNull().default(true),
    // SHA-256 hash of the current one-click unsubscribe token. Rotated on each
    // successful send (the plaintext exists only in that email's link), so a
    // DB leak never yields a usable token. Null only for a freshly-created
    // opt-in row that has not yet been sent to.
    unsubscribeTokenHash: text("unsubscribe_token_hash"),
    // ISO week (e.g. "2026-W28") of the most recent send. The idempotency
    // key: the sender compare-and-sets this before sending, so an
    // at-least-once redelivery for the same week is a no-op.
    lastSentWeek: text("last_sent_week"),
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
    unique("digest_preferences_org_id_id_uq").on(t.orgId, t.id),
    // One preference row per user per org: the opt-in/toggle upsert target.
    unique("digest_preferences_org_user_uq").on(t.orgId, t.userId),
    // Resolve an unsubscribe token to its row (pre-scope capability read).
    index("digest_preferences_unsubscribe_token_hash_idx").on(
      t.unsubscribeTokenHash,
    ),
  ],
);

// Monthly executive-memo send-state + opt-in (W6-F, ADR 0031). One row per org
// (like budgets): the workspace toggle plus the month-keyed idempotency mark the
// monthly sender compare-and-sets before sending each memo.
export const execReportState = pgTable(
  "exec_report_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Workspace-level opt-in for the monthly executive memo. Default true so
    // an opt-OUT write is a plain upsert and an org with no row yet is treated
    // as enabled by the sender's absent-row default.
    execReportEnabled: boolean("exec_report_enabled").notNull().default(true),
    // Calendar month ("YYYY-MM", UTC) of the most recent send. The idempotency
    // key the monthly sender compare-and-sets before sending; null until the
    // first memo goes out. Text (not a date) — a bucket key compared only for
    // equality, mirroring budget_alert_state.month_key.
    lastSentMonth: text("last_sent_month"),
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
    unique("exec_report_state_org_id_id_uq").on(t.orgId, t.id),
    // One send-state/settings row per org: the toggle + CAS upsert conflict
    // target (mirrors budgets_org_uq).
    unique("exec_report_state_org_uq").on(t.orgId),
  ],
);
