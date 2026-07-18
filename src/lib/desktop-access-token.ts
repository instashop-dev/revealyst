// Short-lived desktop access tokens (Desktop Agent plan M7 / T7.2, ADR 0058).
//
// The desktop agent used to authenticate EVERY request with its long-lived
// `rva1.` device token (the D-DA-4 deviation). That token now becomes a
// REFRESH credential only: the agent presents it once to
// POST /api/desktop/auth/refresh and receives a short-lived, signed ACCESS
// token, which it then presents on its ordinary calls (ingest, config,
// diagnostics, the OTLP receiver). A leaked access token is bounded by its
// tight expiry; the powerful, long-lived device token stays in the OS
// keychain and only ever travels to the refresh endpoint.
//
// The access token is a compact JWT (JSON Web Token) signed with HMAC-SHA256.
// HMAC (a symmetric secret) is the right choice here — unlike the desktop
// CONFIG signature (Ed25519), which the AGENT verifies with a baked-in public
// key, the access token is verified ONLY by the server (the same Worker that
// minted it). The agent treats it as an opaque string; it never decodes or
// verifies it. So there is no public key to distribute and no asymmetric key
// pair to manage — one Worker secret both signs and verifies.
//
// Pure WebCrypto (`crypto.subtle` HMAC) — identical on workerd, Node, and
// vitest, and the same primitive src/lib/github-app-config.ts already uses for
// its signed-state HMAC. No JS crypto dependency is added. Keys are imported
// per call — nothing cached at module scope (Workers cancel cross-request I/O).

// ---------------------------------------------------------------------------
// Bound claims (spec §26.4 — the token is scoped, audience-bound, and expiring)
// ---------------------------------------------------------------------------

/** Who issued the token. Rejected on verify if it differs — a token minted for
 * some other Revealyst surface can never authenticate a desktop call. */
export const DESKTOP_ACCESS_TOKEN_ISSUER = "revealyst-desktop";

/** Who the token is FOR. Bound into the payload and re-checked on verify so a
 * desktop access token is not accepted anywhere but the desktop API. */
export const DESKTOP_ACCESS_TOKEN_AUDIENCE = "revealyst-desktop-api";

/** Tight expiry: long enough to cover a sync cadence + retries, short enough
 * that a leaked access token is worthless within minutes. The refresh
 * credential (the device token) can always mint another. */
export const DESKTOP_ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

/** A tiny leeway for clock skew between the minting Worker and the verifying
 * Worker (they are the same code, but not necessarily the same wall clock). */
const CLOCK_SKEW_LEEWAY_SECONDS = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Signing-key Worker secret (mirrors the versioned CREDENTIAL_KEK_* / desktop
// config-signing-key pattern: a Worker secret, absent in CI/dev, injected as a
// test key by tests — never required to make the suite pass).
// ---------------------------------------------------------------------------

/**
 * The Worker secret(s) that sign/verify desktop access tokens. Format for each:
 * `v<N>:<base64 of >=32 random bytes>`, e.g. `v1:3q2+7w…`. Declared as a local
 * structural type (like `CredentialEnv` / `DesktopConfigSigningEnv`) because it
 * is a SECRET — never added to the generated cloudflare-env.d.ts.
 *
 * `_PREVIOUS` supports zero-downtime rotation exactly like `CREDENTIAL_KEK_*`:
 * new tokens sign under CURRENT; verify accepts CURRENT then PREVIOUS, so
 * tokens minted just before a key flip keep verifying until they expire (which
 * they do within minutes). Rotation needs no agent release — the agent never
 * sees the key.
 */
export type DesktopAccessTokenEnv = {
  DESKTOP_ACCESS_TOKEN_SIGNING_KEY?: string;
  DESKTOP_ACCESS_TOKEN_SIGNING_KEY_PREVIOUS?: string;
};

type SigningKey = { version: string; secret: Uint8Array };

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64url (no padding) — the JWT segment encoding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return fromBase64(b64 + pad);
}

function encodeSegment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Parse `v<N>:<base64 secret>` into its version label + raw key bytes. Throws
 * on a missing/malformed key so ISSUANCE fails closed (an unsignable token is
 * a config error, never a silent success). */
function parseSigningKey(raw: string | undefined): SigningKey {
  if (!raw) {
    throw new Error("DESKTOP_ACCESS_TOKEN_SIGNING_KEY is not configured");
  }
  const separator = raw.indexOf(":");
  if (separator < 1) {
    throw new Error(
      "DESKTOP_ACCESS_TOKEN_SIGNING_KEY must be formatted as v<N>:<base64 secret>",
    );
  }
  const version = raw.slice(0, separator);
  let secret: Uint8Array;
  try {
    secret = fromBase64(raw.slice(separator + 1));
  } catch {
    throw new Error(
      "DESKTOP_ACCESS_TOKEN_SIGNING_KEY key material is not valid base64",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "DESKTOP_ACCESS_TOKEN_SIGNING_KEY must carry at least 32 bytes of key material",
    );
  }
  return { version, secret };
}

async function hmacSign(secret: Uint8Array, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data) as BufferSource,
  );
  return toBase64Url(new Uint8Array(sig));
}

/** Constant-time compare of two base64url signatures (equal length by
 * construction — both are HMAC-SHA256 outputs). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aB = enc.encode(a);
  const bB = enc.encode(b);
  if (aB.length !== bB.length) return false;
  let diff = 0;
  for (let i = 0; i < aB.length; i++) diff |= aB[i] ^ bB[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

export type SignDesktopAccessTokenInput = {
  orgId: string;
  connectionId: string;
  /** Epoch milliseconds. Defaults to Date.now(). Injected in tests. */
  now?: number;
  /** Override the TTL (tests). Defaults to DESKTOP_ACCESS_TOKEN_TTL_SECONDS. */
  ttlSeconds?: number;
};

export type SignedDesktopAccessToken = {
  token: string;
  /** Seconds until expiry — handed to the agent so it can refresh EARLY
   * without decoding the token (it treats the token as opaque). */
  expiresInSeconds: number;
};

/**
 * Mint a short-lived HMAC-SHA256 access token bound to (org, connection). The
 * device/org identity is carried as claims: `sub` = connectionId, `org` =
 * orgId, plus `iss`/`aud`/`iat`/`exp`. Signed with the CURRENT key; its version
 * is stamped in the header `kid`. Throws if the signing key is not configured
 * (issuance fails closed).
 */
export async function signDesktopAccessToken(
  env: DesktopAccessTokenEnv,
  input: SignDesktopAccessTokenInput,
): Promise<SignedDesktopAccessToken> {
  const key = parseSigningKey(env.DESKTOP_ACCESS_TOKEN_SIGNING_KEY);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const ttl = input.ttlSeconds ?? DESKTOP_ACCESS_TOKEN_TTL_SECONDS;

  const header = { alg: "HS256", typ: "JWT", kid: key.version };
  const payload = {
    iss: DESKTOP_ACCESS_TOKEN_ISSUER,
    aud: DESKTOP_ACCESS_TOKEN_AUDIENCE,
    sub: input.connectionId,
    org: input.orgId,
    iat: nowSeconds,
    exp: nowSeconds + ttl,
  };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const signature = await hmacSign(key.secret, signingInput);
  return {
    token: `${signingInput}.${signature}`,
    expiresInSeconds: ttl,
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export type VerifiedDesktopAccessToken =
  | { ok: true; orgId: string; connectionId: string }
  | { ok: false };

const INVALID: VerifiedDesktopAccessToken = { ok: false };

/**
 * Verify a desktop access token. Returns the bound (org, connection) on
 * success, or `{ ok: false }` for ANY failure — malformed structure, wrong
 * signature, wrong issuer/audience, expired, or no signing key configured. It
 * NEVER throws and NEVER distinguishes failure reasons to the caller (a probe
 * learns nothing). A missing signing key means access tokens simply cannot be
 * verified — device-token auth is unaffected, so this is benign in CI/dev.
 *
 * Tries the CURRENT key, then PREVIOUS, so a token minted just before a key
 * rotation still verifies until it expires.
 */
export async function verifyDesktopAccessToken(
  env: DesktopAccessTokenEnv,
  token: string,
  now?: number,
): Promise<VerifiedDesktopAccessToken> {
  const parts = token.split(".");
  if (parts.length !== 3) return INVALID;
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Header must declare exactly our algorithm — never trust a token that asks
  // for a different (or "none") alg. This closes the classic JWT alg-confusion
  // hole: we pick the algorithm, the token does not.
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerB64)));
  } catch {
    return INVALID;
  }
  if (
    typeof header !== "object" ||
    header === null ||
    (header as { alg?: unknown }).alg !== "HS256"
  ) {
    return INVALID;
  }

  // Recompute the signature under every configured key and constant-time
  // compare. We do NOT branch on the header `kid` to pick a key — we try all
  // keys — so a forged/altered kid cannot steer verification.
  const candidates: (string | undefined)[] = [
    env.DESKTOP_ACCESS_TOKEN_SIGNING_KEY,
    env.DESKTOP_ACCESS_TOKEN_SIGNING_KEY_PREVIOUS,
  ];
  let signatureValid = false;
  for (const raw of candidates) {
    if (!raw) continue;
    let key: SigningKey;
    try {
      key = parseSigningKey(raw);
    } catch {
      continue; // A misconfigured key is skipped, not fatal to the other.
    }
    const expected = await hmacSign(key.secret, signingInput);
    if (timingSafeEqual(expected, signatureB64)) {
      signatureValid = true;
      break;
    }
  }
  if (!signatureValid) return INVALID;

  // Signature is authentic — now the claims. Decode AFTER the signature check
  // so we never parse attacker-chosen claims we haven't authenticated.
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return INVALID;
  }
  if (typeof payload !== "object" || payload === null) return INVALID;
  const p = payload as Record<string, unknown>;

  if (p.iss !== DESKTOP_ACCESS_TOKEN_ISSUER) return INVALID;
  if (p.aud !== DESKTOP_ACCESS_TOKEN_AUDIENCE) return INVALID;
  if (typeof p.sub !== "string" || !UUID_RE.test(p.sub)) return INVALID;
  if (typeof p.org !== "string" || !UUID_RE.test(p.org)) return INVALID;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return INVALID;

  const nowSeconds = Math.floor((now ?? Date.now()) / 1000);
  if (nowSeconds > p.exp + CLOCK_SKEW_LEEWAY_SECONDS) return INVALID;

  return { ok: true, orgId: p.org, connectionId: p.sub };
}
