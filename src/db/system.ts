import { inArray, lt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { rawPayloads } from "./schema";

// System-level maintenance jobs. These run across orgs by design (raw
// access is allowed only inside src/db/**) and are invoked from the queue
// consumer — never from request handlers.

/**
 * Ages out expired raw payloads in bounded batches (Workers 30s CPU
 * budget). metric_records.raw_payload_id is ON DELETE SET NULL, so aged
 * facts keep their values and lose only the replay reference — after this,
 * recompute is score-only (the stated trade-off).
 *
 * Returns the number of rows deleted; callers re-enqueue while the batch
 * came back full if they want a deeper sweep.
 */
export async function purgeExpiredRawPayloads(
  db: Db,
  { batchSize = 5000, maxBatches = 4 } = {},
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const expired = await db
      .select({ id: rawPayloads.id })
      .from(rawPayloads)
      .where(lt(rawPayloads.expiresAt, sql`now()`))
      .limit(batchSize);
    if (expired.length === 0) {
      break;
    }
    await db.delete(rawPayloads).where(
      inArray(
        rawPayloads.id,
        expired.map((r) => r.id),
      ),
    );
    deleted += expired.length;
    if (expired.length < batchSize) {
      break;
    }
  }
  return deleted;
}
