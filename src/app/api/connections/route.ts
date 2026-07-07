import { apiRoutes } from "@/contracts/api";
import { createConnection, listConnections } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/connections — frozen connectionsList contract. */
export async function GET() {
  return handleApi((ctx) => listConnections(ctx.scope));
}

/** POST /api/connections — frozen connectionsCreate contract. */
export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    const body = await parseBody(apiRoutes.connectionsCreate.request, req);
    const res = await createConnection(ctx.scope, body);
    await ctx.scope.auditLog.record({
      actorUserId: ctx.user.id,
      action: "connection.create",
      targetKind: "connection",
      targetId: res.connection.id,
      metadata: { vendor: body.vendor },
    });
    return res;
  });
}
