// Queue message contract for the polling pipeline. W0-B carries only the
// no-op heartbeat poll; W1-D extends this with real connector polls (one
// message per connection, chunked backfill ranges).
export type PollMessage = {
  kind: "noop-poll";
  orgId: string;
};

// Fixed system org the skeleton heartbeat runs under until real orgs exist
// (created idempotently by the consumer).
export const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const SYSTEM_ORG_NAME = "revealyst-system";
