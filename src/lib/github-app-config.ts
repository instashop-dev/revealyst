// GitHub App configuration + CSRF state signing for the Copilot connect flow
// (W4-T). The Revealyst GitHub App is ONE registered app (docs/approvals.md:
// App ID 4215573); its private key is a Worker secret. A customer installs
// the app on their org, GitHub redirects back to the callback with an
// installation id, and we store { appId, installationId, privateKeyPem } as
// the connection's `github_app_private_key` credential (the private key is
// SOURCED from the Worker secret at connect time — single app — but stored
// per-connection in the envelope so the connector reads it via ctx.credential
// without a frozen ConnectorContext change).
//
// Worker-secret names match docs/approvals.md (not in cloudflare-env.d.ts —
// they are secrets, so declared locally, exactly like AuthEnv). Absent
// secrets mean the app isn't wired yet: the connect flow degrades to an
// honest "not configured" instead of throwing.

import { GITHUB_API_VERSION } from "@/connectors/copilot/github-app";

export type CopilotAppEnv = {
  /** GitHub App id (docs/approvals.md: 4215573). */
  GH_COPILOT_APP_ID?: string;
  /** GitHub App private key, PEM (PKCS#1 or PKCS#8). */
  GH_COPILOT_APP_PRIVATE_KEY?: string;
  /** App slug for the install URL, e.g. `revealyst` → github.com/apps/revealyst. */
  GH_COPILOT_APP_SLUG?: string;
  /** GitHub App OAuth client id (docs/approvals.md: Iv23li7wFumkZwiRogYu).
   * Used to exchange the install-time OAuth `code` — proves the connecting
   * user controls the installation (confused-deputy defense). */
  GH_COPILOT_APP_CLIENT_ID?: string;
  /** GitHub App OAuth client secret (Worker secret; never per-connection). */
  GH_COPILOT_APP_CLIENT_SECRET?: string;
  /** Reused to sign the connect CSRF state (already a Worker secret). */
  BETTER_AUTH_SECRET?: string;
};

export type CopilotAppConfig = {
  appId: string;
  privateKeyPem: string;
  slug: string;
  clientId: string;
  clientSecret: string;
};

/** Reads + validates the App secrets; null when the app isn't wired yet.
 *
 * The client id/secret gate the SAME "not configured" degradation as the App
 * id/key/slug: the install-ownership check (github-app.ts) can't run without
 * them, so the whole connect flow — and the connect card that reads this —
 * stays honestly disabled until ALL secrets sync, never a half-wired flow that
 * skips the security gate. */
export function readCopilotAppConfig(env: CopilotAppEnv): CopilotAppConfig | null {
  const appId = env.GH_COPILOT_APP_ID;
  const privateKeyPem = env.GH_COPILOT_APP_PRIVATE_KEY;
  const slug = env.GH_COPILOT_APP_SLUG;
  const clientId = env.GH_COPILOT_APP_CLIENT_ID;
  const clientSecret = env.GH_COPILOT_APP_CLIENT_SECRET;
  if (!appId || !privateKeyPem || !slug || !clientId || !clientSecret) return null;
  return { appId, privateKeyPem, slug, clientId, clientSecret };
}

/** The GitHub App installation URL a customer is redirected to. `state`
 * round-trips back to the callback for CSRF validation. */
export function installUrl(slug: string, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(
    slug,
  )}/installations/new?state=${encodeURIComponent(state)}`;
}

export const CONNECT_STATE_COOKIE = "revealyst_gh_connect_state";
const STATE_TTL_SECONDS = 15 * 60;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64Url(new Uint8Array(sig));
}

/** Signs an org-bound, time-boxed CSRF state token: `orgId.nonce.exp.mac`. */
export async function signConnectState(
  secret: string,
  orgId: string,
  now: Date,
): Promise<string> {
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const exp = Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS;
  const payload = `${orgId}.${nonce}.${exp}`;
  const mac = await hmac(secret, payload);
  return `${payload}.${mac}`;
}

/** Constant-time-ish verification: matches HMAC, org binding, and expiry.
 * Returns ok only when the token is authentic, unexpired, and for `orgId`. */
export async function verifyConnectState(
  secret: string,
  token: string,
  orgId: string,
  now: Date,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [tokenOrg, nonce, expStr, mac] = parts;
  if (tokenOrg !== orgId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(now.getTime() / 1000)) return false;
  const expected = await hmac(secret, `${tokenOrg}.${nonce}.${expStr}`);
  if (expected.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  }
  return diff === 0;
}

export { GITHUB_API_VERSION };
