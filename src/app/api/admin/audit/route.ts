import { z } from "zod";
import { platformAuditList } from "@/db/admin";
import { handleAdminApi } from "@/lib/admin-context";
import { parseQuery } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// GET /api/admin/audit — platform-wide accountability trail (ADR 0016,
// Feature 3/PR6), cross-org, newest-first. Non-frozen route (colocated
// schema, same precedent as /api/audit — src/contracts/api.ts stays
// untouched). Paging mirrors /api/audit (ADR 0010): pass the previous
// page's LAST row as `before` (its createdAt, ISO) + `beforeId` (its id) —
// an exclusive compound cursor, so boundary rows never repeat even on
// timestamp ties. handleAdminApi rejects non-admin/impersonating callers
// with 401/403 before this body ever runs.
const querySchema = z.object({
  orgId: z.string().uuid().optional(),
  // Better Auth user ids are opaque text, not uuid — see auth-schema.ts.
  actorUserId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  before: z.coerce.date().optional(),
  beforeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  return handleAdminApi(async (ctx) => {
    const query = parseQuery(querySchema, req);
    const rows = await platformAuditList(ctx.db, query);
    return {
      rows: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}
