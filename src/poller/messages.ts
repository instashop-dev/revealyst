// Queue message contract for the polling pipeline. W0-B carries the no-op
// heartbeat poll; W0-C adds the raw-landing-zone purge; W1-D extends this
// with real connector polls (one message per connection, chunked backfill
// ranges).
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
      // W1-F: recompute all active score definitions for one org. Sent
      // nightly (one message per org, anchored at yesterday UTC) and
      // on-demand after a backfill lands; idempotent on the frozen
      // score_results upsert key either way.
      kind: "score-recompute";
      orgId: string;
      /** UTC calendar day anchoring the periods (YYYY-MM-DD). */
      day: string;
    };

// Fixed system org the skeleton heartbeat runs under until real orgs exist
// (created idempotently by the consumer).
export const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const SYSTEM_ORG_NAME = "revealyst-system";
