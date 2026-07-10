import {
  assertCustomIndexEntitledForOrg,
  unarchiveCustomIndex,
} from "@/lib/custom-index-impl";
import { handleApi } from "@/lib/api-route";

// POST /api/indexes/:slug/unarchive — reactivate a custom index's head version
// so it recomputes again (re-checks the active-definition cap). Admin-only,
// Team-paid.
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return handleApi(
    async (ctx) => {
      await assertCustomIndexEntitledForOrg(ctx.db, ctx.org.id);
      const res = await unarchiveCustomIndex(ctx.scope, slug);
      await ctx.scope.auditLog.record({
        actorUserId: ctx.user.id,
        action: "custom_index.unarchive",
        targetKind: "score_definition",
        targetId: slug,
        metadata: { slug },
      });
      return res;
    },
    { adminOnly: true },
  );
}
