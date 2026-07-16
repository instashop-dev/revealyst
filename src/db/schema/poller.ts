import { sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { connections } from "./connections";
import { orgs } from "./core";

// One row per successful no-op poll job — proves Cron Trigger → Queue →
// consumer → Postgres end-to-end (the W0 exit-gate heartbeat).
export const pollHeartbeats = pgTable(
  "poll_heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    source: text("source").notNull().default("noop-poller"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    // Serves BOTH the /api/health top-1 read (latestHeartbeatAt orders by
    // observed_at DESC) and the retention purge (W4-Q: delete where observed_at
    // < cutoff) — without it both are seqscans over an ever-growing log
    // (ADR 0020). observed_at only; heartbeats are system telemetry read/purged
    // across orgs, never per-org, so no org_id lead column is needed.
    index("poll_heartbeats_observed_at_idx").on(t.observedAt),
  ],
);

// One row per connector poll / backfill-chunk attempt (ADR 0005, W1-D).
// The "last synced 2h ago" source of truth and the backfill audit trail:
// resume state is derived from these rows + the queue-message cursor, so no
// separate cursor table exists. `gaps` carries the run's HonestyGap[] —
// degraded attribution is surfaced, never papered over (invariant b).
export const connectorRuns = pgTable(
  "connector_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    // "agent_ingest" (ADR 0025): one row per accepted Revealyst Agent push —
    // the gap sink the dashboard readers collect from. Type-level enum on a
    // plain text column; no SQL migration.
    kind: text("kind", { enum: ["poll", "backfill", "agent_ingest"] }).notNull(),
    status: text("status", { enum: ["running", "success", "error"] })
      .notNull()
      .default("running"),
    // The UTC day window this run covered (chunk window for backfill).
    windowStart: date("window_start", { mode: "string" }),
    windowEnd: date("window_end", { mode: "string" }),
    // Queue delivery attempt that produced this row (retries append rows —
    // the log is per attempt, never overwritten).
    attempt: integer("attempt").notNull().default(1),
    subjectsSeen: integer("subjects_seen"),
    recordsUpserted: integer("records_upserted"),
    signalsUpserted: integer("signals_upserted"),
    gaps: jsonb("gaps").notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // Anchor for composite tenant FKs, per D1a — kept even without child
    // tables today so the shape matches every other org-scoped table.
    unique("connector_runs_org_id_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "connector_runs_org_connection_fk",
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    index("connector_runs_org_conn_started_idx").on(
      t.orgId,
      t.connectionId,
      t.startedAt,
    ),
  ],
);
