import { isNotNull, sql } from "drizzle-orm";
import {
  boolean,
  date,
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
  // Creation provenance (ADR 0052): who created this org. Distinct from
  // bootstrapUserId, which is the UNIQUE per-user signup-org marker owned by
  // the personal org (a team workspace must never claim it) — a user can
  // CREATE many team workspaces but bootstrap exactly one personal org. Drives
  // the D-ONB-1 per-user creation cap (workspaces you created, not ones you
  // were invited to administer). NULL for orgs predating the column and for
  // signup personal orgs (their provenance is already bootstrapUserId).
  createdByUserId: text("created_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
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

// Team → manager assignment (D-TCI-3, ADR 0044). A MANAGER is a dashboard AUTH
// USER (org member) responsible for a team — distinct from team_members, which
// groups tracked PEOPLE. The Better Auth per-org role stays admin|member (auth
// schema untouched); "manager" is derived — an org member with ≥1 row here.
// The shared org_id feeds the composite tenant FK to teams, so a row linking a
// team and a manager from different orgs cannot exist. Granting a manager row
// confers NO per-person data visibility today (self-view-only mastery still
// stands, D-TCI-1); it only records who manages a team and gates future
// manager-only aggregate surfaces.
export const teamManagers = pgTable(
  "team_managers",
  {
    orgId: uuid("org_id").notNull(),
    teamId: uuid("team_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A user manages a team once; org_id is fixed by team_id (a team belongs to
    // exactly one org), so it need not sit in the key — mirrors team_members.
    primaryKey({ columns: [t.teamId, t.userId] }),
    // Composite tenant FK: the team must belong to the SAME org (D1a). A team
    // delete tears its manager rows down.
    foreignKey({
      name: "team_managers_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    // "Which teams does this user manage?" — the access-seam read (managedTeamIds).
    index("team_managers_org_user_idx").on(t.orgId, t.userId),
  ],
);

// Per-team admin settings (TCI Phase 2-E, ADR 0045 sketch). ONE row per team,
// created lazily only when an admin flips a setting — an ABSENT row means all
// defaults (the org-scope `get` never auto-inserts on read). Today it carries a
// single toggle: whether a team's managers may see a member's per-person spend
// by name (D-TCI-2, default OFF; capability reads do NOT need this toggle). The
// shared org_id feeds the composite tenant FK to teams, so a settings row for a
// team in another org is unrepresentable at the DB level (D1a), and a team
// delete tears its settings row down.
export const teamSettings = pgTable(
  "team_settings",
  {
    orgId: uuid("org_id").notNull(),
    teamId: uuid("team_id").notNull(),
    // D-TCI-2: managers of this team may read a managed member's per-person spend
    // (behind managed/full visibility). Default OFF — capability mastery reads are
    // NOT gated by this flag; spend reads are.
    managersSeeIndividualCost: boolean("managers_see_individual_cost")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One settings row per team — this composite PK IS the UNIQUE(org_id, team_id)
    // the ADR sketches (org_id is fixed by team_id, a team belongs to one org),
    // and it is the set() upsert conflict target. Mirrors team_members' composite
    // key; no surrogate id (nothing in the sketch calls for one).
    primaryKey({ columns: [t.orgId, t.teamId] }),
    // Composite tenant FK: the team must belong to the SAME org (D1a). A team
    // delete cascades its settings row.
    foreignKey({
      name: "team_settings_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
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

// Manager notes on a tracked person (D-TCI-7, ADR 0053). A private,
// author-attributed coaching observation a MANAGER writes about a member of a
// team they manage — the qualitative complement to the capability + spend
// drill-ins on /team/[personId]. Read visibility is ANY current manager of the
// subject's team(s) (ADR 0045 minimal-surface scoping — author-attributed, not
// author-private); WRITE and DELETE are author-only.
//
// APPEND-ONLY: there is no `updated_at` and no edit flow. A note is created once
// and later deleted by its author — the two mutations. This keeps the surface a
// factual log of who-observed-what-when rather than a mutable record.
//
// This table NEVER feeds scoring, deriveAttention, or capability state — it is
// pure human coaching content, structurally isolated from every metric path
// (proven by tests/manager-notes-scoring-isolation.test.ts). It holds no
// prompt-content or per-user fabricated numbers (invariant b); the body is
// free-text a manager typed.
//
// Two ON DELETE CASCADE edges:
//   1. Composite tenant FK (org_id, person_id) → people — a person's deletion
//      (and org account deletion, which purges people) tears their notes down;
//      a cross-org note is unrepresentable at the DB level (D1a).
//   2. author_user_id → user.id — a note is the AUTHOR'S OWN observation, so it
//      dies with the author's account (there is no orphaned/anonymized note).
export const managerNotes = pgTable(
  "manager_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    // The signed-in manager who wrote the note. CASCADE: dies with the author.
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Free-text coaching observation the manager typed. NEVER a metric input.
    body: text("body").notNull(),
    // Optional reminder date (YYYY-MM-DD) — "follow up with this person on".
    // Display-only; drives no automation or scoring.
    followUpOn: date("follow_up_on"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite tenant FK: the person must belong to the SAME org (D1a). A person
    // delete (or org purge) cascades their notes.
    foreignKey({
      name: "manager_notes_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    // "All notes about this person" — the drill-in read.
    index("manager_notes_org_person_idx").on(t.orgId, t.personId),
  ],
);
