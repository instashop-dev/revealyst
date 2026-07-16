import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orgs, people, recInteractionStateEnum } from "./core";

// Recommendation interaction state (W5-D, ADR 0028) — the Outcomes-loop
// forerunner (§8.3). ONE row per (org, person, recommendation): how this
// person acted on a coaching recommendation (snoozed/dismissed/tried). Keyed
// (org_id, person_id, rec_id) so a person can hold at most one state per rec;
// `set` upserts on that key. `rec_id` is the STABLE static-map id from
// src/lib/coaching-recommendations.ts (survives the future W6-C catalog
// migration unchanged) — a plain text column, never an FK to a catalog table
// that doesn't exist yet. `snooze_until` is set only for `snoozed` rows (null
// otherwise); once it passes, the rec resurfaces (snooze expiry). org_id sits
// IN the primary key and the composite tenant FK points (org_id, person_id) at
// people(org_id, id), so a row referencing a person from another org is
// unrepresentable. SELF-VIEW ONLY: this is never on a team/manager-visible
// surface — a manager never reads another person's interaction state (§8.3).
export const recInteractionState = pgTable(
  "rec_interaction_state",
  {
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    // The static-map recommendation id (COACHING_RECOMMENDATIONS[].id).
    recId: text("rec_id").notNull(),
    state: recInteractionStateEnum("state").notNull(),
    // When the person last acted (snoozed/dismissed/tried). Defaults to now;
    // rewritten on each `set` so the latest action's time is what's stored.
    actedAt: timestamp("acted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Only meaningful for `snoozed`: the rec resurfaces once this passes. Null
    // for `dismissed`/`tried`.
    snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // At most one state per (org, person, rec); the `set` upsert conflict
    // target. org_id is load-bearing IN the key — cross-org rows can't exist.
    primaryKey({ columns: [t.orgId, t.personId, t.recId] }),
    // Composite tenant FK: the person must belong to the SAME org (D1a). A
    // person delete (account teardown, identity churn) cascades their state.
    foreignKey({
      name: "rec_interaction_state_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    // Per-person lookup (the self-view read + the digest dismiss scan).
    index("rec_interaction_state_org_person_idx").on(t.orgId, t.personId),
  ],
);

// Recommendation catalog (W6-C, ADR 0033) — the coaching content as SEEDED,
// VERSIONED reference data, superseding the 7-entry static map in
// src/lib/coaching-recommendations.ts (its content migrates VERBATIM in
// drizzle/0029). Same recipe as score_definitions / metric_catalog: content is
// DATA, the evaluator (`deriveAttention`, src/lib/score-insights.ts) stays code
// — a small CLOSED vocabulary of comparators over `required_signals`, no DSL,
// no LLM (G6). org_id NULL = global preset (the documented reference-data
// exception, visible to every org alongside its own rows); an org may author
// its own rows later. Rows are IMMUTABLE per version — a change mints a new
// version, so a person's stored interaction state stays reproducible.
//
// `slug` is the STABLE recommendation id: it EQUALS the static map's id (e.g.
// "adoption-active-days") so existing rec_interaction_state.rec_id rows keep
// resolving across the migration (verified by the migration-equivalence test).
//
// Copy discipline (invariant b — every body is a claim surface; W3-N/W3-P):
// task-focused never person-focused, grounded in a MEASURED weak component,
// no fabricated numbers, no per-vendor feature claims beyond generic capability
// nouns. The seed↔evaluator contract test fact-checks every seeded body.
export const recommendationCatalog = pgTable(
  "recommendation_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL = global preset (reference-data exception, like score_definitions);
    // NO ACTION FK to orgs so org-authored rows must be purged explicitly on
    // account deletion (they are — src/db/account-deletion.ts PURGE_TABLES).
    orgId: uuid("org_id").references(() => orgs.id),
    // The stable recommendation id (== the static map's `id`, e.g.
    // "adoption-active-days"). rec_interaction_state.rec_id points here by value
    // (no FK — that table predates this one). This is the unique-key `slug`, NOT
    // the score slug (that's `score_slug` below); the two differ deliberately.
    slug: text("slug").notNull(),
    version: integer("version").notNull(),
    // The SCORE whose weak component this addresses (== the static map's `slug`,
    // a ScoreSlug e.g. "adoption"). The evaluator keys its lookup on
    // `score_slug::component_key`, so this must be the score slug, never the
    // rec id.
    scoreSlug: text("score_slug").notNull(),
    // The LIVE preset component this coaches on (validated in the seed-contract
    // test against SCORE_GLOSSARY — never a raw key with no glossary home).
    componentKey: text("component_key").notNull(),
    // Same-signal dedupe group — the evaluator dedupes candidates by this
    // BEFORE its cap so two flavors of one signal never burn both slots.
    signalGroup: text("signal_group", {
      enum: [
        "active-days",
        "feature-breadth",
        "effectiveness",
        "output-per-spend",
        "engagement-per-spend",
      ],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Generic capability nouns / role slugs this row targets. Empty = universal
    // (the 7 launch entries are universal adoption guidance, not role/tool
    // scoped). `applicable_roles` elements are validated against roles.slug in
    // the seed-contract test (Postgres has no element-level array FK).
    applicableRoles: text("applicable_roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    applicableTools: text("applicable_tools")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Structured comparators over the CLOSED vocabulary (measured ·
    // normalized-below · min-weight) — src/lib/recommendation-catalog.ts's
    // `requiredSignalsSchema`. An unparseable row FAILS the seed-contract test.
    // NOT a DSL and NOT LLM-authored logic (§8.2).
    requiredSignals: jsonb("required_signals").notNull(),
    // W5-E optimization metadata (§8.2), closed vocabularies. `benefit` is the
    // static map's `impact` (typical adoption upside of the ADVICE PATTERN,
    // never a person). All describe the pattern, not any individual.
    benefit: text("benefit", { enum: ["high", "medium", "low"] }).notNull(),
    difficulty: text("difficulty", {
      enum: ["low", "medium", "high"],
    }).notNull(),
    confidence: text("confidence", {
      enum: ["high", "medium", "low"],
    }).notNull(),
    learningResources: text("learning_resources")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    relatedWorkflows: text("related_workflows")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // W7-1 (ADR 0035) — capabilities this recommendation advances. Elements are
    // `capabilities.slug` values, validated against the live capability seed in
    // the seed-contract test (Postgres has no element-level array FK, same as
    // applicable_roles). Empty = links to no capability (never fabricates an
    // "Unknown capability"). Additive/optional: existing consumers ignore it.
    targetCapabilities: text("target_capabilities")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // §7.3 named insight taxonomy (domain the insight belongs to).
    insightKind: text("insight_kind", {
      enum: [
        "data-hygiene",
        "adoption",
        "effectiveness-verification",
        "spend",
        "agentic-transition",
        "early-warning",
        "narrative",
        "milestone-positive",
      ],
    }).notNull(),
    // §8.2 closed 3-value suggested-action taxonomy (was the static map's
    // `actionType`).
    suggestedActionType: text("suggested_action_type", {
      enum: ["link-out", "in-product-setting", "vendor-deep-link"],
    }).notNull(),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT so two global presets (org_id NULL) can't share a
    // (slug, version) — the idempotent-seed conflict target (PG15+; Neon +
    // PGlite). Mirrors score_definitions_org_slug_version_uq.
    unique("recommendation_catalog_org_slug_version_uq")
      .on(t.orgId, t.slug, t.version)
      .nullsNotDistinct(),
    // DB-level guards on the closed taxonomies (belt-and-suspenders on top of
    // the TS enums + the seed-contract test).
    check(
      "recommendation_catalog_benefit_ck",
      sql`${t.benefit} IN ('high','medium','low')`,
    ),
    check(
      "recommendation_catalog_difficulty_ck",
      sql`${t.difficulty} IN ('low','medium','high')`,
    ),
    check(
      "recommendation_catalog_confidence_ck",
      sql`${t.confidence} IN ('high','medium','low')`,
    ),
    check(
      "recommendation_catalog_action_type_ck",
      sql`${t.suggestedActionType} IN ('link-out','in-product-setting','vendor-deep-link')`,
    ),
  ],
);

// Recommendation exposure log (W7-7, ADR 0038) — an append log of "coaching rec
// X was shown to person Y", the foundation for measuring whether recommendations
// cause improvement (experimentation / holdouts). This REVERSES the deliberate
// "don't log rec-shown-to-X" stance (rec_interaction_state route), so it is
// gated by ADR 0038 and constrained: ORG-SCOPED, self-view-only (no manager/
// admin READ route exists), purge-registered (before `people`), never on the
// team-visible view. Day-grain + a unique key make it idempotent under
// at-least-once digest redelivery (exactly one row per person/rec/surface/day).
export const recommendationExposure = pgTable(
  "recommendation_exposure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    // The catalog rec slug shown (== recommendation_catalog.slug / rec id).
    recId: text("rec_id").notNull(),
    surface: text("surface", { enum: ["dashboard", "digest"] }).notNull(),
    // Day the rec was shown ("YYYY-MM-DD") — day grain bounds growth + is the
    // idempotency key (a rec shown twice the same day on the same surface is
    // one exposure).
    shownAt: date("shown_at").notNull(),
    // The experiment this exposure was part of + the person's assigned arm, or
    // null when no experiment was active. Deterministic (stable hash), never
    // per-request random — so an assignment is stable across renders.
    experimentKey: text("experiment_key"),
    variant: text("variant"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Exactly one row per (org, person, rec, surface, day) — the CAS/idempotency
    // key for at-least-once redelivery.
    unique("recommendation_exposure_dedupe_uq").on(
      t.orgId,
      t.personId,
      t.recId,
      t.surface,
      t.shownAt,
    ),
    // Composite tenant FK: the person must belong to the SAME org; a person
    // delete cascades their exposures (purged before `people`).
    foreignKey({
      name: "recommendation_exposure_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("recommendation_exposure_org_person_idx").on(t.orgId, t.personId),
  ],
);
