import { apiRoutes } from "@/contracts/api";
import { getBudget, setBudget } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { todayUtc } from "@/lib/spend-governance";

export const dynamic = "force-dynamic";

/**
 * GET /api/budget — the org's budget + observed month-to-date spend + alert
 * (frozen budgetGet contract, ADR 0020). Admin-only, org-scoped. Default
 * free-band gating applies: budget data is org data behind the paywall.
 */
export async function GET() {
  return handleApi((ctx) => getBudget(ctx.scope, todayUtc()), {
    adminOnly: true,
  });
}

/** PUT /api/budget — create or replace the org's budget (frozen budgetSet
 * contract, ADR 0020). Admin-only. */
export async function PUT(req: Request) {
  return handleApi(
    async (ctx) => {
      const body = await parseBody(apiRoutes.budgetSet.request, req);
      return setBudget(ctx.scope, body);
    },
    { adminOnly: true },
  );
}
