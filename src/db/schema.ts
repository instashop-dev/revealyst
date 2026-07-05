import { isNotNull, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Closed, frozen enum (attribution ladder rungs a vendor-visible actor can
// occupy). Growing this set post-freeze requires an ADR.
export const subjectKindEnum = pgEnum("subject_kind", [
  "person",
  "api_key",
  "service_account",
  "workspace",
  "project",
  "account",
]);

// W0-C core schema. Every application table carries org_id; child tables
// reference their parent via composite (org_id, parent_id) FKs so a
// cross-org reference is unrepresentable at the DB level, not merely
// filtered by the repository layer (tenant-isolation decision D1a,
// docs/decisions/0001). Personal mode = an org of one.

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["personal", "team", "system"] })
    .notNull()
    .default("personal"),
  // At most one bootstrap org per auth user — the unique constraint is what
  // closes the ensureOrgOfOne signup race (concurrent first requests
  // serialize on it instead of creating two orgs).
  bootstrapUserId: text("bootstrap_user_id")
    .unique()
    .references(() => user.id, { onDelete: "set null" }),
  // §7 privacy: team-only pseudonymous default; real names are opt-in.
  visibilityMode: text("visibility_mode", {
    enum: ["private", "managed", "full"],
  })
    .notNull()
    .default("private"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Tracked persons observed via connectors — a different population from
// Better Auth `user` (dashboard logins): most tracked people never log in,
// and they are pseudonymous by default (§7). No prompt-content columns,
// ever (tripwire).
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    pseudonym: text("pseudonym").notNull(),
    // Opt-in real name; stays null unless the org's visibility mode allows it.
    displayName: text("display_name"),
    // Lowercased; the identity-resolution matching key (W2-K).
    email: text("email"),
    // Set when a tracked person is also a dashboard login.
    authUserId: text("auth_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
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
    unique("people_org_id_id_uq").on(t.orgId, t.id),
    unique("people_org_pseudonym_uq").on(t.orgId, t.pseudonym),
    uniqueIndex("people_org_email_uq")
      .on(t.orgId, t.email)
      .where(isNotNull(t.email)),
    uniqueIndex("people_org_auth_user_uq")
      .on(t.orgId, t.authUserId)
      .where(isNotNull(t.authUserId)),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("teams_org_id_id_uq").on(t.orgId, t.id),
    unique("teams_org_name_uq").on(t.orgId, t.name),
  ],
);

// Team membership is between tracked PEOPLE and teams, not auth users. The
// shared org_id column feeds both composite FKs, so a row linking a team
// and a person from different orgs cannot exist.
export const teamMembers = pgTable(
  "team_members",
  {
    orgId: uuid("org_id").notNull(),
    teamId: uuid("team_id").notNull(),
    personId: uuid("person_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.personId] }),
    foreignKey({
      name: "team_members_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_members_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("team_members_org_person_idx").on(t.orgId, t.personId),
  ],
);

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

// Vendor-visible actors (attribution-ladder rungs): the thing a
// metric_record is about. One row per (connection, kind, external_id) —
// that triple is the discover() upsert key. `external_id` is whatever the
// vendor exposes (Copilot user_id, Cursor userId, Anthropic Console
// email/api_key_name — documented: no stable UUID there, OpenAI key-owner
// user_id). `meta` carries vendor extras (login, workspace name) — never
// content.
export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    kind: subjectKindEnum("kind").notNull(),
    externalId: text("external_id").notNull(),
    // Lowercased when the vendor exposes it — W2-K identity matching.
    email: text("email"),
    displayName: text("display_name"),
    meta: jsonb("meta").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("subjects_org_id_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "subjects_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    unique("subjects_conn_kind_external_uq").on(
      t.connectionId,
      t.kind,
      t.externalId,
    ),
    index("subjects_org_email_idx").on(t.orgId, t.email),
  ],
);

// Subject ↔ person resolution, many-to-many by design: a shared account is
// ONE subject with N identity rows (§6.2 — the flag is derived metadata,
// never a data correction), and one person can own subjects across several
// connections. Composite tenant FKs on both sides make a cross-org link
// unrepresentable.
export const identities = pgTable(
  "identities",
  {
    orgId: uuid("org_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    personId: uuid("person_id").notNull(),
    method: text("method", {
      enum: ["email_match", "manual", "vendor_asserted"],
    }).notNull(),
    // Audit: which dashboard user made a manual mapping.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.subjectId, t.personId] }),
    foreignKey({
      name: "identities_org_subject_fk",
      columns: [t.orgId, t.subjectId],
      foreignColumns: [subjects.orgId, subjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "identities_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("identities_org_person_idx").on(t.orgId, t.personId),
  ],
);

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

// Auth tables last: auth-schema imports orgs from this module, so the
// re-export must come after orgs is initialized (circular-import order).
export * from "./auth-schema";
