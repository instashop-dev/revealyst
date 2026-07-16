import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { people } from "./core";

// Engineering roles (W6-B, ADR 0030) — a seeded reference table, deliberately
// NOT an enum (mirrors metric_catalog / benchmarks.score_slug): the closed set
// is expected to grow, and post-freeze catalog changes are ADR-gated data
// migrations. Global reference data (no org_id — documented org-scope exception,
// like metric_catalog): the same rows are visible to every org. `slug` is the
// stable text PK — W6-C's recommendation-catalog `applicable_roles` FKs to it
// (roles.slug), so the ids must survive catalog migrations unchanged. Engineering
// -only seed values at launch; NOT derived from HRIS/org-chart sync (NOT-list).
export const roles = pgTable("roles", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
  // Presentation order in pickers (ascending); ties break on slug.
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Person → role assignment (W6-B, ADR 0030) — an org-scoped table mapping a
// tracked person to at most ONE engineering role. Manual, admin-set in Settings
// (org config, not self-view). PK `(org_id, person_id)` gives one role per
// person and puts org_id IN the key so a cross-org row is unrepresentable; the
// composite tenant FK `(org_id, person_id) → people(org_id, id)` ON DELETE
// CASCADE makes a person from another org unrepresentable and tears the
// assignment down with the person (purged before `people`, like
// rec_interaction_state). `role_slug` FKs the global `roles` reference table.
// Nothing consumes roles until W6-C.
export const roleAssignments = pgTable(
  "role_assignments",
  {
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    roleSlug: text("role_slug")
      .notNull()
      .references(() => roles.slug),
    // Audit: which dashboard admin last set this assignment. Null if that
    // account was since deleted (the assignment row stays).
    assignedByUserId: text("assigned_by_user_id").references(() => user.id, {
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
    // At most one role per (org, person); the `assign` upsert conflict target.
    // org_id is load-bearing IN the key — cross-org rows can't exist.
    primaryKey({ columns: [t.orgId, t.personId] }),
    // Composite tenant FK: the person must belong to the SAME org (D1a). A
    // person delete (account teardown, identity churn) cascades their role.
    foreignKey({
      name: "role_assignments_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    // Role-based lookup within an org (W6-C: recs applicable to a role).
    index("role_assignments_org_role_idx").on(t.orgId, t.roleSlug),
  ],
);
