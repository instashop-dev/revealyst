import { NextResponse } from "next/server";
import { appContext } from "@/lib/api-context";
import { connectGithubCopilotInstall } from "@/lib/api-impl";
import type { CredentialEnv } from "@/lib/credentials";
import {
  CONNECT_STATE_COOKIE,
  type CopilotAppEnv,
  readCopilotAppConfig,
  verifyConnectState,
} from "@/lib/github-app-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/github/callback — completes the Copilot GitHub App
 * install. GitHub redirects here with `installation_id`, the CSRF `state`, and
 * (because the App has "Request user authorization during installation" on) an
 * OAuth `code`. This route is thin HTTP glue: it verifies the org-bound state
 * (double-submit cookie + HMAC) and delegates the security-critical binding —
 * proving the CALLER controls `installation_id` before storing anything — to
 * connectGithubCopilotInstall (unit-tested in tests/github-copilot-connect).
 *
 * The state check alone is NOT sufficient: it proves the caller started a
 * connect flow for their OWN org, but `installation_id` is an enumerable URL
 * param and getInstallationAccount authenticates as Revealyst's own App, so it
 * resolves ANY installation. Without the OAuth-code ownership proof this was a
 * confused deputy — a caller could bind a victim org's installation into their
 * own org and poll the victim's per-developer Copilot usage.
 *
 * All failures redirect back to Connections with a reason — never a 500 in a
 * user's browser mid-OAuth.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await appContext();
  const back = (params: string) => {
    const res = NextResponse.redirect(new URL(`/connections${params}`, req.url));
    res.cookies.delete(CONNECT_STATE_COOKIE);
    return res;
  };
  if (!ctx) {
    return NextResponse.redirect(new URL("/sign-in?next=/connections", req.url));
  }

  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONNECT_STATE_COOKIE}=`))
    ?.slice(CONNECT_STATE_COOKIE.length + 1);

  const env = ctx.env as unknown as CopilotAppEnv & CredentialEnv;
  const app = readCopilotAppConfig(env);
  if (!app || !env.BETTER_AUTH_SECRET) {
    return back("?copilot_error=not_configured");
  }
  if (
    !state ||
    !cookieState ||
    state !== cookieState ||
    !(await verifyConnectState(env.BETTER_AUTH_SECRET, state, ctx.org.id, new Date()))
  ) {
    return back("?copilot_error=state");
  }
  if (!installationId) {
    // e.g. setup_action=request (org owner must approve) — not an error.
    return back("?copilot_pending=1");
  }

  // Route-level safety net: connectGithubCopilotInstall is written to catch its
  // own failures and return a reason, but this route's contract is "never a 500
  // in a user's browser mid-OAuth" — so any unexpected throw still redirects
  // back with a reason rather than surfacing a 500.
  try {
    const result = await connectGithubCopilotInstall(
      ctx.scope,
      env,
      {
        appId: app.appId,
        privateKeyPem: app.privateKeyPem,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
      },
      { installationId, code, actorUserId: ctx.user.id },
    );
    if (!result.ok) {
      return back(`?copilot_error=${result.reason}`);
    }
    return back(
      result.reused
        ? "?connected=github_copilot&reused=1"
        : "?connected=github_copilot",
    );
  } catch {
    return back("?copilot_error=create_failed");
  }
}
