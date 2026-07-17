import { z } from "zod";
import { membershipsForUser, switchActiveOrg } from "@/db/org-context";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// The user's workspaces + a switch action. Non-frozen route (colocated schema).
// allowOverFreeBand: switching must work even when the CURRENT workspace is over
// the free band — otherwise a blocked org would trap the user with no way to
// switch away to another workspace. This reads/writes only the caller's OWN
// org_members rows (their memberships), so there is no cross-tenant exposure:
// the free-band paywall is about entitlement to a workspace's data, which this
// route never returns.

/** GET /api/org/workspaces — the orgs the signed-in user belongs to, active
 * (most-recent membership, ADR 0004) first. Drives the sidebar switcher menu. */
export async function GET() {
  return handleApi(
    async (ctx) => {
      const rows = await membershipsForUser(ctx.db, ctx.user.id);
      return {
        activeOrgId: ctx.org.id,
        workspaces: rows.map((r) => ({
          id: r.orgId,
          name: r.orgName,
          kind: r.orgKind,
        })),
      };
    },
    { allowOverFreeBand: true },
  );
}

const switchSchema = z.object({ orgId: z.string().uuid() });

/** POST /api/org/workspaces — switch the active workspace. Rides ADR 0004's
 * most-recent-membership rule (bumps the chosen membership to now). 404 when the
 * caller is not a member of the target — the same status an unknown org yields,
 * so it can't be used to probe org existence. */
export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      const body = await parseBody(switchSchema, req);
      const switched = await switchActiveOrg(ctx.db, ctx.user.id, body.orgId);
      if (!switched) {
        throw new ApiError(404, "workspace not found");
      }
      return { ok: true, activeOrgId: body.orgId };
    },
    { allowOverFreeBand: true },
  );
}
