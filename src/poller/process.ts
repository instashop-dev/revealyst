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
      await recomputeOrg(db, message.orgId, {
        period: periodFor("month", message.day),
      });
      await recomputeOrg(db, message.orgId, {
        period: periodFor("rolling_28d", message.day),
      });
      return;
    }
  }
}
