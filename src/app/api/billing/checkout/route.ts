import { startCheckout } from "@/lib/billing";
import { handleApi } from "@/lib/api-route";
import { resolvePaddleServerConfig, type PaddleEnv } from "@/lib/paddle";

export const dynamic = "force-dynamic";

// POST /api/billing/checkout (ADR 0011) — creates a server-side Paddle
// transaction with org_id bound from the session; returns the opaque
// transaction id + client-safe token for the overlay. Admin-only.
export async function POST() {
  return handleApi(
    (ctx) =>
      startCheckout(ctx.db, resolvePaddleServerConfig(ctx.env as PaddleEnv), {
        orgId: ctx.org.id,
        role: ctx.role,
      }),
    { adminOnly: true },
  );
}
