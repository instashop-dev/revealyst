import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Walking-skeleton schema (W0-B). The full core schema — users, teams,
// connections, identities, metric_records, sub-daily signals — is W0-C's
// deliverable and lands as its own frozen migration set. Locked decision
// already in force here: single database, org_id on every row; Personal
// mode = an org of one.

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per successful no-op poll job — proves Cron Trigger → Queue →
// consumer → Postgres end-to-end (the W0 exit-gate heartbeat).
export const pollHeartbeats = pgTable("poll_heartbeats", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  source: text("source").notNull().default("noop-poller"),
  observedAt: timestamp("observed_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
