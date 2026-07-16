import { dismissTeamInsight } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * POST /api/team-insights/:id/dismiss (TCI Phase 2-F, ADR 0050) — dismiss one
 * aggregate manager insight. Authorization (admin OR team manager; member 403s)
 * lives in `dismissTeamInsight`, not `handleApi`'s `adminOnly` gate, because a
 * non-admin manager may also dismiss. Default free-band paywall applies (team
 * data behind the paywall). Org-scoped by `ctx.scope`.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi((ctx) =>
    dismissTeamInsight(
      { scope: ctx.scope, role: ctx.role, actorUserId: ctx.user.id },
      id,
    ),
  );
}
