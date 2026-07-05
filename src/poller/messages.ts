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
      // One regular poll of one connection over one restatement window.
      kind: "connector-poll";
      orgId: string;
      connectionId: string;
      window: DateWindow;
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
