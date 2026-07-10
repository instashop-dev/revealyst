import { NextResponse } from "next/server";
import { getInstallationAccount } from "@/connectors/copilot/github-app";
import { appContext } from "@/lib/api-context";
import { completeGithubCopilotInstall } from "@/lib/api-impl";
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
 * install. GitHub redirects here with `installation_id` + the CSRF `state`.
 * We verify the state (double-submit cookie + org-bound HMAC), resolve which
 * account the installation is on (a live App-authenticated GitHub call — the
 * founder-gated NLV surface), then create the connection + store the App
 * credential. Re-installs reuse the existing connection for that installation
 * id rather than minting a duplicate.
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

  // Resolve which org/enterprise this installation is on so poll() knows the
  // report path. Live App-authenticated call (NLV surface).
  let account: { login: string; type: string };
  try {
    account = await getInstallationAccount(
      { appId: app.appId, installationId, privateKeyPem: app.privateKeyPem },
      new Date(),
    );
  } catch {
    return back("?copilot_error=install_lookup");
  }

  // Re-install idempotency + connection creation share one try/catch so a
  // transient DB error redirects with a reason instead of 500-ing the user
  // mid-OAuth (as this route's contract promises).
  try {
    const existing = (await ctx.scope.connections.list()).find(
      (c) =>
        c.vendor === "github_copilot" &&
        (c.config as { installationId?: string }).installationId === installationId,
    );
    if (existing) {
      return back("?connected=github_copilot&reused=1");
    }
    await completeGithubCopilotInstall(ctx.scope, env, {
      orgLogin: account.login,
      installationId,
      appId: app.appId,
      privateKeyPem: app.privateKeyPem,
      // Enterprise detection is NLV-unverified (facts §1); V1.5 targets
      // Copilot Business (org), so a non-"Enterprise" account.type falls back
      // to org — the safe default until the first Enterprise customer.
      scopeKind: account.type === "Enterprise" ? "enterprise" : "org",
      actorUserId: ctx.user.id,
    });
  } catch {
    return back("?copilot_error=create_failed");
  }
  return back("?connected=github_copilot");
}
