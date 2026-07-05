import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import {
  ensureSystemOrg as ensureSystemOrgRow,
  purgeExpiredRawPayloads,
} from "../db/system";
import {
  SYSTEM_ORG_ID,
  SYSTEM_ORG_NAME,
  type PollMessage,
} from "./messages";
import {
  runConnectorBackfill,
  runConnectorPoll,
  type PollDeps,
} from "./run";

/** Idempotently ensures the system org exists (safe under concurrent consumers). */
export async function ensureSystemOrg(db: Db) {
  await ensureSystemOrgRow(db, SYSTEM_ORG_ID, SYSTEM_ORG_NAME);
}

/**
 * Handles one poll message. The no-op poll writes a heartbeat row through
 * the org-scoped layer — proving Cron → Queue → consumer → Postgres without
 * touching any vendor API. Connector messages (W1-D) run one poll or one
 * backfill chunk; they need `deps` (credential env + queue producer), which
 * only the Worker consumer supplies.
 */
export async function processPollMessage(
  db: Db,
  message: PollMessage,
  deps?: PollDeps,
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
    case "connector-poll": {
      await runConnectorPoll(db, message, requireDeps(deps, message.kind));
      return;
    }
    case "connector-backfill": {
      await runConnectorBackfill(db, message, requireDeps(deps, message.kind));
      return;
    }
  }
}

function requireDeps(deps: PollDeps | undefined, kind: string): PollDeps {
  if (!deps) {
    throw new Error(`${kind} messages require poll deps (worker consumer)`);
  }
  return deps;
}
