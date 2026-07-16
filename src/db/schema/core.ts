import { isNotNull, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";

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

// How a person has acted on a coaching recommendation (W5-D, ADR 0028). A
// closed set — the Outcomes-loop forerunner (§8.3). `snoozed` hides the rec
// until `snooze_until`; `dismissed` hides it permanently (and never re-mails in
// the digest); `tried` is positive feedback that keeps the rec visible with a
// "tried" affordance. Growing this set post-freeze requires an ADR.
// Type name is `_kind`-suffixed: a table `rec_interaction_state` auto-creates a
// composite type of that name, so the enum can't share it (Postgres 42710).
export const recInteractionStateEnum = pgEnum("rec_interaction_state_kind", [
  "snoozed",
  "dismissed",
  "tried",
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
