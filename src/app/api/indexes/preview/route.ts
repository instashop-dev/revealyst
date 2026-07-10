import { customIndexPreviewSchema } from "@/lib/custom-index";
import {
  assertCustomIndexEntitledForOrg,
  previewCustomIndex,
} from "@/lib/custom-index-impl";
import { handleApi, parseBody } from "@/lib/api-route";

// POST /api/indexes/preview — evaluate a DRAFT definition against the org's own
// recent data, read-only (no score_results written). Admin-only, Team-paid.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      await assertCustomIndexEntitledForOrg(ctx.db, ctx.org.id);
      const body = await parseBody(customIndexPreviewSchema, req);
      return previewCustomIndex(ctx.scope, body);
    },
    { adminOnly: true },
  );
}
