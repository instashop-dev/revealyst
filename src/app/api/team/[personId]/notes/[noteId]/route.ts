import { ApiError, deleteManagerNote } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// DELETE /api/team/:personId/notes/:noteId — delete a manager coaching note
// (D-TCI-7, ADR 0053). AUTHOR-ONLY: `deleteManagerNote` scopes the delete by
// (org, id, authorUserId), so a co-manager who can READ the note cannot delete
// it (their delete matches no row → 404). The same surface gates as the write
// apply (private mode unavailable; caller must manage a team).
//
// - handleApi: 401 for signed-out.
// - Impersonation → 403 (mirrors the write route): reads stay allowed under
//   impersonation, writes/deletes do not.
// - `personId` in the path is addressing only; the (org, id, author) scope in the
//   impl is the authority.

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ personId: string; noteId: string }> },
) {
  const { noteId } = await params;
  return handleApi(async (ctx) => {
    if (ctx.session.session.impersonatedBy) {
      throw new ApiError(403, "forbidden while impersonating");
    }
    return deleteManagerNote(
      { scope: ctx.scope },
      {
        callerUserId: ctx.user.id,
        visibilityMode: ctx.org.visibilityMode,
        noteId,
      },
    );
  });
}
