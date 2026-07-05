import { invitesForOrg } from "@/db/invites";
import { ApiError } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** DELETE /api/org/invites/:id — revoke a pending invite. Admin-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const revoked = await invitesForOrg(ctx.db, ctx.org.id).revoke(id);
      if (!revoked) {
        throw new ApiError(404, "no pending invite with that id");
      }
      return { ok: true };
    },
    { adminOnly: true },
  );
}
