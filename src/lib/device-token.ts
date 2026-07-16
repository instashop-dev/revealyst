import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { parseAgentToken, timingSafeEqualStr } from "./agent-token";
import type { CredentialEnv } from "./credentials";

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
