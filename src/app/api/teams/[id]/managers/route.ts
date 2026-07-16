import { z } from "zod";
import { setTeamManager } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// D-TCI-3 (ADR 0044): assign/remove a team manager. Admin-only org config — a
// non-admin (including a manager, who is still role "member") gets 403. The
// request body is validated locally rather than via the frozen `contracts/api`
// surface (no ADR-gated contract change): a single member user id.
const managerBody = z.object({ userId: z.string().min(1) });

/** POST /api/teams/:id/managers — make an org member a manager of the team. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const body = await parseBody(managerBody, req);
      return setTeamManager(
        { db: ctx.db, scope: ctx.scope },
        {
          teamId: id,
          userId: body.userId,
          action: "add",
          actorUserId: ctx.user.id,
        },
      );
    },
    { adminOnly: true },
  );
}

/** DELETE /api/teams/:id/managers — remove a manager grant from the team. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const body = await parseBody(managerBody, req);
      return setTeamManager(
        { db: ctx.db, scope: ctx.scope },
        {
          teamId: id,
          userId: body.userId,
          action: "remove",
          actorUserId: ctx.user.id,
        },
      );
    },
    { adminOnly: true },
  );
}
