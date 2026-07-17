import { leaveOrg } from "@/db/membership";
import { ApiError } from "@/lib/api-impl";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// Plain-English refusals for each guard the pure leaveOrg reports (invariant:
// tell the user what to DO). `not_member` maps to 404 separately.
const REASON_COPY = {
  personal_org:
    "You can't leave your personal workspace — it's your account's home.",
  last_admin:
    "You're the only admin of this workspace. Make someone else an admin before you leave.",
} as const;

/** POST /api/org/leave — the signed-in user leaves their ACTIVE workspace,
 * removing their own membership + any manager grants they held here. Irreversible
 * (rejoining needs a fresh invite). allowOverFreeBand: a blocked org must not
 * trap a member with no way out. Impersonated sessions are blocked — a support
 * admin wearing a user's hat must never drop the victim out of a workspace. */
export async function POST() {
  return handleApi(
    async (ctx) => {
      if (ctx.session.session.impersonatedBy) {
        throw new ApiError(403, "forbidden while impersonating");
      }
      const outcome = await leaveOrg(ctx.db, {
        userId: ctx.user.id,
        orgId: ctx.org.id,
      });
      if (!outcome.ok) {
        if (outcome.reason === "not_member") {
          throw new ApiError(404, "workspace not found");
        }
        throw new ApiError(400, REASON_COPY[outcome.reason]);
      }
      return { ok: true };
    },
    { allowOverFreeBand: true },
  );
}
