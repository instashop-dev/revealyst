import { z } from "zod";
import {
  MAX_TEAM_WORKSPACES_PER_USER,
  provisionTeamWorkspace,
  TeamWorkspaceCapError,
} from "@/db/org-provisioning";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import { teamWorkspaceCapMessage } from "@/lib/team-onboarding-copy";

export const dynamic = "force-dynamic";

// POST /api/workspaces — the USER-FACING team-workspace creation flow (D-ONB-1).
// Any signed-in, non-impersonated user may create a team workspace and becomes
// its admin (every user is admin of their own personal workspace, so "workspace
// admins can create team workspaces" means, in practice, any authenticated
// user). Kept as its own route rather than folded into /api/org/workspaces:
// that surface's POST already means "switch the active workspace", and a create
// is a distinct resource action (POST a new workspace) — one POST per meaning
// reads cleaner than overloading the switch route by body shape.
//
// Mirrors the platform-admin route (/api/admin/team-workspaces) but for real
// users, and bottoms out in the SAME provisionTeamWorkspace transaction, so the
// two paths can never diverge on org shape.
//
// - handleApi: 401 for signed-out (no session).
// - Impersonation → 403, mirroring the switch route's exact detection: a
//   platform admin wearing a user's hat must not create a persistent org owned
//   by that user's session.
// - allowOverFreeBand: true — a user whose CURRENT workspace is over the free
//   band must not be trapped. The NEW org starts empty with its own free band,
//   so creating it exposes no gated data.
// - Per-user creation cap (MAX_TEAM_WORKSPACES_PER_USER, ADR 0052): counts
//   workspaces the user CREATED (orgs.created_by_user_id), never invited-admin
//   memberships. Enforced INSIDE the provisioning transaction under a per-user
//   advisory lock, so concurrent requests at cap−1 serialize instead of all
//   passing a pre-check. At the cap, a plain-English 403 states the fact (no
//   impossible remediation — there is no leave-workspace affordance). The
//   platform-admin seam stays uncapped.
// - The creator is derived from the session (ctx.user.id) — never from the body,
//   so there is no mass-assignment path to enroll someone else as admin.

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      if (ctx.session.session.impersonatedBy) {
        throw new ApiError(403, "forbidden while impersonating");
      }
      const body = await parseBody(createSchema, req);
      try {
        return await provisionTeamWorkspace(ctx.db, {
          name: body.name,
          creatorUserId: ctx.user.id,
          cap: MAX_TEAM_WORKSPACES_PER_USER,
        });
      } catch (error) {
        if (error instanceof TeamWorkspaceCapError) {
          throw new ApiError(403, teamWorkspaceCapMessage(error.cap));
        }
        throw error;
      }
    },
    { allowOverFreeBand: true },
  );
}
