import { z } from "zod";
import { renameDevice } from "@/lib/desktop-devices";
import { handleApi, parseBody } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// PATCH /api/desktop/devices/:id (Desktop Agent plan T2.4) — rename a device
// the SIGNED-IN user owns. Session-authed (handleApi), NOT admin-only: every
// member manages their own devices. Ownership (config.pairedByUserId) is
// re-checked inside renameDevice — a member can never rename another member's
// device (404). `allowOverFreeBand`: self-service device management is not a
// data-read feature, so it stays reachable for an over-band org (mirrors the
// /settings paywall exemption).
//
// A local (non-frozen) request schema — device management is not part of the
// frozen `apiRoutes` contract, so no contract change is needed.
const deviceRenameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) => {
      const { name } = await parseBody(deviceRenameSchema, req);
      return renameDevice(ctx.scope, {
        deviceId: id,
        userId: ctx.user.id,
        name,
      });
    },
    { allowOverFreeBand: true },
  );
}
