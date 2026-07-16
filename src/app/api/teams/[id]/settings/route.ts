import { z } from "zod";
import { setTeamSettings } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// PATCH /api/teams/:id/settings — per-team admin settings (ADR 0045 spend half,
// D-TCI-2). Today the one setting is `managersSeeIndividualCost`: the gate that
// lets a team's managers see a managed member's per-person spend by name (default
// OFF). Admin-only org config — a non-admin (including a manager, who is still
// role "member") gets 403, exactly like /api/teams/:id/managers. Local zod schema
// (additive route, no frozen contracts/api change). `allowOverFreeBand` so an
// admin can always turn the toggle OFF, even for a paywalled org.
const teamSettingsBody = z.object({
  managersSeeIndividualCost: z.boolean(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const body = await parseBody(teamSettingsBody, req);
      return setTeamSettings(
        { scope: ctx.scope },
        {
          teamId: id,
          managersSeeIndividualCost: body.managersSeeIndividualCost,
          actorUserId: ctx.user.id,
        },
      );
    },
    { adminOnly: true, allowOverFreeBand: true },
  );
}
