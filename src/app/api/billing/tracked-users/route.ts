import { apiRoutes } from "@/contracts/api";
import { trackedUsers } from "@/lib/api-impl";
import { handleApi, parseQuery } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/billing/tracked-users — frozen billingTrackedUsers contract. */
export async function GET(req: Request) {
  return handleApi((ctx) => {
    const period = parseQuery(apiRoutes.billingTrackedUsers.request, req);
    return trackedUsers(ctx.scope, ctx.org.visibilityMode, period);
  });
}
