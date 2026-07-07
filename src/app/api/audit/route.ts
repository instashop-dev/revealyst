import { z } from "zod";
import { handleApi, parseQuery } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// GET /api/audit — the org's accountability trail (ADR 0010). Admin-only,
// org-scoped, newest-first. Paging: pass the previous page's LAST entry as
// `before` (its createdAt, ISO) + `beforeId` (its id) — an exclusive
// compound cursor, so boundary rows never repeat even on timestamp ties.
// Non-frozen route (post-dates the W0-C API freeze). No UI in V1.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
  beforeId: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  return handleApi(
    async (ctx) => {
      const query = parseQuery(querySchema, req);
      const entries = await ctx.scope.auditLog.list(query);
      return {
        entries: entries.map((e) => ({
          id: e.id,
          actorUserId: e.actorUserId,
          action: e.action,
          targetKind: e.targetKind,
          targetId: e.targetId,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
    { adminOnly: true },
  );
}
