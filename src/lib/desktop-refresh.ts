import type { Db } from "../db/client";
import type { CredentialEnv } from "./credentials";
import {
  type DesktopAccessTokenEnv,
  DESKTOP_ACCESS_TOKEN_AUDIENCE,
  signDesktopAccessToken,
} from "./desktop-access-token";
import { authenticateDeviceToken } from "./device-token";

// Core of POST /api/desktop/auth/refresh (T7.2, ADR 0058), kept out of the
// Next route handler so it is unit-testable against PGlite.
//
// The agent presents its long-lived `rva1.` DEVICE token here — and ONLY the
// device token: refresh is the one place the refresh credential is used. An
// access token cannot mint another access token (it lacks the `rva1.` prefix,
// so it never authenticates here), which is what bounds a stolen access token
// to its short TTL — it can never be self-extended past a device revocation.
//
// Ordering mirrors the other device-token routes: cheap token auth first;
// only an authenticated caller reaches the (also cheap) signing step.

export type DesktopRefreshOutcome = {
  status: 200 | 401 | 403 | 503;
  body: Record<string, unknown>;
};

/**
 * Authenticate the presented device token and, on success, issue a short-lived
 * signed access token bound to (org, connection). Backward-compatibility rule:
 * if the access-token signing key is not configured (CI/dev, or a deploy that
 * hasn't turned rotation on yet), respond 503 "not configured" with a benign
 * warning — NEVER a fake token and never a 500 outage. The agent falls back to
 * using its device token directly, so an un-provisioned server keeps working.
 */
export async function issueDesktopAccessToken(
  db: Db,
  env: CredentialEnv & DesktopAccessTokenEnv,
  bearerToken: string,
): Promise<DesktopRefreshOutcome> {
  // Only a real device token may refresh (parseAgentToken rejects anything
  // without the rva1. prefix → 401), so an access token can never be presented
  // here to extend itself.
  const auth = await authenticateDeviceToken(db, env, bearerToken);
  if (!auth.ok) {
    return { status: auth.status, body: auth.body };
  }

  if (!env.DESKTOP_ACCESS_TOKEN_SIGNING_KEY) {
    // Benign, honest "not configured" — the sibling of the SES / Copilot-App
    // absent-secret pattern. The agent reads this and keeps using its device
    // token (backward-compatible rollout), so this is not an error the way an
    // unsignable CONFIG is (that one 500s, because the agent would trust it).
    console.warn(
      "[desktop-refresh] DESKTOP_ACCESS_TOKEN_SIGNING_KEY not configured; " +
        "access-token issuance disabled (agent falls back to device token)",
    );
    return {
      status: 503,
      body: { error: "access token issuance not configured" },
    };
  }

  const signed = await signDesktopAccessToken(env, {
    orgId: auth.orgId,
    connectionId: auth.connectionId,
  });
  return {
    status: 200,
    body: {
      accessToken: signed.token,
      tokenType: "Bearer",
      expiresIn: signed.expiresInSeconds,
      audience: DESKTOP_ACCESS_TOKEN_AUDIENCE,
    },
  };
}
