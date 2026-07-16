import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  attributionLevelEnum,
  orgs,
  people,
  scoreSubjectLevelEnum,
  teams,
} from "./core";

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
