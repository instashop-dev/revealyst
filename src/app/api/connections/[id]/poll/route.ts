// Populate the connector registry in THIS route's module graph — api-impl
// only imports the registry, and under plain `next dev` (no worker.ts) a
// route served before any page would otherwise find it empty and 400.
import "@/connectors";
import { pollConnection } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** POST /api/connections/:id/poll — frozen connectionsPoll contract.
 * Enqueues the first backfill (once) + a poll for this connection so
 * onboarding doesn't wait for the next cron tick. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    const res = await pollConnection(ctx.scope, id, {
      send: async (message, opts) => {
        await ctx.env.POLL_QUEUE.send(
          message,
          opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined,
        );
      },
    });
    await ctx.scope.auditLog.record({
      actorUserId: ctx.user.id,
      action: "connection.poll",
      targetKind: "connection",
      targetId: id,
    });
    return res;
  });
}
