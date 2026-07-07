import { z } from "zod";
import { acceptInvite, InviteError } from "@/db/invites";
import { forOrg } from "@/db/org-scope";
import { ApiError } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const acceptSchema = z.object({ token: z.string().min(1) });

const STATUS_BY_REASON = {
  invalid: 404,
  expired: 410,
  revoked: 410,
  already_used: 409,
  duplicate_pending: 409, // unreachable here; keeps the map total
} as const;

/** POST /api/invites/accept — redeem an invite token for the session user. */
export async function POST(req: Request) {
  return handleApi(async (ctx) => {
    const body = await parseBody(acceptSchema, req);
    try {
      const joined = await acceptInvite(ctx.db, body.token, ctx.user.id);
      // Audit in the JOINED org (ctx.scope is the accepter's pre-join org).
      // Membership changes are the most audit-worthy event; the invite row
      // records accepted_by, this records it in the central trail. Skipped
      // on idempotent replays — a re-POST of an already-redeemed token must
      // not append repeat join rows to another org's trail.
      if (!joined.alreadyAccepted) {
        await forOrg(ctx.db, joined.orgId).auditLog.record({
          actorUserId: ctx.user.id,
          action: "org.member_join",
          targetKind: "org",
          targetId: joined.orgId,
          metadata: { role: joined.role },
        });
      }
      return { ok: true, orgId: joined.orgId, role: joined.role };
    } catch (error) {
      if (error instanceof InviteError) {
        throw new ApiError(STATUS_BY_REASON[error.reason], error.message);
      }
      throw error;
    }
  });
}
