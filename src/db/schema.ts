import { isNotNull, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
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

// The attribution ladder (§6.1), frozen: person > key_project > account.
// Every metric row carries one; scores inherit the LOWEST of their inputs.
// Never fabricate per-user numbers from account-level data.
export const attributionLevelEnum = pgEnum("attribution_level", [
  "person",
  "key_project",
  "account",
]);

// Subject level a score is computed at (frozen).
export const scoreSubjectLevelEnum = pgEnum("score_subject_level", [
  "person",
  "team",
  "org",
]);

// Paddle subscription status (W3-M, ADR 0009). Mirrors Paddle's subscription
// statuses. Effective entitlement is DERIVED, not stored: active/trialing/
// past_due grant the Team plan; paused/canceled (and no row) are Personal/free.
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "paused",
  "canceled",
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

// A pending/settled invitation of an AUTH USER into an org (ADR 0004) —
// distinct from team_members, which groups tracked PEOPLE. The token is
// stored hashed; its plaintext leaves the server exactly once, at creation.
// Redemption = an org_members row with this row's role.
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // lowercased addressing hint, not an acceptance precondition
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One live invite per (org, email); settled invites don't block re-inviting.
    uniqueIndex("invites_org_email_pending_uq")
      .on(t.orgId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index("invites_org_idx").on(t.orgId),
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
    enum: ["count", "tokens", "usd_cents", "lines", "flag"],
  }).notNull(),
  // Which dimension the `dim` column carries for this metric; null = none.
  dimKind: text("dim_kind", { enum: ["model", "feature"] }),
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
    // Connector module id+version, e.g. 'anthropic-console@1' — survives
    // connection deletion (unlike connection_id).
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

// Versioned score definitions — scores are DATA rows, not code, and NOT a
// DSL (tripwire): `components` is a zod-validated array of closed
// aggregation shapes (src/contracts/scores.ts). org_id NULL = global
// preset (documented reference-data exception; visible to every org
// alongside its own rows). Definitions are immutable per version — a
// change is a new version row, so historical score_results stay
// reproducible.
export const scoreDefinitions = pgTable(
  "score_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => orgs.id),
    slug: text("slug").notNull(), // 'adoption' | 'fluency' | 'efficiency' (+ org customs in V1.5)
    version: integer("version").notNull(),
    name: text("name").notNull(),
    subjectLevel: scoreSubjectLevelEnum("subject_level").notNull(),
    components: jsonb("components").notNull(),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT so two global presets (org_id NULL) cannot share
    // a (slug, version) — requires PG15+, satisfied by Neon and PGlite.
    unique("score_definitions_org_slug_version_uq")
      .on(t.orgId, t.slug, t.version)
      .nullsNotDistinct(),
  ],
);

// Computed score values (engine lands in W1-F; the SHAPE freezes here).
// `attribution` carries the LOWEST attribution level of all inputs —
// frozen propagation semantics. Exactly one subject reference per level
// (CHECK below); org-level rows carry neither.
export const scoreResults = pgTable(
  "score_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => scoreDefinitions.id),
    subjectLevel: scoreSubjectLevelEnum("subject_level").notNull(),
    personId: uuid("person_id"),
    teamId: uuid("team_id"),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    periodGrain: text("period_grain", {
      enum: ["week", "month", "rolling_28d"],
    }).notNull(),
    value: numeric("value", {
      precision: 10,
      scale: 4,
      mode: "number",
    }).notNull(),
    attribution: attributionLevelEnum("attribution").notNull(),
    // Record<componentKey, {raw, normalized, weight, contribution}>.
    components: jsonb("components").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "score_results_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "score_results_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    check(
      "score_results_subject_shape",
      sql`(subject_level = 'person' AND person_id IS NOT NULL AND team_id IS NULL) OR (subject_level = 'team' AND team_id IS NOT NULL AND person_id IS NULL) OR (subject_level = 'org' AND person_id IS NULL AND team_id IS NULL)`,
    ),
    // The recompute upsert key (nightly + on-demand post-backfill).
    unique("score_results_upsert_uq")
      .on(
        t.orgId,
        t.definitionId,
        t.subjectLevel,
        t.personId,
        t.teamId,
        t.periodStart,
        t.periodEnd,
      )
      .nullsNotDistinct(),
  ],
);

// Published third-party benchmark figures (W2-I) — e.g. Copilot acceptance
// norms, Worklytics/Section adoption benchmarks — so score panels can show
// "you vs. published industry data". Global reference data like
// metric_catalog: no org_id, visible to every org. `status` starts 'draft'
// on seed and only becomes 'verified' once the founder confirms the primary
// source; panels must filter to 'verified' — never surface a draft figure as
// authoritative. `valueUnit` prevents conflating a raw published percentage
// with our normalized 0-100 score scale.
export const benchmarks = pgTable(
  "benchmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scoreSlug: text("score_slug").notNull(), // 'adoption' | 'fluency' | 'efficiency' (+ future slugs; not an enum, mirrors metric_catalog)
    componentKey: text("component_key"), // null = benchmark is for the whole score
    segment: text("segment").notNull().default("overall"), // e.g. 'overall' | 'smb' | 'enterprise'
    metricLabel: text("metric_label").notNull(),
    value: numeric("value", { precision: 10, scale: 4, mode: "number" }),
    valueUnit: text("value_unit", {
      enum: ["normalized_0_100", "percent", "raw"],
    })
      .notNull()
      .default("normalized_0_100"),
    rangeLow: numeric("range_low", { precision: 10, scale: 4, mode: "number" }),
    rangeHigh: numeric("range_high", {
      precision: 10,
      scale: 4,
      mode: "number",
    }),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url"),
    publishedDate: date("published_date", { mode: "string" }),
    notes: text("notes"),
    status: text("status", { enum: ["draft", "verified", "retired"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("benchmarks_slug_component_segment_idx").on(
      t.scoreSlug,
      t.componentKey,
      t.segment,
    ),
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

// One row per connector poll / backfill-chunk attempt (ADR 0005, W1-D).
// The "last synced 2h ago" source of truth and the backfill audit trail:
// resume state is derived from these rows + the queue-message cursor, so no
// separate cursor table exists. `gaps` carries the run's HonestyGap[] —
// degraded attribution is surfaced, never papered over (invariant b).
export const connectorRuns = pgTable(
  "connector_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    kind: text("kind", { enum: ["poll", "backfill"] }).notNull(),
    status: text("status", { enum: ["running", "success", "error"] })
      .notNull()
      .default("running"),
    // The UTC day window this run covered (chunk window for backfill).
    windowStart: date("window_start", { mode: "string" }),
    windowEnd: date("window_end", { mode: "string" }),
    // Queue delivery attempt that produced this row (retries append rows —
    // the log is per attempt, never overwritten).
    attempt: integer("attempt").notNull().default(1),
    subjectsSeen: integer("subjects_seen"),
    recordsUpserted: integer("records_upserted"),
    signalsUpserted: integer("signals_upserted"),
    gaps: jsonb("gaps").notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // Anchor for composite tenant FKs, per D1a — kept even without child
    // tables today so the shape matches every other org-scoped table.
    unique("connector_runs_org_id_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "connector_runs_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    index("connector_runs_org_conn_started_idx").on(
      t.orgId,
      t.connectionId,
      t.startedAt,
    ),
  ],
);

// Opt-in public score-card links (W2-H PR5, ADR 0008). Public resolution is
// a capability-token read (like invites): the plaintext token lives only in
// the share URL; we store its SHA-256 hash. `public_label` is user-chosen
// text shown on the card, decoupled from the §7 pseudonym so a public share
// leaks no PII the user didn't pick. Revocation is a tombstone (revoked_at).
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    scoreSlug: text("score_slug").notNull(), // headline metric, e.g. 'fluency'
    publicLabel: text("public_label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("share_links_org_id_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "share_links_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("share_links_org_idx").on(t.orgId),
  ],
);

// Anonymized-benchmark contribution consent (W2-H PR5, ADR 0008). One row per
// (org, user); set = upsert on the composite unique. Gates the V3 network's
// anonymized aggregation later (W3-N) — promises nothing now.
export const benchmarkConsent = pgTable(
  "benchmark_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granted: boolean("granted").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("benchmark_consent_org_id_id_uq").on(t.orgId, t.id),
    unique("benchmark_consent_org_user_uq").on(t.orgId, t.userId),
  ],
);

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

// Auth tables last: auth-schema imports orgs from this module, so the
// re-export must come after orgs is initialized (circular-import order).
export * from "./auth-schema";
