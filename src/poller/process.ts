import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { orgs } from "../db/schema";
import {
  SYSTEM_ORG_ID,
  SYSTEM_ORG_NAME,
  type PollMessage,
} from "./messages";

/** Idempotently ensures the system org exists (safe under concurrent consumers). */
export async function ensureSystemOrg(db: Db) {
  await db
    .insert(orgs)
    .values({ id: SYSTEM_ORG_ID, name: SYSTEM_ORG_NAME })
    .onConflictDoNothing({ target: orgs.id });
}

/**
 * Handles one poll message. The no-op poll writes a heartbeat row through
 * the org-scoped layer — proving Cron → Queue → consumer → Postgres without
 * touching any vendor API.
 */
export async function processPollMessage(db: Db, message: PollMessage) {
  switch (message.kind) {
    case "noop-poll": {
      if (message.orgId === SYSTEM_ORG_ID) {
        await ensureSystemOrg(db);
      }
      return forOrg(db, message.orgId).heartbeats.record();
    }
  }
}
