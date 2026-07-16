import { z } from "zod";
import type { Db } from "../db/client";
import { isUniqueViolation } from "../db/org-scope/shared";
import { forOrg, type OrgScopedDb } from "../db/org-scope";
import { findDesktopPairingByPairingId } from "../db/system";
import { composeAgentToken, generateAgentSecret, timingSafeEqualStr } from "./agent-token";
import type { CredentialEnv } from "./credentials";

// Desktop-agent PKCE pairing (Desktop Agent plan T2.2, spec §8, ADR 0047).
//
// The human authenticates via the existing web session in the system browser —
// there is no OAuth server here, no refresh tokens, no password form in the
// agent. Three steps:
//
//   1. POST /api/desktop/auth/start (unauthenticated, STATELESS): the agent
//      submits its S256 code challenge + device metadata + state; the server
//      validates the shape and returns a pairing handle plus the browser URL
//      carrying the payload. Nothing is written — an org-scoped row cannot
//      exist before a user consents, and a stateless start leaves no
//      unauthenticated write path to flood.
//   2. GET /desktop/connect (session-authed page) → POST
//      /api/desktop/auth/consent (session-authed): the signed-in user approves
//      the device; the org-scoped pairing row is created (challenge, code
//      hash, device metadata, consenting user, ≤10-min expiry) and the
//      browser is redirected to revealyst://desktop-auth/callback with the
//      one-time code + the agent's state echoed through.
//   3. POST /api/desktop/auth/exchange (unauthenticated): the agent proves
//      possession of the code AND the PKCE verifier; the server single-use
//      claims the row (CAS on used_at), mints the device `connections` row +
//      encrypted device_token credential, and returns the composed
//      `rva1.<orgId>.<connectionId>.<secret>` token exactly once.
//
// Route handlers only adapt HTTP; all logic lives here so it is unit-testable
// against PGlite (the otel-receiver pattern).

/** The deep link the consent redirect targets (spec §8.2). Registered by the
 * desktop agent (T2.3); path is fixed — the agent must reject any other. */
export const DESKTOP_CALLBACK_URL = "revealyst://desktop-auth/callback";

/** Pairing links and one-time codes both live ≤10 minutes. */
export const DESKTOP_PAIRING_TTL_MS = 10 * 60 * 1000;

/** Allowed forward clock skew when checking the start payload's freshness. */
const START_FRESHNESS_SKEW_MS = 2 * 60 * 1000;

const BASE64URL_43_128 = /^[A-Za-z0-9_-]{43,128}$/;

/** RFC 7636 §4.2: the S256 challenge (and any verifier) is 43–128 chars of
 * the base64url alphabet. */
const codeChallengeSchema = z.string().regex(BASE64URL_43_128, {
  message: "must be 43-128 base64url characters",
});

/** Opaque agent-chosen CSRF state, echoed through the redirect untouched.
 * The AGENT validates it (spec §8.2); the server only carries it. */
const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{8,256}$/, {
  message: "must be 8-256 base64url characters",
});

const deviceMetadataShape = {
  deviceDisplayName: z.string().trim().min(1).max(80),
  platform: z.enum(["macos", "windows"]),
  architecture: z.enum(["arm64", "x64"]),
  agentVersion: z.string().trim().min(1).max(64),
  installationId: z.string().uuid(),
} as const;

/** POST /api/desktop/auth/start request body. */
export const desktopPairingStartSchema = z.object({
  codeChallenge: codeChallengeSchema,
  state: stateSchema,
  ...deviceMetadataShape,
});
export type DesktopPairingStartRequest = z.infer<
  typeof desktopPairingStartSchema
>;

/** The /desktop/connect query params AND the consent form fields — the start
 * payload plus the minted pairing handle and issue timestamp. Everything is
 * re-validated at consent time; the URL is agent-composed data, not trust. */
export const desktopConnectPayloadSchema = z.object({
  pairing: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  challenge: codeChallengeSchema,
  state: stateSchema,
  name: deviceMetadataShape.deviceDisplayName,
  platform: deviceMetadataShape.platform,
  arch: deviceMetadataShape.architecture,
  version: deviceMetadataShape.agentVersion,
  installation: deviceMetadataShape.installationId,
  /** Epoch milliseconds at start time — a soft freshness bound (see
   * isStartPayloadFresh). */
  issued: z.coerce.number().int().positive(),
});
export type DesktopConnectPayload = z.infer<typeof desktopConnectPayloadSchema>;

/** POST /api/desktop/auth/exchange request body. `pairingId` is REQUIRED
 * (the plan sketched it optional): it is the indexed lookup handle, so the
 * secret code is only ever compared against a hash, never used as a key. */
export const desktopPairingExchangeSchema = z.object({
  pairingId: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  code: z.string().regex(BASE64URL_43_128),
  codeVerifier: z.string().regex(BASE64URL_43_128),
});
export type DesktopPairingExchangeRequest = z.infer<
  typeof desktopPairingExchangeSchema
>;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random 128-bit base64url pairing handle (22 chars). */
export function generatePairingId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Random 256-bit base64url one-time code (43 chars) — stored only hashed. */
export function generateOneTimeCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** SHA-256 of an ASCII string, base64url — used for both the one-time-code
 * hash and RFC 7636 S256 verifier checks (identical construction). */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Soft freshness bound on the start payload's `issued` timestamp. The start
 * route is stateless, so this value is agent-supplied and forgeable — but
 * forging it only widens the forger's OWN pre-consent window; the security
 * TTL is the server-stamped expires_at on the consent-time row. This check
 * exists so a stale pairing link fails with an honest "expired" message
 * instead of a code the agent has long stopped waiting for.
 */
export function isStartPayloadFresh(issuedMs: number, now = Date.now()): boolean {
  return (
    issuedMs <= now + START_FRESHNESS_SKEW_MS &&
    now - issuedMs <= DESKTOP_PAIRING_TTL_MS
  );
}

/**
 * Step 1 — pure. Mints the pairing handle and composes the browser URL the
 * agent opens. `origin` is the request's own origin so dev/preview/prod all
 * pair against the host the user will actually consent on.
 */
export function startDesktopPairing(
  input: DesktopPairingStartRequest,
  origin: string,
  now = Date.now(),
): { pairingId: string; browserUrl: string; expiresAt: string } {
  const pairingId = generatePairingId();
  const url = new URL("/desktop/connect", origin);
  url.searchParams.set("pairing", pairingId);
  url.searchParams.set("challenge", input.codeChallenge);
  url.searchParams.set("state", input.state);
  url.searchParams.set("name", input.deviceDisplayName);
  url.searchParams.set("platform", input.platform);
  url.searchParams.set("arch", input.architecture);
  url.searchParams.set("version", input.agentVersion);
  url.searchParams.set("installation", input.installationId);
  url.searchParams.set("issued", String(now));
  return {
    pairingId,
    browserUrl: url.toString(),
    expiresAt: new Date(now + DESKTOP_PAIRING_TTL_MS).toISOString(),
  };
}

export type DesktopConsentOutcome =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: "team_org" | "expired" | "already_used" };

/**
 * Step 2 — the consent-time write. Creates the org-scoped pairing row bound
 * to the SESSION user (there is deliberately no parameter naming another
 * user — a member can only ever mint a self-owned device, structurally) and
 * returns the deep-link redirect carrying the one-time code.
 *
 * D-DA-2: Personal orgs only — a Team org gets an honest refusal, and the
 * page never renders a mint path for one either (this is the defense-in-depth
 * layer under it).
 */
export async function consentDesktopPairing(
  scope: OrgScopedDb,
  input: {
    payload: DesktopConnectPayload;
    userId: string;
    orgKind: string;
    now?: number;
  },
): Promise<DesktopConsentOutcome> {
  const now = input.now ?? Date.now();
  if (input.orgKind !== "personal") {
    return { ok: false, error: "team_org" };
  }
  if (!isStartPayloadFresh(input.payload.issued, now)) {
    return { ok: false, error: "expired" };
  }

  // Opportunistic self-reclamation: sweep this org's already-expired rows on
  // the way in, so the table cleans up on use without a cron (org deletion is
  // the cascade backstop). One bounded statement.
  await scope.desktopPairing.deleteExpired(new Date(now));

  const code = generateOneTimeCode();
  const codeHash = await sha256Base64Url(code);
  let rowId: string;
  try {
    const row = await scope.desktopPairing.create({
      pairingId: input.payload.pairing,
      codeChallenge: input.payload.challenge,
      codeHash,
      consentedUserId: input.userId,
      deviceDisplayName: input.payload.name,
      platform: input.payload.platform,
      architecture: input.payload.arch,
      agentVersion: input.payload.version,
      installationId: input.payload.installation,
      expiresAt: new Date(now + DESKTOP_PAIRING_TTL_MS),
    });
    rowId = row.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Consent-form replay (double-click, resubmitted form): the handle
      // already minted a code. Never mint a second one.
      return { ok: false, error: "already_used" };
    }
    throw error;
  }

  // Accountability (ADR 0010): who approved which device. Never the code,
  // never its hash.
  await scope.auditLog.record({
    actorUserId: input.userId,
    action: "desktop.pairing_consent",
    targetKind: "desktop_pairing",
    targetId: rowId,
    metadata: {
      pairingId: input.payload.pairing,
      deviceDisplayName: input.payload.name,
      platform: input.payload.platform,
    },
  });

  const redirect = new URL(DESKTOP_CALLBACK_URL);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", input.payload.state);
  redirect.searchParams.set("pairing", input.payload.pairing);
  return { ok: true, redirectUrl: redirect.toString() };
}

export type DesktopExchangeOutcome = {
  status: 200 | 400 | 404;
  body: Record<string, unknown>;
};

/**
 * Step 3 — the unauthenticated exchange. Error semantics (plan §5 T2.2):
 * unknown pairing handle → 404; everything verifiable-but-wrong (expired,
 * already used, wrong code, verifier mismatch) → 400. Cross-org confusion is
 * structurally impossible: the handle is globally unique and carries its
 * org, and the minted connection rides forOrg(row.orgId) end to end.
 *
 * The token appears ONCE, in this response body — it is never logged, never
 * stored (only the envelope-encrypted secret is), and never readable again.
 */
export async function exchangeDesktopPairing(
  db: Db,
  env: CredentialEnv,
  rawBody: unknown,
  now = Date.now(),
): Promise<DesktopExchangeOutcome> {
  const parsed = desktopPairingExchangeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "invalid request", issues: parsed.error.flatten() },
    };
  }
  const { pairingId, code, codeVerifier } = parsed.data;

  const row = await findDesktopPairingByPairingId(db, pairingId);
  if (!row) {
    return { status: 404, body: { error: "unknown pairing" } };
  }
  if (row.expiresAt.getTime() <= now) {
    return { status: 400, body: { error: "code expired" } };
  }
  if (row.usedAt !== null) {
    return { status: 400, body: { error: "code already used" } };
  }
  const codeHash = await sha256Base64Url(code);
  if (!timingSafeEqualStr(codeHash, row.codeHash)) {
    return { status: 400, body: { error: "invalid code" } };
  }
  // RFC 7636 S256: BASE64URL(SHA256(ascii(verifier))) must equal the
  // challenge the agent registered at start time.
  const challenge = await sha256Base64Url(codeVerifier);
  if (!timingSafeEqualStr(challenge, row.codeChallenge)) {
    return { status: 400, body: { error: "code verifier mismatch" } };
  }

  const scoped = forOrg(db, row.orgId);
  // Single-use CAS: exactly one of two racing exchanges wins the claim.
  const claimed = await scoped.desktopPairing.claimUse(row.id);
  if (!claimed) {
    return { status: 400, body: { error: "code already used" } };
  }

  // Mint the device connection + its envelope-encrypted device_token
  // credential — the EXISTING pairing machinery (ADR 0002): vendor and
  // authKind values are reused verbatim, no new enum values anywhere.
  const connection = await scoped.connections.create({
    vendor: "claude_code_local",
    displayName: row.deviceDisplayName,
    authKind: "device_token",
    config: {
      source: "desktop-agent",
      platform: row.platform,
      architecture: row.architecture,
      agentVersion: row.agentVersion,
      installationId: row.installationId,
      // Self-ownership record (ADR 0047): the member who consented. config
      // is the non-secret settings column; this is an id, never a name.
      pairedByUserId: row.consentedUserId,
    },
  });
  const secret = generateAgentSecret();
  await scoped.connections.storeCredential(
    connection.id,
    "device_token",
    secret,
    env,
  );
  await scoped.desktopPairing.setConnection(row.id, connection.id);

  // Audit the mint (ADR 0010). No session exists here — the actor is the
  // device, authorized by the recorded consent — so actorUserId is honestly
  // null and the consenting user rides metadata. BEST-EFFORT like the
  // agent-token route: the token below is readable ONLY from this response,
  // so an audit-insert failure must not 500 it away.
  await scoped.auditLog
    .record({
      actorUserId: null,
      action: "desktop.pairing_exchange",
      targetKind: "connection",
      targetId: connection.id,
      metadata: { pairingId, consentedUserId: row.consentedUserId },
    })
    .catch((error) => {
      console.error(
        `[audit] desktop.pairing_exchange write failed for ${connection.id}:`,
        error,
      );
    });

  return {
    status: 200,
    body: {
      token: composeAgentToken(row.orgId, connection.id, secret),
      deviceId: connection.id,
      orgId: row.orgId,
    },
  };
}
