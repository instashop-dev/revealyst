import { orgMembersList } from "@/db/invites";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** GET /api/org/members — org members (auth users) with roles. Admin-only. */
export async function GET() {
  return handleApi(
    async (ctx) => ({
      members: (await orgMembersList(ctx.db, ctx.org.id)).map((member) => ({
        ...member,
        createdAt: member.createdAt.toISOString(),
      })),
    }),
    { adminOnly: true },
  );
}
