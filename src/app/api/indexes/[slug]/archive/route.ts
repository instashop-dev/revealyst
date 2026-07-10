import {
  archiveCustomIndex,
  assertCustomIndexEntitledForOrg,
} from "@/lib/custom-index-impl";
import { handleApi } from "@/lib/api-route";

// POST /api/indexes/:slug/archive — retire a custom index's active version so
// it stops recomputing (frees a cap slot). Rows are never deleted (immutable
// versioned history). Admin-only, Team-paid.
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return handleApi(
    async (ctx) => {
      await assertCustomIndexEntitledForOrg(ctx.db, ctx.org.id);
      const res = await archiveCustomIndex(ctx.scope, slug);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "custom_index.archive",
        targetKind: "score_definition",
        targetId: slug,
        metadata: { slug, archived: res.archived },
      });
      return res;
    },
    { adminOnly: true },
  );
}
