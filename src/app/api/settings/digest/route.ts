import { z } from "zod";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// PATCH /api/settings/digest — opt the current admin/owner in or out of the
// weekly digest email (F2.2, ADR 0024). Per-USER preference within the org, so
// it writes ctx.user.id's row, not an org-wide setting.
//
// - Admin-only (`adminOnly`): the digest is an admin/owner surface; the Settings
//   page also bounces non-admins, so it's double-gated like /api/settings.
// - `allowOverFreeBand`: managing your own notification preference must work
//   even for a paywalled org (tightening/turning OFF a notification is never
//   gated) — the digest content is org data the org already has.
//
// Uses a LOCAL zod schema, not the frozen src/contracts/api.ts (this route is
// additive and non-frozen).
const digestPrefsSchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: Request) {
  return handleApi(
    async (ctx) => {
      const { enabled } = await parseBody(digestPrefsSchema, req);
      const row = await ctx.scope.digestPreferences.setEnabled(
        ctx.user.id,
        enabled,
      );
      return { enabled: row.digestEnabled };
    },
    { adminOnly: true, allowOverFreeBand: true },
  );
}
