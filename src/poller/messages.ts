import type { DateWindow } from "../contracts/connector";

// Queue message contract for the polling pipeline. W0-B carries the no-op
// heartbeat poll; W0-C adds the raw-landing-zone purge; W1-D adds real
// connector polls (one message per connection per due window) and chunked,
// resumable backfill (one message per day-range, cursor-chained so no
// single message can blow the Queue wall-time budget).
export type PollMessage =
  | {
      kind: "noop-poll";
      orgId: string;
    }
  | {
      // Ages out expired raw_payloads rows in bounded batches (system-level
      // job — runs across orgs inside src/db/system.ts).
      kind: "purge-raw";
    }
  | {
      // W4-Q: ages out expired audit_log / poll_heartbeats / connector_runs
      // rows on their retention windows, in bounded batches (system-level job
      // — runs across orgs inside src/db/system.ts). Sent once nightly.
      kind: "purge-retention";
    }
  | {
      // One regular poll of one connection over one restatement window.
      kind: "connector-poll";
      orgId: string;
      connectionId: string;
      window: DateWindow;
      /** Chain a score-recompute after the ingest lands (manual "Sync now"
       * and the connect-flow poll — cron polls leave it unset and rely on
       * the nightly recompute). Consumer-side so ordering is guaranteed. */
      recompute?: boolean;
    }
  | {
      // One backfill CHUNK: processes [cursorStart, cursorStart+chunkDays-1]
      // ∩ window, then enqueues the next chunk message. Resumable: progress
      // lives in connector_runs + this cursor, and every write is an
      // idempotent upsert, so re-delivery or resume re-covers days safely.
      kind: "connector-backfill";
      orgId: string;
      connectionId: string;
      /** The full backfill window (fixed across the whole chain). */
      window: DateWindow;
      /** First day this chunk covers (YYYY-MM-DD, UTC). */
      cursorStart: string;
      /** Days per chunk — chosen at dispatch from the vendor's call budget. */
      chunkDays: number;
    }
  | {
      // W1-F: recompute all active score definitions for one org. Sent
      // nightly (one message per org, anchored at yesterday UTC) and
      // on-demand after a backfill lands; idempotent on the frozen
      // score_results upsert key either way.
      kind: "score-recompute";
      orgId: string;
      /** UTC calendar day anchoring the periods (YYYY-MM-DD). */
      day: string;
    }
  | {
      // W3-M PR5: reports one org's current tracked_user count to Paddle as the
      // subscription's seat quantity. Sent daily (one message per active/
      // trialing subscription); a no-op when the count is unchanged, so
      // re-delivery is harmless.
      kind: "meter-subscription";
      orgId: string;
      paddleSubscriptionId: string;
      priceId: string;
    }
  | {
      // F2.2: assembles and sends one org's weekly digest email. Sent weekly
      // (one message per org, Monday 14:00 UTC). Idempotent on the prefs row's
      // last_sent_week compare-and-set, so an at-least-once redelivery for the
      // same ISO week does not re-send.
      kind: "digest-weekly";
      orgId: string;
    }
  | {
      // W5-I §14: emails the platform admins the weekly flywheel/adoption
      // funnel report. ONE system-level message per week (Monday 15:00 UTC),
      // NOT per org — the report is a cross-org aggregate. A redelivery
      // re-sends the same aggregate email (no state mutation).
      kind: "flywheel-report";
    };

export type ConnectorPollMessage = Extract<
  PollMessage,
  { kind: "connector-poll" }
>;
export type ConnectorBackfillMessage = Extract<
  PollMessage,
  { kind: "connector-backfill" }
>;

// Fixed system org the skeleton heartbeat runs under until real orgs exist
// (created idempotently by the consumer).
export const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const SYSTEM_ORG_NAME = "revealyst-system";
