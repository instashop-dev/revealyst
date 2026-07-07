import { apiRoutes } from "@/contracts/api";
import { putTeamMembers } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** PUT /api/teams/:id/members — frozen teamsPutMembers contract. Admin-only. */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const body = await parseBody(apiRoutes.teamsPutMembers.request, req);
      const res = await putTeamMembers(ctx.scope, id, body.personIds);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "team.set_members",
        targetKind: "team",
        targetId: id,
        metadata: { memberCount: body.personIds.length },
      });
      return res;
    },
    { adminOnly: true },
  );
}
