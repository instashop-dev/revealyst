import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { subscriptionsForOrg } from "../db/subscriptions";
import {
  ensureSystemOrg as ensureSystemOrgRow,
  purgeExpiredRawPayloads,
  purgeExpiredRetention,
} from "../db/system";
import { meterSubscription } from "../metering/meter";
import { periodFor, recomputeOrg } from "../scoring";
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
    case "purge-retention": {
      const result = await purgeExpiredRetention(db);
      // A run is bounded (batchSize × maxBatches per table) to stay inside the
      // Workers CPU budget; if it hit that cap, more expired rows remain, so
      // re-enqueue to drain the backlog across successive runs rather than
      // letting a high-volume table outpace one nightly pass. Only when the
      // worker consumer supplied a queue producer (deps.send).
      if (result.capped && deps?.send) {
        await deps.send({ kind: "purge-retention" });
      }
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
      // §8.5 guardrail 5: resolve Team entitlement ONCE and thread it into
      // both recompute passes — a lapsed org's custom indexes stop
      // recomputing (last results persist for a "paused" render); presets are
      // unaffected. One subscription read instead of one per period.
      const customIndexesEntitled =
        (await subscriptionsForOrg(db, message.orgId).current()).plan === "team";
      await recomputeOrg(db, message.orgId, {
        period: month,
        customIndexesEntitled,
      });
      if (
        rolling.periodStart !== month.periodStart ||
        rolling.periodEnd !== month.periodEnd
      ) {
        await recomputeOrg(db, message.orgId, {
          period: rolling,
          customIndexesEntitled,
        });
      }
      return;
    }
    case "meter-subscription": {
      const d = requireDeps(deps, message.kind);
      if (!d.paddleConfig) {
        throw new Error("meter-subscription requires Paddle config (worker consumer)");
      }
      await meterSubscription(db, d.paddleConfig, message);
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
