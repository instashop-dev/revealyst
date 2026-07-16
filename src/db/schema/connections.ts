import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orgs } from "./core";

// A configured vendor integration. Multiple connections per vendor per org
// are allowed (several GitHub orgs, several Revealyst Agent devices).
// `config` holds NON-secret settings only — credentials live exclusively in
// connection_credentials (encrypted; lands in the next migration).
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    // VendorId union (frozen in src/contracts): github_copilot | cursor |
    // anthropic_console | anthropic_claude_enterprise | openai |
    // claude_code_local. Text, not a pg enum — new vendors are expected.
    vendor: text("vendor").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", {
      enum: ["pending", "active", "paused", "error"],
    })
      .notNull()
      .default("pending"),
    authKind: text("auth_kind", {
      enum: [
        "api_key",
        "admin_key",
        "analytics_key",
        "github_app",
        "pat",
        "device_token",
      ],
    }).notNull(),
    config: jsonb("config").notNull().default({}),
    // USER-ENTERED renewal date (W6-G, ADR 0032), "YYYY-MM-DD" or null. NO
    // vendor reports renewal dates — this is a manual annotation an admin
    // enters, never inferred (invariant b). Drives the T-30/T-7 reminder cron
    // (src/poller/renewal-reminder.ts); editing it starts a fresh reminder
    // cycle because renewal_reminder_state keys its de-dup CAS on this date.
    renewalDate: date("renewal_date"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Anchor for composite tenant FKs from child tables (D1a).
    unique("connections_org_id_id_uq").on(t.orgId, t.id),
    index("connections_org_vendor_idx").on(t.orgId, t.vendor),
  ],
);

// Encrypted vendor credentials — the highest-value secrets in the system
// (W0-C frozen column shape). All key material is envelope-encrypted via
// src/lib/credentials.ts: AES-256-GCM ciphertext under a per-row DEK,
// DEK wrapped by the versioned Worker-secret KEK, AAD-bound to
// (org, connection, kind). NO plaintext credential column exists anywhere
// in this schema — a test asserts it.
export const connectionCredentials = pgTable(
  "connection_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    kind: text("kind", {
      enum: [
        "api_key",
        "github_app_private_key",
        "github_app_installation",
        "pat",
        "device_token",
      ],
    }).notNull(),
    ciphertextB64: text("ciphertext_b64").notNull(),
    ivB64: text("iv_b64").notNull(),
    wrappedDekB64: text("wrapped_dek_b64").notNull(),
    dekIvB64: text("dek_iv_b64").notNull(),
    kekVersion: text("kek_version").notNull(),
    // OpenAI admin keys can carry an expiry.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "connection_credentials_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    unique("connection_credentials_conn_kind_uq").on(t.connectionId, t.kind),
  ],
);

// Renewal-reminder send-state (W6-G, ADR 0032). One row per (connection,
// renewal_date, threshold) — the reminder cron INSERTs a row before emailing so
// each T-30/T-7 reminder fires EXACTLY once even under at-least-once queue
// redelivery (claim-then-send). The renewal_date is part of the key on purpose:
// editing a connection's user-entered renewal date changes the key, so the new
// date re-arms both thresholds (a genuinely new renewal cycle) while the old
// date's already-sent rows are inert. Cascade-deleted with its connection via
// the composite tenant FK — deleting a connection (or purging an org, which
// deletes connections) removes its reminder history; it carries no data that
// must outlive the connection.
export const renewalReminderState = pgTable(
  "renewal_reminder_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    // The user-entered renewal date this reminder was fired for ("YYYY-MM-DD").
    renewalDate: date("renewal_date").notNull(),
    // Days-before-renewal threshold this row claims: 30 (T-30) or 7 (T-7).
    threshold: integer("threshold").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite tenant FK: a reminder row can only reference a connection in
    // the SAME org (cross-org writes are unrepresentable). Cascade so deleting
    // the connection removes its reminder state.
    foreignKey({
      name: "renewal_reminder_state_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    // Anchor for composite tenant FKs, per D1a — kept even without child tables
    // so the shape matches every other org-scoped table.
    unique("renewal_reminder_state_org_id_id_uq").on(t.orgId, t.id),
    // The CAS conflict target: one reminder per (connection, date, threshold).
    unique("renewal_reminder_state_conn_date_threshold_uq").on(
      t.connectionId,
      t.renewalDate,
      t.threshold,
    ),
  ],
);
