// GitHub App authentication for the Copilot connector — mint an App JWT
// (RS256) from the App private key, then exchange it for a short-lived
// installation access token used against the reports API. Pure WebCrypto
// (identical on workerd, Node, and vitest — same discipline as
// src/lib/credentials.ts); nothing cached at module scope.
//
// Credential model (ADR 0018): the App auth material reaches the connector
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
