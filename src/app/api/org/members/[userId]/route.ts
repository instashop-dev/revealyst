import { removeOrgMember } from "@/db/membership";
import { ApiError } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// Plain-English refusals for each guard removeOrgMember reports. `not_member`
// maps to 404 separately (also the cross-org guard: an admin of another org
// targeting this org's member never matches the org-scoped membership row).
const REASON_COPY = {
  self: 'You can’t remove yourself here. Use "Leave workspace" instead.',
  owner: "You can’t remove the workspace owner.",
  last_admin:
    "This is the workspace's only admin. Make someone else an admin first.",
} as const;

/** DELETE /api/org/members/:userId — an admin removes another member's login
 * from this workspace (their own org, ctx.org.id). Admin-only; the target keeps
 * their account and can be invited back. allowOverFreeBand: removing members must
 * work while the org is over the free band (it is how an admin trims the roster).
 * Impersonated admins are blocked — a support session must not evict members. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return handleApi(
    async (ctx) => {
      if (ctx.session.session.impersonatedBy) {
        throw new ApiError(403, "forbidden while impersonating");
      }
      const outcome = await removeOrgMember(ctx.db, {
        orgId: ctx.org.id,
        targetUserId: userId,
        actorUserId: ctx.user.id,
      });
      if (!outcome.ok) {
        if (outcome.reason === "not_member") {
          throw new ApiError(404, "member not found");
        }
        throw new ApiError(400, REASON_COPY[outcome.reason]);
      }
      return { ok: true };
    },
    { adminOnly: true, allowOverFreeBand: true },
  );
}
