import type { DateWindow } from "../contracts/connector";

// Chunked, resumable backfill planning (W1-D's riskiest piece, per the
// workflow doc). Cloudflare Queues give a consumer minutes, not hours, so a
// 30–90-day backfill is NEVER one message: it is a cursor-chain of small
// messages, each covering a day-range whose worst-case vendor-call count is
// bounded by construction. The wall-time budget test in
// tests/connector-framework.test.ts enforces these numbers in CI.

/**
 * Hard ceiling of vendor API calls one queue message may perform. With the
 * conservative per-call latency model below this keeps a message comfortably
 * inside the Queue consumer budget even with retry-after pauses.
 */
export const MAX_CALLS_PER_MESSAGE = 16;

/**
 * Wall-time budget for processing ONE queue message end-to-end. The CI
 * budget test fails if a worst-case chunk (MAX_CALLS_PER_MESSAGE calls at
 * EXPECTED_CALL_LATENCY_MS each + normalization + upserts) exceeds this.
 * 60s/message × max_batch_size 10 stays inside the 15-min consumer limit.
 */
export const WALL_TIME_BUDGET_MS = 60_000;

/** Conservative per-vendor-call latency the budget test models (p95-ish). */
export const EXPECTED_CALL_LATENCY_MS = 2_000;

/** Default backfill depth when a vendor documents no floor (spec: 30–90d). */
export const DEFAULT_BACKFILL_DAYS = 90;

/** Days one chunk covers so worst-case calls stay under the ceiling. */
export function chunkDaysFor(maxCallsPerDay: number): number {
  if (maxCallsPerDay <= 0) {
    throw new Error(`maxCallsPerDay must be positive, got ${maxCallsPerDay}`);
  }
  const days = Math.floor(MAX_CALLS_PER_MESSAGE / maxCallsPerDay);
  // A vendor needing more calls per day than the ceiling still gets one
  // day per message — the per-message call count is then that vendor's
  // documented per-day cost, which the budget test flags if excessive.
  return Math.max(1, Math.min(days, 31));
}

/** UTC day arithmetic on YYYY-MM-DD strings (no clock, no timezone). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start: string, end: string): number {
  const ms =
    new Date(`${end}T00:00:00Z`).getTime() -
    new Date(`${start}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * The whole chain, up front — used by tests and by dispatch to reason about
 * chunk boundaries. At runtime the chain is not enqueued at once: each
 * message computes ITS chunk from (window, cursorStart, chunkDays) and
 * enqueues only the next cursor, so a mid-chain failure resumes from its
 * own message re-delivery, not from a re-plan.
 */
export function planBackfillChunks(
  window: DateWindow,
  chunkDays: number,
): DateWindow[] {
  if (window.start > window.end) {
    throw new Error(
      `backfill window is inverted: ${window.start} > ${window.end}`,
    );
  }
  const chunks: DateWindow[] = [];
  let cursor = window.start;
  while (cursor <= window.end) {
    const chunkEnd = addDays(cursor, chunkDays - 1);
    chunks.push({
      start: cursor,
      end: chunkEnd < window.end ? chunkEnd : window.end,
    });
    cursor = addDays(cursor, chunkDays);
  }
  return chunks;
}

/** The single chunk a backfill message covers (oldest → newest). */
export function chunkForCursor(
  window: DateWindow,
  cursorStart: string,
  chunkDays: number,
): DateWindow {
  const chunkEnd = addDays(cursorStart, chunkDays - 1);
  return {
    start: cursorStart,
    end: chunkEnd < window.end ? chunkEnd : window.end,
  };
}
