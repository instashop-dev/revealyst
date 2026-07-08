import { apiRoutes } from "@/contracts/api";
import { deleteConnection, updateConnection } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { previousDay } from "@/scoring";

export const dynamic = "force-dynamic";

/** PATCH /api/connections/:id — frozen connectionsUpdate contract (ADR 0013).
 * Rename and/or pause-resume. Admin-only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const body = await parseBody(apiRoutes.connectionsUpdate.request, req);
      const res = await updateConnection(ctx.scope, id, body);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "connection.update",
        targetKind: "connection",
        targetId: id,
        metadata: {
          fields: Object.keys(body),
          ...(body.status ? { status: body.status } : {}),
        },
      });
      return res;
    },
    { adminOnly: true },
  );
}

/** DELETE /api/connections/:id — frozen connectionsDelete contract
 * (implemented under ADR 0013). Transactionally removes the connection's
 * ingested metric_records (the NO ACTION FK blocks the row delete otherwise),
 * then the cascades take the credential, subjects and their records, raw
 * payloads, and run history. Admin-only. Exempt from the free-band 402: it is
 * the usage-REDUCING action an over-limit org needs to get back under the
 * band — gating it would lock unpaid orgs out of removing their own data. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      // Read before delete so the audit row can say WHAT was destroyed.
      const existing = await ctx.scope.connections.get(id);
      const res = await deleteConnection(ctx.scope, id);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "connection.delete",
        targetKind: "connection",
        targetId: id,
        // undefined values drop out of the JSON metadata; `existing` can
        // only be undefined if the row appeared between get and delete.
        metadata: {
          vendor: existing?.vendor,
          displayName: existing?.displayName,
        },
      });
      // Scores were computed from data that no longer exists — recompute now
      // instead of serving stale numbers until the nightly cron (invariant b).
      // Best-effort: the delete already committed; a lost message self-heals
      // at the next nightly recompute.
      try {
        await ctx.env.POLL_QUEUE.send({
          kind: "score-recompute",
          orgId: ctx.scope.orgId,
          day: previousDay(new Date().toISOString().slice(0, 10)),
        });
      } catch (error) {
        console.warn(
          `score-recompute enqueue after connection delete failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return res;
    },
    { adminOnly: true, allowOverFreeBand: true },
  );
}
