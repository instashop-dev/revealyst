import { apiRoutes } from "@/contracts/api";
import { dashboardSummary } from "@/lib/api-impl";
import { handleApi, parseQuery } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/summary — frozen dashboardSummary contract. */
export async function GET(req: Request) {
  return handleApi((ctx) => {
    const period = parseQuery(apiRoutes.dashboardSummary.request, req);
    return dashboardSummary(ctx.scope, ctx.org.visibilityMode, period);
  });
}
