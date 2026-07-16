import {
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { teams } from "./core";

// Aggregate manager insight feed (TCI Phase 2-F, ADR 0050). ORG-SCOPED,
// COUNT-ONLY, self-contained per org. A persisted feed of at most a few open
// manager insights (capability gaps, plateaus, concentration risk, low
// adoption, incomplete data, positive growth), each with a `new|viewed|
// dismissed` lifecycle.
//
// NO STORED PROSE (claim-surface law, W3-N): titles/bodies are NEVER stored —
// the row carries only `category` + a small typed `params` jsonb of COUNTS and
// capability SLUGS (never a person id/name/email — the row type
// `TeamInsightParams` in src/lib/team-insights.ts admits only those keys, and a
// structural test pins it). Plain-English copy is rendered from
// `src/lib/team-insights-glossary.ts` at READ time, so the rendered claim lives
// in a code module, not the database.
//
// The generator (src/scoring/recompute-team-insights.ts, the poller
// score-recompute slot) is DETERMINISTIC — NO LLM (tripwire) — and derives
// every insight from existing aggregates (mastery coverage, team_capability_
// history deltas, connection freshness), MIN_PEOPLE-suppressed. Idempotent
// nightly regeneration is by the natural key below: one open insight per
// (org, team, category, subject) — a re-run overwrites in place, never appends.
// A DISMISSED insight is sticky (never resurrected under the same key).

export const teamInsightCategory = pgEnum("team_insight_category", [
  "capability_gap",
  "plateau",
  "concentration",
  "low_adoption",
  "data_incomplete",
  "positive_growth",
]);

export const teamInsightSeverity = pgEnum("team_insight_severity", [
  "info",
  "opportunity",
  "attention",
]);

export const teamInsightStatus = pgEnum("team_insight_status", [
  "new",
  "viewed",
  "dismissed",
]);

export const teamInsights = pgTable(
  "team_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    // NULL = the org-wide feed (the common case — an org IS one team for most
    // customers today, mirroring team_capability_history); non-null = a specific
    // team's feed, anchored by the composite tenant FK below.
    teamId: uuid("team_id"),
    category: teamInsightCategory("category").notNull(),
    severity: teamInsightSeverity("severity").notNull(),
    // Dedup discriminator within a category: a capability slug for
    // capability-scoped categories, "" for org-wide categories (low_adoption,
    // data_incomplete). Part of the natural key so idempotent regeneration
    // targets the right open row. Never a person identifier.
    subject: text("subject").notNull().default(""),
    // COUNT-ONLY typed params (see `TeamInsightParams`) — counts and capability
    // slugs only, NO person id/name. Rendered to prose at read time by the
    // glossary; the DB never stores a claim sentence.
    params: jsonb("params").notNull(),
    // The month-grain period the insight was generated for (display + freshness).
    periodStart: date("period_start").notNull(),
    status: teamInsightStatus("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Stamped whenever `status` changes (viewed/dismissed) — the lifecycle
    // audit axis. Distinct from createdAt so a dismissal time is recoverable.
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The natural key / regeneration conflict target: one row per
    // (org, team, category, subject). NULLS NOT DISTINCT so the org-wide feed
    // (team_id NULL) still CONFLICTS with itself on an idempotent re-run
    // (Postgres would otherwise treat two NULL team_ids as distinct and append
    // a duplicate). Same pattern as team_capability_history's period key.
    unique("team_insights_natural_uq")
      .on(t.orgId, t.teamId, t.category, t.subject)
      .nullsNotDistinct(),
    // Composite tenant FK — enforced ONLY when team_id is non-null (MATCH SIMPLE
    // skips a partially-null FK), so the org-wide feed (team_id NULL) is
    // permitted while a team-scoped row must reference a team in the SAME org. A
    // team delete cascades its insights. (org_id itself carries no FK to orgs —
    // account deletion purges these rows explicitly, ordered before `teams`,
    // mirroring team_capability_history.)
    foreignKey({
      name: "team_insights_org_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete("cascade"),
    // The feed read: this org's rows by status (list open first).
    index("team_insights_org_status_idx").on(t.orgId, t.status),
  ],
);
