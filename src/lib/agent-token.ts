// Revealyst Agent device tokens (ADR 0002). Format:
//
//   rva1.<orgId>.<connectionId>.<secret>
//
// Dot-separated on purpose: UUIDs and base64url contain no dots. The token
// embeds its own scope — the server derives (org, connection) from the
// token and verifies the secret against the stored device_token credential
// (encrypted envelope, AAD-bound to orgId:connectionId:device_token), so a
// token replayed against another org fails both the lookup and decryption.
//
// Pure WebCrypto — identical on workerd, Node, and vitest.

const TOKEN_PREFIX = "rva1";
const SECRET_BYTE_LENGTH = 32;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]{20,}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256 bits of randomness, base64url — the credential plaintext stored
 * through the envelope. The full token is never stored anywhere. */
export function generateAgentSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function composeAgentToken(
  orgId: string,
  connectionId: string,
  secret: string,
): string {
  return `${TOKEN_PREFIX}.${orgId}.${connectionId}.${secret}`;
}

export type ParsedAgentToken = {
  orgId: string;
  connectionId: string;
  secret: string;
};

/** Strict structural parse — anything malformed is null (→ 401), never an
 * exception. */
export function parseAgentToken(token: string): ParsedAgentToken | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
    return null;
  }
  const [, orgId, connectionId, secret] = parts;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(connectionId)) {
    return null;
  }
  if (!BASE64URL_RE.test(secret)) {
    return null;
  }
  return { orgId, connectionId, secret };
}

/**
 * Constant-time string comparison. Secrets are fixed-length base64url, so
 * the length check leaks nothing an attacker doesn't already know from the
 * token format.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
