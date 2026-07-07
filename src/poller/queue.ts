import type { PollMessage } from "./messages";

/**
 * Cloudflare Queues `sendBatch` hard cap: at most 100 messages per call.
 * (There is also a 256 KB total-size cap per batch; a PollMessage is ~200 B,
 * so 100 × that sits well under it — revisit here if a message grows large.)
 */
export const QUEUE_BATCH_SIZE = 100;

/**
 * Enqueue many messages as one fan-out: wrap each body as a MessageSendRequest
 * and flush in Queue-sized chunks, so a fleet-wide fan-out costs ceil(n/100)
 * round-trips instead of serializing n individual `send()`s inside a single
 * scheduled invocation. An empty list sends nothing (`sendBatch([])` throws).
 *
 * Single source of truth for the batch cap + envelope shape — both the cron
 * connector dispatch and the nightly score recompute flush through here.
 */
export async function sendInBatches(
  queue: Queue,
  bodies: PollMessage[],
): Promise<void> {
  for (let i = 0; i < bodies.length; i += QUEUE_BATCH_SIZE) {
    await queue.sendBatch(
      bodies.slice(i, i + QUEUE_BATCH_SIZE).map((body) => ({ body })),
    );
  }
}
