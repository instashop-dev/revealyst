import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./core";

// Team goal / review period (Team Manager Dashboard P1, ADR 0061). ORG-SCOPED.
// The manager-set objective that heads the Command Center: "what should the team
// get better at, and by when?" One ACTIVE goal per org (or per team) at a time;
// older goals are archived, never deleted (a review-period history).
//
// HONESTY (invariant b): every value here except the auto-suggested baseline is
// MANAGER-SET, not a Revealyst measurement or promise — the UI labels it as such
// (the renewal-date "unverifiable" precedent). `baseline` is NULLABLE: when the
// current value of the chosen metric is unmeasured we store NULL and withhold it,
// never fabricate a 0 (invariant b — "no data yet" is not "measured zero").
//
// NO free-form metric (tripwire: no formula DSL): `metricSlug` is a CLOSED union
// validated in `src/lib/team-goal.ts` (`adoption | fluency | efficiency`), stored
// as plain text — NOT a pg enum — so a future capability-slug target needs no enum
// migration. The scoring `score_slug` values it references are a frozen contract;
// this column never widens them.
//
// This table holds NO per-person data beyond `ownerUserId` (the manager's own auth
// user id) — it is a manager-scoped objective, not a self-view surface.

export const goalStatus = pgEnum("goal_status", ["active", "met", "archived"]);

export const teamGoals = pgTable(
  "team_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    // NULL = the org-wide goal (the common case — an org IS one team for most
    // customers today, mirroring team_insights / team_capability_history);
    // non-null = a specific team's goal, anchored by the composite tenant FK below.
    teamId: uuid("team_id"),
    // Closed union over existing score slugs, validated in src/lib/team-goal.ts.
    // Plain text (not a pg enum) so a later capability-slug target is additive.
    metricSlug: text("metric_slug").notNull(),
    // Auto-suggested from the current MEASURED value at set time; NULL when that
    // value is unmeasured (invariant b — never a fabricated 0).
    baseline: integer("baseline"),
    // Manager-set target + review date + owner (the manager's auth user id).
    target: integer("target").notNull(),
    reviewDate: date("review_date").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    status: goalStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Stamped whenever `status` changes (met/archived) — distinct from createdAt
    // so an archive time is recoverable (mirrors team_insights.statusChangedAt).
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite tenant FK — enforced ONLY when team_id is non-null (MATCH SIMPLE
    // skips a partially-null FK), so the org-wide goal (team_id NULL) is permitted
    // while a team-scoped goal must reference a team in the SAME org. A team delete
    // cascades its goals. (org_id itself carries no FK to orgs — account deletion
    // purges these rows explicitly, ordered before `teams`, mirroring team_insights.)
    foreignKey({
      name: "team_goals_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    // At most ONE active goal per team (team_id non-null). Partial — archived/met
    // rows never conflict, so a team keeps a full history under one live goal.
    uniqueIndex("team_goals_active_team_uq")
      .on(t.orgId, t.teamId)
      .where(sql`${t.status} = 'active' and ${t.teamId} is not null`),
    // At most ONE active org-wide goal (team_id NULL). A SEPARATE partial index on
    // (org_id) alone — a plain unique index over (org_id, team_id) would treat two
    // NULL team_ids as DISTINCT and let two org-wide active goals coexist, and
    // NULLS NOT DISTINCT is unavailable on a partial unique index in this drizzle
    // version. Splitting the two cases is the clean, explicit guard. The app also
    // enforces one-active via archive-then-insert CAS (org-scope/goals.ts); this
    // index makes a concurrent/redelivered double-insert impossible at the DB.
    uniqueIndex("team_goals_active_org_uq")
      .on(t.orgId)
      .where(sql`${t.status} = 'active' and ${t.teamId} is null`),
    // The header read: this org's goals by status (active first).
    index("team_goals_org_status_idx").on(t.orgId, t.status),
  ],
);
