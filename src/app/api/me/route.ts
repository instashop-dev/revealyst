import { NextResponse } from "next/server";
import { apiRoutes } from "@/contracts/api";
import { appContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

/** GET /api/me — the frozen contract's session/org/role surface. */
export async function GET() {
  const ctx = await appContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Parsing through the frozen response schema keeps this handler honest:
  // contract drift fails loudly here instead of silently in a dashboard.
  const body = apiRoutes.me.response.parse({
    userId: ctx.user.id,
    org: ctx.org,
    role: ctx.role,
  });
  return NextResponse.json(body);
}
