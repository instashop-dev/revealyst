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
      return createTeam(ctx.scope, body.name);
    },
    { adminOnly: true },
  );
}
