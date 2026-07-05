import { listConnections } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/connections — frozen connectionsList contract. */
export async function GET() {
  return handleApi((ctx) => listConnections(ctx.scope));
}
