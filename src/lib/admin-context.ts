import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { appContext, type AppContext } from "./api-context";
import { ApiError } from "./api-impl";

// Platform-admin gate helpers (ADR 0016). Two choke points, used everywhere:
// requireAdminContext() for pages/layouts under /admin, handleAdminApi() for
// /api/admin/* routes — a UI-only gate would leave cross-org data readable
// with a session cookie (the W3-M lesson). Both REJECT impersonating
// sessions: while wearing a user's hat, an admin has no /admin reach (kills
// the "impersonate admin B, act as B" escalation a second time — the first
// block is in src/lib/auth.ts hooks.before).
//
// The staff check itself lives in ./admin-access (pure, vitest-importable);
// re-exported here so admin surfaces import one module.
export { isPlatformAdmin, parseAdminUserIds } from "./admin-access";

/**
 * Page/layout variant: resolve the app context and require platform-admin.
 * Unauthenticated visitors go to sign-in (and back); non-admins and
 * impersonating sessions are bounced to /dashboard — the admin surface
 * simply doesn't exist for them.
 */
export async function requireAdminContext(): Promise<AppContext> {
  const ctx = await appContext();
  if (!ctx) {
    redirect("/sign-in?next=%2Fadmin");
  }
  if (!ctx.isPlatformAdmin || ctx.session.session.impersonatedBy) {
    redirect("/dashboard");
  }
  return ctx;
}

/**
 * API variant, mirroring handleApi (src/lib/api-route.ts): 401 no session →
 * 403 non-admin → 403 impersonating session → ApiError mapping. Deliberately
 * NO free-band paywall check: the admin's own org may be over the free band,
 * which is irrelevant to platform administration.
 */
export async function handleAdminApi(
  fn: (ctx: AppContext) => Promise<unknown>,
): Promise<NextResponse> {
  const ctx = await appContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!ctx.isPlatformAdmin || ctx.session.session.impersonatedBy) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await fn(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
