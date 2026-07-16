import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { capabilities } from "./capability-graph";
import { people } from "./core";

// Missions (W7-5, ADR 0037) — a curated, finish-lined challenge: a short ordered
// sequence of steps toward a capability. `missions`/`mission_steps` are GLOBAL
// reference data (seeded in the migration, like capabilities); `mission_progress`
// is per-person opt-in state (org-scoped, self-view). Completion is a MEASURED
// capability crossing, never self-asserted (Spec V4 §8.4). ANTI-GAMIFICATION: no
// xp / streak / league / points column exists anywhere here — a schema-shape
// test (tests/missions.test.ts) fails if one is ever added.
export const missions = pgTable("missions", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One ordered step of a mission. The step is DONE when the person's mastery of
// `capability_slug` reaches `target_mastery` — a measured crossing read from
// `user_capability_state`, not a self-asserted checkbox.
export const missionSteps = pgTable(
  "mission_steps",
  {
    missionSlug: text("mission_slug")
      .notNull()
      .references(() => missions.slug),
    stepOrder: integer("step_order").notNull(),
    capabilitySlug: text("capability_slug")
      .notNull()
      .references(() => capabilities.slug),
    // The mastery [0,1] this step requires (a stepping-stone bar, typically
    // below the "mastered" threshold). numeric(6,4), read as a JS number.
    targetMastery: numeric("target_mastery", {
      precision: 6,
      scale: 4,
      mode: "number",
    }).notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.missionSlug, t.stepOrder] })],
);

// Per-person mission progress (org-scoped, self-view-only). A row exists ONLY
// after the person opts in (`start`); `completed_at` is set by the nightly
// reducer when every step's measured crossing is met — never by a user action.
// Deliberately NO xp/streak/league/points column (Spec V4 §8.4).
export const missionProgress = pgTable(
  "mission_progress",
  {
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    missionSlug: text("mission_slug")
      .notNull()
      .references(() => missions.slug),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.personId, t.missionSlug] }),
    // Composite tenant FK: the person must belong to the SAME org (D1a); a
    // person delete cascades their mission progress (purged before `people`).
    foreignKey({
      name: "mission_progress_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("mission_progress_org_person_idx").on(t.orgId, t.personId),
  ],
);
