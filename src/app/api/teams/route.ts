import { apiRoutes } from "@/contracts/api";
import { createTeam, listTeams } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/teams — frozen teamsList contract. */
export async function GET() {
  return handleApi((ctx) => listTeams(ctx.scope));
}

/** POST /api/teams — frozen teamsCreate contract. Admin-only. */
export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      const body = await parseBody(apiRoutes.teamsCreate.request, req);
      const res = await createTeam(ctx.scope, body.name);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "team.create",
        targetKind: "team",
        targetId: res.id,
        metadata: { name: res.name },
      });
      return res;
    },
    { adminOnly: true },
  );
}
