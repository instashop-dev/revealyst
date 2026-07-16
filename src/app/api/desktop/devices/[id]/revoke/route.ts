import { revokeDevice } from "@/lib/desktop-devices";
import { handleApi } from "@/lib/api-route";

export const dynamic = "force-dynamic";

// POST /api/desktop/devices/:id/revoke (Desktop Agent plan T2.4) — revoke a
// device the SIGNED-IN user owns: pause the connection + destroy its
// device_token credential (spec §27.4). Session-authed (handleApi), NOT
// admin-only: a member revokes their own device. Ownership is re-checked
// inside revokeDevice (404 for a foreign/unknown device). `allowOverFreeBand`:
// revoking a device is a security/usage-reducing action — it must never be
// paywalled away (mirrors connection-delete's exemption).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    async (ctx) =>
      revokeDevice(ctx.scope, { deviceId: id, userId: ctx.user.id }),
    { allowOverFreeBand: true },
  );
}
