import { openPortal } from "@/lib/billing";
import { handleApi } from "@/lib/api-route";
import { resolvePaddleServerConfig, type PaddleEnv } from "@/lib/paddle";

export const dynamic = "force-dynamic";

// GET /api/billing/portal (ADR 0011) — mints a fresh authenticated Paddle
// customer-portal session for the caller's own org and returns its links.
// Generated per request, never cached. Admin-only.
export async function GET() {
  const res = await handleApi(
    (ctx) =>
      openPortal(
        ctx.db,
        resolvePaddleServerConfig(ctx.env as PaddleEnv),
        ctx.org.id,
      ),
    { adminOnly: true },
  );
  // The response carries an authenticated, expiring portal URL — never let a
  // browser or intermediary cache it (ADR 0011: generated per request).
  res.headers.set("Cache-Control", "no-store");
  return res;
}
