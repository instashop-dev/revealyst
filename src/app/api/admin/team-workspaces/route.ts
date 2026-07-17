import { z } from "zod";
import { createTeamWorkspace } from "@/db/admin";
import { handleAdminApi } from "@/lib/admin-context";
import { parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// POST /api/admin/team-workspaces — platform-admin-only (ADR 0016). Creates a
// new org with kind='team' and enrolls the requesting admin as its org admin
// (the only path that ever sets orgs.kind='team'; ensureOrgOfOne makes personal
// orgs only). Non-frozen route (colocated schema, same precedent as
// /api/admin/audit — src/contracts/api.ts stays untouched). handleAdminApi
// rejects non-admin (403), impersonating (403), and signed-out (401) callers
// before this body runs. Deliberately admin-only; the user-facing team
// onboarding flow is a separate, still-open product decision.
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function POST(req: Request) {
  return handleAdminApi(async (ctx) => {
    const body = await parseBody(createSchema, req);
    return createTeamWorkspace(ctx.db, {
      name: body.name,
      adminUserId: ctx.user.id,
    });
  });
}
