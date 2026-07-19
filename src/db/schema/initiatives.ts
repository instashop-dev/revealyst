import {
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
  uuid,
} from "drizzle-orm/pg-core";
import { people, teams } from "./core";

// Initiatives (Team Manager Dashboard P2, ADR 0062). An initiative turns a
// recommendation into a TRACKED effort: an owner (manager), named participants,
// a baseline/target on a metric or capability, a duration/review date, and — at
// review time — a measured before/after and a manager-set outcome. It is the
// heart of the manager loop (goal → diagnosis → action → EXECUTION → outcome).
//
// CROSSES THE SELF-VIEW WALL (ADR 0062, on the ADR-0038 mold): unlike missions
// (single-person, self-view-only), an initiative names participants to their
// MANAGER. That named read is a SEPARATE manager-authorized surface (registered
// in src/lib/visibility.ts MANAGER_AUTHORIZED_IDENTITY_SURFACES, gated on a
// team-manager grant + managed/full mode), NOT the private-mode team view. This
// schema stores the ids; the authorization lives in the read layer + its authz
// test matrix (D-TCI-1 unblock; see ADR 0062).
//
// ANTI-GAMIFICATION (Spec V4 §8.4, R3): deliberately NO xp/streak/league/points/
// badge/level column — an initiative is a management artifact, not a game. A
// schema-shape test + a banned-phrasing copy sweep pin this (tests/initiatives).

export const initiativeStatus = pgEnum("initiative_status", [
  "draft",
  "active",
  "in_review",
  "completed",
  "stopped",
]);

// Set only at review time (null until reviewed). NOT a causal claim — the review
// presents measured before/after and the manager records which it was (P3).
export const initiativeOutcome = pgEnum("initiative_outcome", [
  "improved",
  "unchanged",
  "worsened",
  "inconclusive",
]);

export const initiatives = pgTable(
  "initiatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    // NULL = an org-wide initiative (the common case today, mirroring team_goals
    // / team_insights); non-null = a specific team's, anchored by the composite
    // tenant FK below.
    teamId: uuid("team_id"),
    // The manager who owns/launched it (their own auth user id).
    ownerUserId: text("owner_user_id").notNull(),
    title: text("title").notNull(),
    // The initiative-library template it was launched from (src/lib/
    // initiative-library.ts, a CODED registry — no DB FK), or null for a
    // free-form initiative. Validated in code, never free-form vocabulary.
    templateSlug: text("template_slug"),
    // What it aims to move: a capability slug and/or a score slug (at least one
    // set, enforced in the app/library). Both nullable, both closed unions
    // validated in code (never free-form — invariant b / no formula DSL).
    capabilitySlug: text("capability_slug"),
    scoreSlug: text("score_slug"),
    // Baseline captured (measured-or-null) at launch; target manager-set. Both
    // honestly labeled manager-set in UI (invariant b — baseline never fabricated).
    baseline: integer("baseline"),
    target: integer("target").notNull(),
    reviewDate: date("review_date").notNull(),
    status: initiativeStatus("status").notNull().default("active"),
    // Null until the manager reviews at review_date (P3). Never a causal claim.
    outcome: initiativeOutcome("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Stamped whenever `status` changes — the lifecycle audit axis (mirrors
    // team_insights.statusChangedAt / team_goals.statusChangedAt).
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The (org_id, id) unique target so `initiative_participants` can reference
    // an initiative via a COMPOSITE tenant FK (a participant can never point at a
    // cross-org initiative), the same belt-and-suspenders pattern as teams.
    unique("initiatives_org_id_id_uq").on(t.orgId, t.id),
    // Composite tenant FK — enforced only when team_id is non-null (MATCH SIMPLE),
    // so an org-wide initiative is permitted while a team-scoped one must
    // reference a team in the SAME org. A team delete cascades its initiatives.
    // (org_id itself carries no FK to orgs — account deletion purges these rows
    // explicitly, ordered before `teams`, mirroring team_insights.)
    foreignKey({
      name: "initiatives_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    index("initiatives_org_status_idx").on(t.orgId, t.status),
  ],
);

// The wall-crossing join table: which named people participate in an initiative.
// A manager of the initiative's team may read the NAMES (ADR 0062); every other
// caller cannot (authz in the read layer, pinned by the manager-vs-member-vs-
// admin matrix). Purged BEFORE both `initiatives` and `people`.
export const initiativeParticipants = pgTable(
  "initiative_participants",
  {
    orgId: uuid("org_id").notNull(),
    initiativeId: uuid("initiative_id").notNull(),
    personId: uuid("person_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.personId] }),
    // Composite tenant FK to the initiative in the SAME org — a participant can
    // never reference a cross-org initiative. Cascades when the initiative is
    // deleted.
    foreignKey({
      name: "initiative_participants_org_initiative_fk",
      columns: [t.orgId, t.initiativeId],
      foreignColumns: [initiatives.orgId, initiatives.id],
    }).onDelete("cascade"),
    // Composite tenant FK: the person must belong to the SAME org; a person
    // delete cascades their participation (purged before `people`).
    foreignKey({
      name: "initiative_participants_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("initiative_participants_org_person_idx").on(t.orgId, t.personId),
  ],
);
