import { z } from "zod";
import type { Db } from "../db/client";
import type { CredentialEnv } from "./credentials";
import { authenticateDeviceToken } from "./device-token";
import { DEVICE_VENDOR } from "./desktop-devices";

// Core of POST /api/desktop/heartbeat (Desktop Agent plan T2.4), kept out of
// the Next route handler so it is unit-testable against PGlite (the
// agent-ingest / otel-receiver pattern). Auth and tenancy both derive from the
// device token — the org scope is the token's own orgId, so there is no path
// to another org's rows.
//
// A heartbeat carries COUNTS ONLY — the agent's current version string and a
// queue-depth integer. It never carries activity content (spec §23: the
// diagnostics/liveness channel excludes activity payloads by default).
//
// Ordering mirrors agent-ingest: cheap token auth FIRST (a revoked/paused
// device is rejected before the body is parsed), body validation only for a
// caller holding a real credential.

/**
 * Strict heartbeat body. `agentVersion` is a bounded string (the agent may
 * have self-updated since pairing — this refreshes the displayed version);
 * `queueDepth` is a non-negative integer count (rejects non-numeric / oversized
 * / negative payloads). No other keys are accepted.
 */
export const desktopHeartbeatSchema = z
  .object({
    agentVersion: z.string().trim().min(1).max(64),
    queueDepth: z.number().int().min(0).max(10_000_000),
  })
  .strict();

export type DesktopHeartbeatOutcome = {
  status: 200 | 400 | 401 | 403;
  body: Record<string, unknown>;
};

/**
 * Authenticate the device token, then stamp the heartbeat into the device
 * connection's config (via `recordDeviceHeartbeat`). Returns the outcome the
 * route serializes. A paused/revoked device fails auth (403 paused / 401
 * credential gone) and never reaches the write.
 */
export async function recordDesktopHeartbeat(
  db: Db,
  env: CredentialEnv,
  bearerToken: string,
  rawBody: unknown,
  now?: Date,
): Promise<DesktopHeartbeatOutcome> {
  // --- 1. Authenticate (cheap, before touching the body) ---------------
  const auth = await authenticateDeviceToken(db, env, bearerToken);
  if (!auth.ok) {
    return { status: auth.status, body: auth.body };
  }
  // Heartbeats are for desktop devices only. Every device_token connection is
  // a desktop device today (claude_code_local is the sole device_token
  // vendor), but restrict explicitly so a future device_token vendor can't
  // have heartbeat fields written onto its config. Indistinguishable 401.
  if (auth.connection.vendor !== DEVICE_VENDOR) {
    return { status: 401, body: { error: "invalid device token" } };
  }

  // --- 2. Validate (authenticated callers only) -------------------------
  const parsed = desktopHeartbeatSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "invalid request", issues: parsed.error.flatten() },
    };
  }

  // --- 3. Stamp the heartbeat (counts only, into config jsonb) ----------
  await auth.scoped.connections.recordDeviceHeartbeat(auth.connectionId, {
    agentVersion: parsed.data.agentVersion,
    queueDepth: parsed.data.queueDepth,
    now,
  });

  return { status: 200, body: { ok: true } };
}
