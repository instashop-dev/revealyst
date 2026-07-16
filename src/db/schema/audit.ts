import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { orgs } from "./core";

// Append-only accountability trail for user-initiated mutations (ADR 0010,
// W3-O). Machine actions (poller, agent ingest) are NOT logged here — they
// have connector_runs. target_kind/target_id are loose text references BY
// DESIGN: an audit row must outlive its target, so no FK to the target and
// nothing cascades from it. metadata carries small non-sensitive detail
// only — ids and short labels, never credentials, tokens, or payloads.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Null = the actor's account was since deleted; the row stays.
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Dot-namespaced verb, e.g. "identity.unlink", "connection.create".
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Anchor for composite tenant FKs, per D1a — kept even without child
    // tables so the shape matches every other org-scoped table.
    unique("audit_log_org_id_id_uq").on(t.orgId, t.id),
    // The read path: newest-first per org.
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt),
  ],
);
