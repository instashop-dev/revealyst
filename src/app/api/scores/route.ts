import { apiRoutes } from "@/contracts/api";
import { listScores } from "@/lib/api-impl";
import { handleApi, parseQuery } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/scores — frozen scoresList contract. */
export async function GET(req: Request) {
  return handleApi((ctx) => {
    const filter = parseQuery(apiRoutes.scoresList.request, req);
    return listScores(ctx.scope, ctx.org.visibilityMode, filter);
  });
}
