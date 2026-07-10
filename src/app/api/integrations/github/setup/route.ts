import { NextResponse } from "next/server";
import { appContext } from "@/lib/api-context";
import {
  CONNECT_STATE_COOKIE,
  type CopilotAppEnv,
  installUrl,
  readCopilotAppConfig,
  signConnectState,
} from "@/lib/github-app-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/github/setup — begins the Copilot GitHub App install.
 * Signs an org-bound CSRF state, drops it in an httpOnly cookie, and redirects
 * the admin to the GitHub App install page. GitHub returns to
 * /api/integrations/github/callback with `installation_id` + the same `state`.
 *
 * Honest degradation: if the App secrets aren't wired yet (the founder-gated
 * NLV precondition), redirect back to Connections with a clear reason rather
 * than throwing — the connector is registered but not yet operational.
 */
export async function GET(req: Request) {
  const ctx = await appContext();
  const back = (params: string) =>
    NextResponse.redirect(new URL(`/connections${params}`, req.url));
  if (!ctx) {
    return NextResponse.redirect(new URL("/sign-in?next=/connections", req.url));
  }
  const env = ctx.env as unknown as CopilotAppEnv;
  const app = readCopilotAppConfig(env);
  if (!app) {
    return back("?copilot_error=not_configured");
  }
  if (!env.BETTER_AUTH_SECRET) {
    return back("?copilot_error=not_configured");
  }
  const state = await signConnectState(env.BETTER_AUTH_SECRET, ctx.org.id, new Date());
  const res = NextResponse.redirect(installUrl(app.slug, state));
  res.cookies.set(CONNECT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // survives the top-level GET redirect back from GitHub
    path: "/",
    maxAge: 15 * 60,
  });
  return res;
}
