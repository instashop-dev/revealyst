import { apiRoutes } from "@/contracts/api";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

// POST /api/missions/start (W7-5, ADR 0037). The person's own opt-in to a
// mission — SELF-VIEW: the tracked person is resolved from the SESSION (never a
// request param), so a caller can only start a mission for themselves. There is
// no "complete" route: completion is a measured capability crossing detected by
// the nightly reducer (Spec V4 §8.4). Write-only; only `ok` returns.
export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    const body = await parseBody(apiRoutes.missionStart.request, req);

    // The mission must be a real, active catalog entry — an unknown slug is a
    // client bug, not a row to store (the FK is the backstop).
    const { missions } = await ctx.scope.missions.catalog();
    if (!missions.some((m) => m.slug === body.missionSlug)) {
      throw new ApiError(400, "unknown mission");
    }

    // Resolve the caller's OWN tracked person from the session — never a param.
    const person = (await ctx.scope.people.list()).find(
      (p) => p.authUserId === ctx.user.id,
    );
    if (!person) {
      throw new ApiError(400, "you are not a tracked person in this workspace");
    }

    await ctx.scope.missions.start(person.id, body.missionSlug);
    return { ok: true as const };
  });
}
