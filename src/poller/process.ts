import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import {
  ensureSystemOrg as ensureSystemOrgRow,
  purgeExpiredRawPayloads,
} from "../db/system";
import { periodFor, recomputeOrg } from "../scoring";
import {
  SYSTEM_ORG_ID,
  SYSTEM_ORG_NAME,
  type PollMessage,
} from "./messages";

/** Idempotently ensures the system org exists (safe under concurrent consumers). */
export async function ensureSystemOrg(db: Db) {
  await ensureSystemOrgRow(db, SYSTEM_ORG_ID, SYSTEM_ORG_NAME);
}

/**
 * Handles one poll message. The no-op poll writes a heartbeat row through
 * the org-scoped layer — proving Cron → Queue → consumer → Postgres without
 * touching any vendor API.
 */
export async function processPollMessage(
  db: Db,
  message: PollMessage,
): Promise<void> {
  switch (message.kind) {
    case "noop-poll": {
      if (message.orgId === SYSTEM_ORG_ID) {
        await ensureSystemOrg(db);
      }
      await forOrg(db, message.orgId).heartbeats.record();
      return;
    }
    case "purge-raw": {
      await purgeExpiredRawPayloads(db);
      return;
    }
    case "score-recompute": {
      // Month covers the dashboard grain; rolling_28d gives the trailing
      // window. Both upsert on the frozen key, so re-delivery is harmless.
      // That key is (org, definition, subject, period bounds) WITHOUT the
      // grain — one result per subject+bounds by design — so when the two
      // periods coincide (Feb 28 anchor in a non-leap year: Feb 1..28 is
      // both the month and the trailing 28 days) only the month write runs;
      // writing both would flip February's grain label to rolling_28d.
      const month = periodFor("month", message.day);
      const rolling = periodFor("rolling_28d", message.day);
      await recomputeOrg(db, message.orgId, { period: month });
      if (
        rolling.periodStart !== month.periodStart ||
        rolling.periodEnd !== month.periodEnd
      ) {
        await recomputeOrg(db, message.orgId, { period: rolling });
      }
      return;
    }
  }
}
