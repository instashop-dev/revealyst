import { listPeople } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/people — frozen peopleList contract (privacy by shape). */
export async function GET() {
  return handleApi((ctx) => listPeople(ctx.scope, ctx.org.visibilityMode));
}
