import { apiRoutes } from "@/contracts/api";
import { setPersonRole } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * PUT /api/people/:id/role — frozen roleAssignmentSet contract (W6-B, ADR 0030).
 * Assign, reassign (non-null `roleSlug`), or unassign (null) a tracked person's
 * engineering role. Admin-only org config (a manager assigns roles) — a
 * non-admin gets 403, mirroring /settings; the Settings page renders the control
 * for admins only, so the mutation is double-gated. The per-field audit entry
 * and role/person validation live in `setPersonRole`.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const body = await parseBody(apiRoutes.roleAssignmentSet.request, req);
      return setPersonRole(ctx.scope, {
        personId: id,
        roleSlug: body.roleSlug,
        actorUserId: ctx.user.id,
      });
    },
    { adminOnly: true },
  );
}
