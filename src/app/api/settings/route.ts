import { apiRoutes } from "@/contracts/api";
import { updateOrgSettings } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/settings — frozen `settingsUpdate` contract (ADR 0018, W4-W).
 * Rename and/or change the org visibility mode — the single most
 * privacy-sensitive mutation in the product (§9.1).
 *
 * - Admin-only (`adminOnly`): a non-admin member gets 403; the page redirects
 *   them too, so the mutation is double-gated (same as /members, ADR 0004).
 * - `allowOverFreeBand`: privacy controls are never paywalled — an admin over
 *   the free band must always be able to TIGHTEN privacy (switch back to
 *   `private`). Mirrors /account (delete) and connection-delete exemptions.
 *
 * The from→to diff and per-changed-field audit_log entries live in
 * `updateOrgSettings`, which reads the session's current org values from
 * `ctx.org` (the frozen `me` route already exposes them — no read route
 * needed).
 */
export async function PATCH(req: Request) {
  return handleApi(
    async (ctx) => {
      const patch = await parseBody(apiRoutes.settingsUpdate.request, req);
      return updateOrgSettings(ctx.scope, {
        actorUserId: ctx.user.id,
        current: {
          id: ctx.org.id,
          name: ctx.org.name,
          visibilityMode: ctx.org.visibilityMode,
        },
        patch,
      });
    },
    { adminOnly: true, allowOverFreeBand: true },
  );
}
