import { getConnector } from "../connectors/registry";
import type { Db } from "../db/client";
import { listConnectorWorkCandidates } from "../db/system";
import {
  addDays,
  chunkDaysFor,
  DEFAULT_BACKFILL_DAYS,
} from "./backfill";
import type { PollMessage } from "./messages";

// Cron → Queue dispatch (rule: one queue message per connection). Runs
// every cron tick; enqueues (a) the backfill chain-start once per new
// connection, and (b) a regular poll whenever the vendor's interval has
// elapsed. A message enqueued-but-unprocessed for a whole tick can be
// dispatched twice — harmless (idempotent upserts), bounded to one
// duplicate by the 5-min cron vs ≥15-min intervals.

export type DispatchDeps = {
  send: (message: PollMessage) => Promise<void>;
  now?: () => Date;
  /** Test seam: overrides the vendor registry. */
  resolveConnector?: typeof getConnector;
};

export async function dispatchDueConnectorWork(
  db: Db,
  deps: DispatchDeps,
): Promise<number> {
  const resolve = deps.resolveConnector ?? getConnector;
  const now = (deps.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);
  const candidates = await listConnectorWorkCandidates(db);
  let sent = 0;

  for (const c of candidates) {
    const entry = resolve(c.vendor);
    if (!entry) {
      continue; // vendor module not shipped yet (W2-J vendors)
    }
    const caps = entry.connector.capabilities;

    if (!c.backfillStarted) {
      // First connect: trailing 30–90 days, chunked so no message exceeds
      // the vendor's per-message call budget (<10-min first-insight path).
      const depth = Math.min(
        caps.maxBackfillDays ?? DEFAULT_BACKFILL_DAYS,
        DEFAULT_BACKFILL_DAYS,
      );
      const window = { start: addDays(today, -(depth - 1)), end: today };
      await deps.send({
        kind: "connector-backfill",
        orgId: c.orgId,
        connectionId: c.connectionId,
        window,
        cursorStart: window.start,
        chunkDays: chunkDaysFor(entry.maxCallsPerDay),
      });
      sent++;
    }

    const duePoll =
      !c.lastPolledAt ||
      now.getTime() - c.lastPolledAt.getTime() >=
        entry.pollIntervalMinutes * 60_000;
    if (duePoll) {
      // Regular poll re-covers the restatement window — vendors restate
      // recent days, and the upsert key makes re-polls overwrite.
      await deps.send({
        kind: "connector-poll",
        orgId: c.orgId,
        connectionId: c.connectionId,
        window: {
          start: addDays(today, -caps.restatementWindowDays),
          end: today,
        },
      });
      sent++;
    }
  }
  return sent;
}
