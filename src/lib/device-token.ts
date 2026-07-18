import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { parseAgentToken, timingSafeEqualStr } from "./agent-token";
import type { CredentialEnv } from "./credentials";
import {
  type DesktopAccessTokenEnv,
  verifyDesktopAccessToken,
} from "./desktop-access-token";

// Shared device-token verifier (Desktop Agent plan T2.1). Moved VERBATIM out
// of src/lib/otel-receiver.ts so all three device-token call sites —
// /api/agent/ingest (agent-ingest.ts), /v1/metrics, and /v1/logs — share ONE
// implementation and their 401/403 semantics can never drift apart.
//
// Two deliberate, additive deviations from the byte-identical move, so
// agent-ingest could adopt it with zero behavior change:
// - `DeviceTokenAuthSuccess` also carries the `connection` row the verifier
//   already fetched (agent-ingest needs it post-auth; returning it avoids an
//   extra DB round-trip — on Workers → Hyperdrive → Neon, per-round-trip cost
//   dominates).
// - `DeviceTokenAuthFailure.body` is typed `{ error: string }` (what the two
//   failure bodies always were) instead of `Record<string, unknown>`, so
//   callers with a typed error body compose without a cast.
// The runtime auth logic — checks, ordering, status codes, bodies — is
// unchanged.

/** A device-token auth failure — shared shape for any device-token route. */
type DeviceTokenAuthFailure = {
  ok: false;
  status: 401 | 403;
  body: { error: string };
};

/** The connection row `authenticateDeviceToken` resolved the token against. */
export type DeviceTokenConnection = NonNullable<
  Awaited<ReturnType<ReturnType<typeof forOrg>["connections"]["get"]>>
>;

/** A successful device-token auth — the org scope + connection to act on. */
export type DeviceTokenAuthSuccess = {
  ok: true;
  orgId: string;
  connectionId: string;
  scoped: ReturnType<typeof forOrg>;
  /** The connection row already fetched during auth (saves a re-read). */
  connection: DeviceTokenConnection;
};

export type DeviceTokenAuthResult =
  | DeviceTokenAuthSuccess
  | DeviceTokenAuthFailure;

const unauthorized: DeviceTokenAuthFailure = {
  ok: false,
  status: 401,
  // One message for every auth-shaped failure — a probe can't distinguish
  // "no such connection" from "wrong secret".
  body: { error: "invalid device token" },
};

/**
 * Authenticate a request by its bearer device token — the single scheme for
 * agent-ingest and the OTLP receivers: parse the
 * `rva1.<orgId>.<connectionId>.<secret>` token, look up the connection, and
 * timing-safe-compare the stored secret. Shared by `/api/agent/ingest`,
 * `/v1/metrics`, and `/v1/logs` so their 401/403 semantics never drift apart:
 * 401 for a missing/malformed/wrong-kind token or connection, 403 only once
 * authenticated but the connection is paused. Cheap and run BEFORE the
 * request body is parsed.
 */
export async function authenticateDeviceToken(
  db: Db,
  env: CredentialEnv,
  bearerToken: string,
): Promise<DeviceTokenAuthResult> {
  const token = parseAgentToken(bearerToken);
  if (!token) return unauthorized;

  const scoped = forOrg(db, token.orgId);
  const connection = await scoped.connections.get(token.connectionId);
  if (!connection || connection.authKind !== "device_token") return unauthorized;
  try {
    await scoped.connections.withCredential(
      token.connectionId,
      "device_token",
      env,
      async (stored) => {
        // Throw (not return-false) on mismatch so withCredential's
        // last_used_at stamp only ever records a GENUINE match — forged
        // probes must not read as legitimate device activity.
        if (!timingSafeEqualStr(stored, token.secret)) {
          throw new Error("device token mismatch");
        }
      },
    );
  } catch {
    // Missing credential, expired credential, AAD/decrypt failure, or
    // secret mismatch — all collapse to the same 401.
    return unauthorized;
  }
  // A paused connection is the operator's revocation gesture: reject after
  // auth (the caller proved identity, so a specific message leaks nothing).
  if (connection.status === "paused") {
    return { ok: false, status: 403, body: { error: "connection paused" } };
  }

  return {
    ok: true,
    orgId: token.orgId,
    connectionId: token.connectionId,
    scoped,
    connection,
  };
}

/**
 * Resolve an already-verified access token's (org, connection) to the SAME
 * success shape a device token produces: re-fetch the connection row (agent
 * callers need it, and the read enforces revocation) and re-run the post-auth
 * checks device tokens get. Crucially, a still-unexpired access token is
 * REJECTED the moment its connection is deleted, its kind changes, or it is
 * paused — the operator's revocation gesture is honored immediately, not only
 * after the token's short TTL lapses. The paused case returns a specific 403
 * (the caller already proved a valid, signed identity, so it leaks nothing).
 */
async function resolveAccessTokenConnection(
  db: Db,
  orgId: string,
  connectionId: string,
): Promise<DeviceTokenAuthResult> {
  const scoped = forOrg(db, orgId);
  const connection = await scoped.connections.get(connectionId);
  if (!connection || connection.authKind !== "device_token") {
    return unauthorized;
  }
  if (connection.status === "paused") {
    return { ok: false, status: 403, body: { error: "connection paused" } };
  }
  return { ok: true, orgId, connectionId, scoped, connection };
}

/**
 * The BACKWARD-COMPATIBLE desktop authenticator (T7.2, ADR 0058). Accepts
 * EITHER a short-lived signed access token (the target state, minted at
 * /api/desktop/auth/refresh) OR the long-lived `rva1.` device token (the
 * legacy path an already-paired agent still uses during rollout). This is a
 * drop-in for `authenticateDeviceToken` at every authenticated desktop
 * endpoint — its result type is identical, so the downstream ingest/config/
 * diagnostics/OTLP logic is untouched.
 *
 * Structural routing, not a guess: a device token is exactly
 * `rva1.<uuid>.<uuid>.<secret>` (4 dot-parts, `rva1` prefix); an access token
 * is a 3-part JWT. So the credential TYPE is unambiguous from its shape, and
 * the two verification paths never overlap. Both paths return the same 401 for
 * any failure and 403 only for an authenticated-but-paused connection — the
 * device-token failure semantics are preserved exactly.
 *
 * If the access-token signing key is not configured (CI/dev, or a deploy that
 * hasn't enabled rotation yet), access-token verification simply fails and the
 * device-token path keeps working — never a hard cutover.
 */
export async function authenticateDesktopBearer(
  db: Db,
  env: CredentialEnv & DesktopAccessTokenEnv,
  bearerToken: string,
): Promise<DeviceTokenAuthResult> {
  // A device token carries the `rva1.` prefix; anything else is treated as an
  // access token (a JWT). Route by shape so the two credentials never collide.
  if (bearerToken.startsWith("rva1.")) {
    return authenticateDeviceToken(db, env, bearerToken);
  }
  const verified = await verifyDesktopAccessToken(env, bearerToken);
  if (!verified.ok) return unauthorized;
  return resolveAccessTokenConnection(
    db,
    verified.orgId,
    verified.connectionId,
  );
}
