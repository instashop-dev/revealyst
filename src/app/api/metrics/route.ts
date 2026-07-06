import { apiRoutes } from "@/contracts/api";
import { metricsSeries } from "@/lib/api-impl";
import { handleApi, parseQuery } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/metrics — frozen metricsSeries contract. */
export async function GET(req: Request) {
  return handleApi((ctx) => {
    const filter = parseQuery(apiRoutes.metricsSeries.request, req);
    return metricsSeries(ctx.scope, filter);
  });
}
