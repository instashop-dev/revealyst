import type { Db } from "../db/client";
import type { CredentialEnv } from "./credentials";
import {
  authenticateDeviceToken,
  type DeviceTokenAuthSuccess,
} from "./device-token";
import { decodeOtelMetrics } from "./otel-ingest";

// Device-token auth moved to src/lib/device-token.ts (T2.1) so agent-ingest,
// /v1/metrics, and /v1/logs share one verifier. Re-exported here because the
// /v1/* routes and tests historically import it from this module.
export {
  authenticateDeviceToken,
  type DeviceTokenAuthResult,
  type DeviceTokenAuthSuccess,
} from "./device-token";

// W7-8 OTel receiver (ADR 0039). Ingests Claude Code OTLP/HTTP-JSON metric
// exports and lands proficiency MARKERS in metric_records. Reuses the same
// device-token auth as agent-ingest (`rva1.<orgId>.<connectionId>.<secret>`) —
// the token identifies org + connection; the subject (person) comes from the
// payload's `user.id`/email/developer.name (via the pure decoder). Markers are
// DISTINCT metric keys from any connector's, so they never double-count a
// connector event. Returns an OTLP success response ({} = full success).

/** The OTLP sourceConnector tag stamped on marker records. Exported so the
 * demo seed's marker emitter (scripts/seed/activity.ts) can be test-pinned
 * against the real receiver's tag instead of drifting silently. */
export const OTEL_SOURCE = "claude-code-otel@1";

export type OtelReceiverOutcome = {
  ok: boolean;
  status: number;
  /** OTLP ExportMetricsServiceResponse — {} means full success. */
  body: Record<string, unknown>;
  markersIngested?: number;
};

/**
 * Authenticate, decode, and persist an OTLP metrics export. All logic here so it
 * is unit-testable against PGlite + the real captured fixtures; the route only
 * adapts HTTP. The route itself authenticates FIRST (via
 * `authenticateDeviceToken`) so 401/403 happen before the body is parsed —
 * same ordering as /v1/logs — then hands the auth to
 * `ingestOtelMetricsAuthed`; this wrapper keeps the original
 * auth-inclusive contract for tests and any future single-call use.
 */
export async function ingestOtelMetrics(
  db: Db,
  env: CredentialEnv,
  bearerToken: string,
  rawBody: unknown,
): Promise<OtelReceiverOutcome> {
  // 1. Authenticate (cheap, before touching the body) — identical to
  //    agent-ingest: parse the token, verify the connection + its device secret.
  const auth = await authenticateDeviceToken(db, env, bearerToken);
  if (!auth.ok) return { ok: false, status: auth.status, body: auth.body };
  return ingestOtelMetricsAuthed(auth, rawBody);
}

/** Decode + persist an ALREADY-authenticated OTLP metrics export. */
export async function ingestOtelMetricsAuthed(
  auth: DeviceTokenAuthSuccess,
  rawBody: unknown,
): Promise<OtelReceiverOutcome> {
  const { scoped, connectionId } = auth;

  // 2. Decode markers (pure, quirk-handling). Nothing to persist → OTLP success.
  const markers = decodeOtelMetrics(rawBody);
  if (markers.length === 0) return { ok: true, status: 200, body: {} };

  // 3. Resolve the payload's subject keys to Revealyst subjects on THIS
  //    connection (idempotent upsert), then map key → id.
  const subjectKeys = [...new Set(markers.map((m) => m.subjectKey))];
  const subjectRows = await scoped.subjects.upsertMany(
    connectionId,
    subjectKeys.map((k) => ({ kind: "person" as const, externalId: k })),
  );
  const idByKey = new Map(subjectRows.map((s) => [s.externalId, s.id]));

  // 4. Upsert marker records on the frozen natural key (org, subject, metric,
  //    day, dim) — a re-export of the same day is authoritative, not additive
  //    across POSTs (the decoder already summed within this payload).
  const records = markers
    .map((m) => ({
      subjectId: idByKey.get(m.subjectKey),
      metricKey: m.metricKey,
      day: m.day,
      dim: "",
      connectionId,
      value: m.value,
      attribution: "person" as const,
      sourceConnector: OTEL_SOURCE,
    }))
    .filter((r): r is typeof r & { subjectId: string } => Boolean(r.subjectId));

  await scoped.metrics.upsertRecords(records);
  return { ok: true, status: 200, body: {}, markersIngested: records.length };
}
