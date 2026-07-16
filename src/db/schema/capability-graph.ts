import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { people, teams } from "./core";
import { metricCatalog } from "./tracking";

// ─── AI Capability graph (W7-1, ADR 0035) ───
//
// A small RELATIONAL capability catalog — NOT a graph database (the standing
// tripwire): ~1 domain, <20 capabilities, shallow prerequisite edges, every
// read batched. All four tables are GLOBAL reference data (no org_id, like
// `roles` / `metric_catalog`), seeded IN the migration (drizzle/0030), so they
// skip the three-registration law; they carry no per-person data. Per-person
// mastery lives in the separate org-scoped `user_capability_state` (W7-2).

// Top-level area a capability belongs to (Engineering only at launch).
export const domains = pgTable("domains", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// An outcome-named durable ability (e.g. "Make AI part of daily work"). Content
// columns carry the plain-English coaching prose (summary/workflow/playbook/
// learning-path) that folds the retired static /playbook page into data. `slug`
// PK keeps one active row per capability (a version bump is a content edit, not
// a new row) — simpler than score_definitions' (slug, version) because there is
// no per-org override and no history table for reference content.
export const capabilities = pgTable("capabilities", {
  slug: text("slug").primaryKey(),
  domainSlug: text("domain_slug")
    .notNull()
    .references(() => domains.slug),
  version: integer("version").notNull().default(1),
  label: text("label").notNull(),
  // One-line plain-English summary (the card subtitle). Beginner-friendly, no
  // jargon (CLAUDE.md writing rule; fact-checked as a claim surface).
  summary: text("summary").notNull(),
  // Optional longer coaching prose. Null until authored — never a fabricated
  // placeholder.
  workflow: text("workflow"),
  playbook: text("playbook"),
  learningPath: text("learning_path"),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The reuse hinge: binds a capability to EXISTING evidence — either a canonical
// `metric_catalog` key OR a score-definition component key (validated against
// SCORE_GLOSSARY in the seed test). Exactly one of the two is set per row (CHECK
// below). No new signals are introduced here; the capability layer only POINTS
// AT what the connectors already ingest (P1 is display-only; the mastery engine
// (P2) reads these bindings).
export const capabilitySignals = pgTable(
  "capability_signals",
  {
    // Surrogate PK: the natural key (capability_slug, metric_key, component_key)
    // spans nullable columns, and a Postgres PRIMARY KEY forces its columns NOT
    // NULL — which would break the "exactly one binding" rule. Uniqueness is
    // enforced by the NULLS NOT DISTINCT index below instead.
    id: uuid("id").primaryKey().defaultRandom(),
    capabilitySlug: text("capability_slug")
      .notNull()
      .references(() => capabilities.slug),
    // A canonical metric key (FK metric_catalog.key) — set for a metric binding.
    metricKey: text("metric_key").references(() => metricCatalog.key),
    // A score component key (e.g. "active_days", "effectiveness") — set for a
    // component binding. Validated against SCORE_GLOSSARY in the seed test
    // (Postgres has no reference table for component keys).
    componentKey: text("component_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One binding row per (capability, metric_key, component_key). NULLS NOT
    // DISTINCT so a repeated component binding (metric_key NULL) still conflicts
    // on idempotent re-seed.
    unique("capability_signals_binding_uq")
      .on(t.capabilitySlug, t.metricKey, t.componentKey)
      .nullsNotDistinct(),
    // Exactly one of (metric_key, component_key) is non-null — a binding is
    // either a raw metric or a score component, never both and never neither.
    check(
      "capability_signals_one_binding_ck",
      sql`(${t.metricKey} IS NOT NULL) <> (${t.componentKey} IS NOT NULL)`,
    ),
  ],
);

// Prerequisite edges — a shallow DAG. `capability_slug` requires `requires_slug`
// to be mastered first. Self-edges forbidden by CHECK; acyclicity enforced by a
// TS DAG walk in the seed-contract test (a tiny graph — cycle detection in code,
// not SQL).
export const capabilityDependencies = pgTable(
  "capability_dependencies",
  {
    capabilitySlug: text("capability_slug")
      .notNull()
      .references(() => capabilities.slug),
    requiresSlug: text("requires_slug")
      .notNull()
      .references(() => capabilities.slug),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.capabilitySlug, t.requiresSlug] }),
    check(
      "capability_dependencies_no_self_edge_ck",
      sql`${t.capabilitySlug} <> ${t.requiresSlug}`,
    ),
  ],
);

// Per-person capability mastery (W7-2, ADR 0036) — an ORG-SCOPED table, the
// parallel incremental reducer's output (the Maturity Model precedent: a pure
// lib over the org-scoped readers, deliberately NOT extending the frozen score
// engine). One row per (org, person, capability) that has evidence; a person
// with NO evidence for a capability gets NO row (never `mastery: 0` — the
// honesty rule, invariant b). Self-view-only: read by the signed-in person for
// their own rows; a per-person capability number NEVER leaves self-view (no team
// read surface consumes this table — P6's rollup aggregates it count-only).
// Capped `directional` until the OTel receiver (P8) provides ≥2 corroborating
// markers (L7). Recompute-derivable and idempotent, so the backfill is safe to
// ship empty and populate on the next nightly pass.
export const userCapabilityState = pgTable(
  "user_capability_state",
  {
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    capabilitySlug: text("capability_slug")
      .notNull()
      .references(() => capabilities.slug),
    // Mastery in [0,1] (numeric(6,4)); the display band is derived at read time.
    mastery: numeric("mastery", {
      precision: 6,
      scale: 4,
      mode: "number",
    }).notNull(),
    // Confidence in [0,1] from measurement coverage + evidence volume + the
    // fraction of the capability's signals that produced evidence.
    confidence: numeric("confidence", {
      precision: 6,
      scale: 4,
      mode: "number",
    }).notNull(),
    // Reuse the ConfidenceTier vocabulary; HARD-CAPPED `directional` this phase.
    confidenceTier: text("confidence_tier", {
      enum: ["measured", "modeled", "directional", "not_measured"],
    }).notNull(),
    // How many bound-signal evidence points folded into this state.
    evidenceCount: integer("evidence_count").notNull().default(0),
    // Last day (YYYY-MM-DD) a bound signal produced evidence, or null.
    lastEvidenceAt: date("last_evidence_at"),
    // Days since last bound-signal evidence at compute time (drives decay).
    staleness: integer("staleness").notNull().default(0),
    // The person's single highest-priority eligible-next capability (not yet
    // mastered, all prerequisites mastered) — denormalized onto each of their
    // rows for a one-read card. Null when nothing is eligible-next.
    nextCapability: text("next_capability"),
    // jsonb per-bound-signal breakdown mirroring ScoreComponentBreakdown, for
    // explainability (which signals moved mastery and by how much).
    components: jsonb("components").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One state per (org, person, capability); the reducer's upsert conflict
    // target. org_id is load-bearing IN the key — cross-org rows can't exist.
    primaryKey({ columns: [t.orgId, t.personId, t.capabilitySlug] }),
    // Composite tenant FK: the person must belong to the SAME org (D1a). A
    // person delete cascades their capability state (purged before `people`).
    foreignKey({
      name: "user_capability_state_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    // Self-view read (this person's whole capability profile, one round trip).
    index("user_capability_state_org_person_idx").on(t.orgId, t.personId),
    // Aggregate coverage rollup (P6): share of a team mastering each capability.
    index("user_capability_state_org_capability_idx").on(
      t.orgId,
      t.capabilitySlug,
    ),
  ],
);

// Per-capability team history rollup (TCI Phase 2-D, ADR 0046) — an ORG-SCOPED,
// append-only PERIODIC rollup: one row per (org, optional team, capability,
// period). A deliberate compute-on-read EXCEPTION (the repo's default is
// compute-on-read), justified because the only timestamp source that could serve
// as a history axis — `score_results.computed_at` — is REWRITTEN by the nightly
// recompute upsert (CLAUDE.md timestamp gotcha), so history is otherwise
// unrecoverable. It exists to make per-capability TRENDS, movement counts, and
// coaching baselines computable (§6.5 Growth surface).
//
// COUNT-ONLY and NO per-person data: the row carries member/coverage COUNTS and a
// single confidence-tier summary — never a person id or a per-person value, so a
// per-person leak is structurally impossible (mirrors `mastery.coverageCounts`,
// which never emits a person id). Rows are derived from the SAME pure function the
// dashboard uses (`mastery.coverageCounts`), never a parallel re-implementation —
// a shared-source parity test pins that a snapshot can never disagree with the
// live dashboard for the same inputs.
//
// Rows are ORG-LEVEL by default with an optional `team_id` (an org IS one team
// for most customers today; `team_id NULL` = the org-wide series). The writer (the
// poller's parallel rollup step) only produces org-wide rows; `team_id` lets a
// multi-team org carry per-team series later without a schema change.
//
// True counts are STORED; the `MIN_PEOPLE` floor is a RENDER-time rule (applied
// by `applyMinPeopleFloor`, src/lib/capability-history.ts), never at write —
// flooring at write would bake gaps/zeros into the stored series and make a later
// trend uncomputable and dishonest.
export const teamCapabilityHistory = pgTable(
  "team_capability_history",
  {
    // Surrogate PK: the natural key (org_id, team_id, capability_slug,
    // period_start) spans the NULLABLE `team_id`, and a Postgres PRIMARY KEY
    // forces its columns NOT NULL — which would forbid the org-wide (team_id
    // NULL) series. Uniqueness is enforced by the NULLS NOT DISTINCT index below
    // instead (same pattern as `capability_signals`).
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    // NULL = the org-wide series; non-null = a specific team's series (anchored
    // by the composite tenant FK below).
    teamId: uuid("team_id"),
    capabilitySlug: text("capability_slug")
      .notNull()
      .references(() => capabilities.slug),
    // Inclusive UTC calendar-day period bounds (the month grain the dashboard
    // coverage uses). The current, still-open period's row is rewritten each
    // nightly pass; it freezes once the period closes and the window moves on.
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // People with a state row for this capability (== coverageCounts.withState).
    representedCount: integer("represented_count").notNull(),
    // Team/org member denominator (org member count for the org-wide series).
    totalCount: integer("total_count").notNull(),
    // Coverage counts by mastery band. `mastered` == coverageCounts.mastered
    // (mastery ≥ MASTERED_THRESHOLD); `developing` == represented − mastered
    // (has evidence but below the mastered threshold). Two bands today.
    masteredCount: integer("mastered_count").notNull(),
    developingCount: integer("developing_count").notNull(),
    // A single count-derived confidence-tier SUMMARY for the cohort: "measured"
    // only when EVERY represented person is measured (a team claim bounded by its
    // weakest member — honest), else "directional"; "not_measured" only when
    // represented is 0 (not written in practice — no row for 0-represented).
    confidenceTier: text("confidence_tier", {
      enum: ["measured", "modeled", "directional", "not_measured"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The natural key / upsert conflict target. NULLS NOT DISTINCT so an org-wide
    // row (team_id NULL) still CONFLICTS with itself on an idempotent re-run
    // (Postgres would otherwise treat two NULL team_ids as distinct and append a
    // duplicate period row).
    unique("team_capability_history_period_uq")
      .on(t.orgId, t.teamId, t.capabilitySlug, t.periodStart)
      .nullsNotDistinct(),
    // Composite tenant FK — enforced ONLY when team_id is non-null (MATCH SIMPLE
    // skips a partially-null FK), so the org-wide series (team_id NULL) is
    // permitted while a team-scoped row must reference a team in the SAME org. A
    // team delete cascades its history.
    foreignKey({
      name: "team_capability_history_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    // The trend read: a capability's series over a period range, one org.
    index("team_capability_history_org_capability_period_idx").on(
      t.orgId,
      t.capabilitySlug,
      t.periodStart,
    ),
  ],
);
