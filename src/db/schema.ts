import { isNotNull, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

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
