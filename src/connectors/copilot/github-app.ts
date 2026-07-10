// GitHub App authentication for the Copilot connector — mint an App JWT
// (RS256) from the App private key, then exchange it for a short-lived
// installation access token used against the reports API. Pure WebCrypto
// (identical on workerd, Node, and vitest — same discipline as
// src/lib/credentials.ts); nothing cached at module scope.
//
// Credential model (ADR 0022): the App auth material reaches the connector
// as ONE decrypted credential string — a JSON blob { appId, installationId,
// privateKeyPem } stored under the frozen `github_app_private_key` kind. App
// id + installation id also live in connection.config (non-secret) for the
// poller; the private key is the only real secret and lives only in the
// envelope. This keeps the frozen ConnectorContext (`credential: string`)
// untouched — the historical W2-J multi-credential blocker is dissolved by
// packing the material into one row, not by widening the seam.

import { RetryableConnectorError } from "../../poller/run";
import { withTimeout } from "../http";

export type FetchFn = typeof fetch;

const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";

/** The App auth material as stored (JSON) under `github_app_private_key`. */
export type GithubAppCredential = {
  appId: string;
  installationId: string;
  privateKeyPem: string;
};

/** Parses + validates the credential blob. Throws a permanent (non-retryable)
 * error on a malformed credential — a bad credential never self-heals. */
export function parseAppCredential(raw: string): GithubAppCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("github_copilot: credential is not valid JSON");
  }
  const c = parsed as Partial<GithubAppCredential>;
  if (!c || typeof c !== "object") {
    throw new Error("github_copilot: credential must be a JSON object");
  }
  for (const field of ["appId", "installationId", "privateKeyPem"] as const) {
    if (typeof c[field] !== "string" || c[field]!.length === 0) {
      throw new Error(`github_copilot: credential missing ${field}`);
    }
  }
  return {
    appId: c.appId!,
    installationId: c.installationId!,
    privateKeyPem: c.privateKeyPem!,
  };
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

function derFromPem(pem: string): { der: Uint8Array; isPkcs1: boolean } {
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  let der: Uint8Array;
  try {
    const binary = atob(body);
    der = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  } catch {
    throw new Error("github_copilot: private key PEM body is not valid base64");
  }
  return { der, isPkcs1 };
}

/** DER length octets for a given content length (short or long form). */
function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const out: number[] = [];
  let n = len;
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

function derSequence(...contents: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of contents) total += c.length;
  const header = [0x30, ...derLength(total)];
  const out = new Uint8Array(header.length + total);
  out.set(header, 0);
  let off = header.length;
  for (const c of contents) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Wraps a PKCS#1 `RSAPrivateKey` DER in a PKCS#8 `PrivateKeyInfo` so
 * WebCrypto (which imports PKCS#8 only) can read a GitHub-downloaded
 * `-----BEGIN RSA PRIVATE KEY-----` key. PrivateKeyInfo ::= SEQUENCE {
 *   version INTEGER (0),
 *   privateKeyAlgorithm AlgorithmIdentifier { rsaEncryption OID, NULL },
 *   privateKey OCTET STRING (the PKCS#1 DER) }.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0
  // AlgorithmIdentifier: OID 1.2.840.113549.1.1.1 (rsaEncryption) + NULL.
  const algId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);
  const octetHeader = [0x04, ...derLength(pkcs1.length)];
  const privateKey = new Uint8Array(octetHeader.length + pkcs1.length);
  privateKey.set(octetHeader, 0);
  privateKey.set(pkcs1, octetHeader.length);
  return derSequence(version, algId, privateKey);
}

async function importSigningKey(privateKeyPem: string): Promise<CryptoKey> {
  const { der, isPkcs1 } = derFromPem(privateKeyPem);
  const pkcs8 = isPkcs1 ? pkcs1ToPkcs8(der) : der;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8 as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw new Error(
      `github_copilot: could not import App private key (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

/**
 * Signs a GitHub App JWT (RS256). `iat` is backdated 60s for clock skew,
 * `exp` is +9 min (GitHub rejects >10 min). Pure crypto — the caller passes
 * the clock so this stays deterministic and testable.
 */
export async function mintAppJwt(
  cred: GithubAppCredential,
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const header = base64UrlFromString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlFromString(
    JSON.stringify({ iat, exp: iat + 9 * 60, iss: cred.appId }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importSigningKey(cred.privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

/** A minted installation token + its documented expiry. */
export type InstallationToken = { token: string; expiresAt: string };

/**
 * Exchanges the App JWT for an installation access token
 * (`POST /app/installations/{id}/access_tokens`). Error policy mirrors the
 * framework: 429/5xx retryable, other failures permanent (a bad key / lost
 * installation is not transient). The token is short-lived (~1h) and minted
 * fresh per poll — never persisted.
 */
export async function mintInstallationToken(
  cred: GithubAppCredential,
  now: Date,
  fetchFn: FetchFn = fetch,
): Promise<InstallationToken> {
  const jwt = await mintAppJwt(cred, now);
  return withTimeout("github_copilot", async (signal) => {
    const res = await fetchFn(
      `${GITHUB_API}/app/installations/${encodeURIComponent(cred.installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": "revealyst-connector-copilot/1",
        },
        signal,
      },
    );
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableConnectorError(
        `github_copilot: ${res.status} minting installation token`,
        retryAfterSeconds(res),
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(
        `github_copilot: ${res.status} minting installation token: ${detail}`,
      );
    }
    const body = (await res.json()) as { token?: string; expires_at?: string };
    if (!body.token) {
      throw new Error("github_copilot: installation token response had no token");
    }
    return { token: body.token, expiresAt: body.expires_at ?? "" };
  });
}

/**
 * Resolves the account (org login or enterprise slug) an installation is on
 * via `GET /app/installations/{id}` — used by the connect callback to learn
 * WHICH org's reports to fetch. Kept here so the connect flow and the
 * connector share one GitHub-App client.
 */
export async function getInstallationAccount(
  cred: GithubAppCredential,
  now: Date,
  fetchFn: FetchFn = fetch,
): Promise<{ login: string; type: string }> {
  const jwt = await mintAppJwt(cred, now);
  return withTimeout("github_copilot", async (signal) => {
    const res = await fetchFn(
      `${GITHUB_API}/app/installations/${encodeURIComponent(cred.installationId)}`,
      {
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": "revealyst-connector-copilot/1",
        },
        signal,
      },
    );
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableConnectorError(
        `github_copilot: ${res.status} reading installation`,
        retryAfterSeconds(res),
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(
        `github_copilot: ${res.status} reading installation: ${detail}`,
      );
    }
    const body = (await res.json()) as {
      account?: { login?: string; slug?: string; type?: string };
    };
    const login = body.account?.login ?? body.account?.slug;
    if (!login) {
      throw new Error("github_copilot: installation had no account login/slug");
    }
    return { login, type: body.account?.type ?? "Organization" };
  });
}

// ── Connect-flow OAuth: proving the caller controls the installation ────────
//
// The install callback is a classic confused-deputy risk: `installation_id`
// arrives as a URL query param, and getInstallationAccount() above authenticates
// as REVEALYST'S OWN App — so it succeeds for ANY installation of the app,
// regardless of who is driving the browser. GitHub installation ids are
// sequential/enumerable, so a caller could hand-craft a callback with a
// victim org's installation id and (pre-fix) bind that org's per-developer
// Copilot usage into their own Revealyst org. The org-bound CSRF state does
// NOT close this — it only proves the caller started a flow for their own org,
// not that they administer the installation (the id doesn't exist when state
// is minted).
//
// The fix implements GitHub's "Request user authorization (OAuth) during
// installation" pattern: GitHub returns a `code` alongside installation_id.
// We exchange it for a USER-to-server token, resolve which account the
// installation is on (App-authenticated), then require the OAuth user to be an
// ADMIN of that org (userIsOrgAdmin) before binding. Admin — not mere access —
// is the bar: `GET /user/installations` lists installs a user can *access*,
// which for an org-wide install includes ordinary org members with repo
// access, so it alone would still let a non-admin member bind the whole org's
// Copilot data. (For non-org installs — personal/enterprise — we fall back to
// "the user can access this specific installation".)

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** Standard headers for a GitHub REST call with a user-to-server token —
 * shared by the connect-flow ownership checks below (dedups the envelope). */
function userTokenHeaders(userToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${userToken}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "revealyst-connector-copilot/1",
  };
}

/**
 * Exchanges the temporary `code` GitHub returns after user authorization for a
 * user-to-server access token. The token proves the caller is a GitHub user
 * who just authorized the Revealyst App — the first half of the
 * confused-deputy defense. Throws on any non-token response (GitHub returns
 * HTTP 200 with `{ error }` on a bad/expired code, so token presence — not
 * status — is the success signal).
 */
export async function exchangeInstallationCode(
  args: { clientId: string; clientSecret: string; code: string },
  fetchFn: FetchFn = fetch,
): Promise<string> {
  return withTimeout("github_copilot", async (signal) => {
    const res = await fetchFn(GITHUB_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "revealyst-connector-copilot/1",
      },
      body: JSON.stringify({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        code: args.code,
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`github_copilot: ${res.status} exchanging oauth code`);
    }
    const body = (await res.json()) as { access_token?: string; error?: string };
    if (!body.access_token) {
      throw new Error(
        `github_copilot: oauth code exchange returned no access token${
          body.error ? ` (${body.error})` : ""
        }`,
      );
    }
    return body.access_token;
  });
}

/**
 * Confirms the OAuth user is an ACTIVE ADMIN of `orgLogin`
 * (`GET /user/memberships/orgs/{org}` → `role === "admin" && state ===
 * "active"`). This is the real ownership gate for an org installation: binding
 * an org's Copilot usage is an admin-level action, and admin membership of the
 * installation's org (resolved server-side, never caller-supplied) proves
 * control of every installation on it. 404/403 (not a member) → false; any
 * other non-OK THROWS so the caller can fail closed.
 */
export async function userIsOrgAdmin(
  userToken: string,
  orgLogin: string,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  return withTimeout("github_copilot", async (signal) => {
    const res = await fetchFn(
      `${GITHUB_API}/user/memberships/orgs/${encodeURIComponent(orgLogin)}`,
      { headers: userTokenHeaders(userToken), signal },
    );
    // Not a member of the org at all — GitHub returns 404 (or 403).
    if (res.status === 404 || res.status === 403) return false;
    if (!res.ok) {
      throw new Error(`github_copilot: ${res.status} reading org membership`);
    }
    const body = (await res.json()) as { role?: string; state?: string };
    return body.role === "admin" && body.state === "active";
  });
}

/**
 * Confirms `installationId` is among the App installations the OAuth user can
 * ACCESS (`GET /user/installations`, paginated). Weaker than userIsOrgAdmin —
 * access ≠ admin for an org-wide install — so this is used ONLY as the
 * ownership proof for NON-org installs (personal accounts, where access is
 * owner-only; enterprise is founder-gated, see ADR 0023). Pagination is
 * bounded; a network/HTTP failure THROWS so the caller can fail closed rather
 * than treat "couldn't verify" as "owns it".
 */
export async function userControlsInstallation(
  userToken: string,
  installationId: string,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  const perPage = 100;
  const maxPages = 10; // >1000 installs on one account is not a real customer
  const target = String(installationId);
  for (let page = 1; page <= maxPages; page++) {
    const result = await withTimeout("github_copilot", async (signal) => {
      const res = await fetchFn(
        `${GITHUB_API}/user/installations?per_page=${perPage}&page=${page}`,
        { headers: userTokenHeaders(userToken), signal },
      );
      if (!res.ok) {
        throw new Error(
          `github_copilot: ${res.status} listing user installations`,
        );
      }
      const body = (await res.json()) as {
        installations?: Array<{ id?: number | string }>;
      };
      const installs = body.installations ?? [];
      if (installs.some((i) => String(i.id) === target)) {
        return { match: true, done: true };
      }
      // Short page → last page; stop paginating.
      return { match: false, done: installs.length < perPage };
    });
    if (result.match) return true;
    if (result.done) return false;
  }
  return false;
}

export function retryAfterSeconds(res: Response): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  // GitHub signals rate limits via x-ratelimit-reset (epoch seconds) too.
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const delta = reset - Math.floor(Date.now() / 1000);
    if (delta > 0 && delta < 3600) return delta;
  }
  return 60;
}
