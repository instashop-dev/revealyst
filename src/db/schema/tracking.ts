import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { connections } from "./connections";
import { attributionLevelEnum, people, subjectKindEnum } from "./core";

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

// Level-1 metric catalog — a seeded reference table, deliberately NOT an
// enum (frozen contract): new metrics are expected, and post-freeze catalog
// changes are ADR-gated data migrations. Global reference data (documented
// org-scope exception, like membershipForUser). Rates (acceptance, retry)
// are computed from numerator/denominator keys, never stored; engaged days
// and DAU/WAU/MAU are derived from `active_day` at query time (D12).
export const metricCatalog = pgTable("metric_catalog", {
  key: text("key").primaryKey(),
  family: text("family").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  unit: text("unit", {
    // `credits` added V1.5 (ADR 0022) for GitHub Copilot AI Credits — a
    // vendor-reported usage-billing unit that is NOT dollars. Plain-text
    // column (drizzle text-enum is TS-only), so the new value needs no DDL,
    // only the seed row + this type widening.
    enum: ["count", "tokens", "usd_cents", "lines", "flag", "credits", "seconds"],
  }).notNull(),
  // Which dimension the `dim` column carries for this metric; null = none.
  // `tool` added by ADR 0057 for `ai_tool_used` (the dim carries a closed
  // AI-app enum id); `task_category` added by ADR 0055/0059 for `task_category`
  // (the dim carries a closed work-type enum id). Plain-text column (drizzle
  // text-enum is TS-only), so a new value needs no DDL — only the seed row + this
  // type widening, exactly like the `credits`/`seconds` unit additions above.
  dimKind: text("dim_kind", {
    enum: ["model", "feature", "tool", "task_category"],
  }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Raw landing zone: vendor payloads as fetched, retained ~90 days for
// normalization-bug replay, then aged out by the purge-raw job (bounded
// batches). After aging, recompute is score-only from persisted
// metric_records — the stated trade-off; raw is NOT kept forever.
export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    vendor: text("vendor").notNull(),
    // Endpoint/report identifier, e.g. 'copilot.users-1-day'.
    kind: text("kind").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '90 days'`),
  },
  (t) => [
    foreignKey({
      name: "raw_payloads_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    index("raw_payloads_expires_idx").on(t.expiresAt),
    index("raw_payloads_org_conn_fetched_idx").on(
      t.orgId,
      t.connectionId,
      t.fetchedAt,
    ),
  ],
);

// THE fact table. Natural composite PK = the frozen idempotent upsert key:
// every vendor restates recent days (Copilot ≤3d, Anthropic ≤30d cost,
// OpenAI ~24–48h), so ingestion is always ON CONFLICT DO UPDATE, never
// insert-once. org_id is part of the PK, so a cross-org conflict is a
// different key by construction — the ON CONFLICT update path cannot cross
// tenants (unlike keys that omit org_id, which need explicit guards).
// `dim` = '' for dimensionless metrics, else 'model=…' / 'feature=…'.
export const metricRecords = pgTable(
  "metric_records",
  {
    orgId: uuid("org_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricCatalog.key),
    day: date("day", { mode: "string" }).notNull(), // UTC calendar day
    dim: text("dim").notNull().default(""),
    connectionId: uuid("connection_id").notNull(),
    value: numeric("value", {
      precision: 24,
      scale: 6,
      mode: "number",
    }).notNull(),
    attribution: attributionLevelEnum("attribution").notNull(),
    // Connector module id+version, e.g. 'anthropic-console@1'. Note: since
    // ADR 0013, deleting a connection destroys its metric_records (explicit
    // transactional delete in org-scope connections.delete — the NO ACTION
    // FK below forbids leaving them dangling); sourceConnector identifies
    // the module for rows whose subject belongs to a DIFFERENT connection.
    sourceConnector: text("source_connector").notNull(),
    rawPayloadId: uuid("raw_payload_id").references(() => rawPayloads.id, {
      onDelete: "set null",
    }),
    insertedAt: timestamp("inserted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.orgId, t.subjectId, t.metricKey, t.day, t.dim],
    }),
    foreignKey({
      name: "metric_records_org_subject_fk",
      columns: [t.orgId, t.subjectId],
      foreignColumns: [subjects.orgId, subjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "metric_records_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }),
    index("metric_records_org_metric_day_idx").on(t.orgId, t.metricKey, t.day),
  ],
);

// Sub-daily signals per (subject, day) — the W2-K shared-account input the
// frozen schema must carry from day one. `hours` = activity per UTC hour
// (24 slots); NULL when the vendor cannot provide intra-day data (Copilot:
// source_granularity 'none') — absence, never fabrication.
export const subjectDaySignals = pgTable(
  "subject_day_signals",
  {
    orgId: uuid("org_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    hours: smallint("hours").array(),
    peakConcurrency: smallint("peak_concurrency"),
    sourceGranularity: text("source_granularity", {
      enum: ["event", "1m", "1h", "none"],
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.subjectId, t.day] }),
    foreignKey({
      name: "subject_day_signals_org_subject_fk",
      columns: [t.orgId, t.subjectId],
      foreignColumns: [subjects.orgId, subjects.id],
    }).onDelete("cascade"),
    check(
      "subject_day_signals_hours_24",
      sql`hours IS NULL OR cardinality(hours) = 24`,
    ),
  ],
);
