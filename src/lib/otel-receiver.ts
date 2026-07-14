import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { parseAgentToken, timingSafeEqualStr } from "./agent-token";
import type { CredentialEnv } from "./credentials";
import { decodeOtelMetrics } from "./otel-ingest";

// W7-8 OTel receiver (ADR 0039). Ingests Claude Code OTLP/HTTP-JSON metric
// exports and lands proficiency MARKERS in metric_records. Reuses the same
// device-token auth as agent-ingest (`rva1.<orgId>.<connectionId>.<secret>`) —
// the token identifies org + connection; the subject (person) comes from the
// payload's `user.id`/email/developer.name (via the pure decoder). Markers are
// DISTINCT metric keys from any connector's, so they never double-count a
// connector event. Returns an OTLP success response ({} = full success).

/** The OTLP sourceConnector tag stamped on marker records. */
const OTEL_SOURCE = "claude-code-otel@1";

export type OtelReceiverOutcome = {
  ok: boolean;
  status: number;
  /** OTLP ExportMetricsServiceResponse — {} means full success. */
  body: Record<string, unknown>;
  markersIngested?: number;
};

const unauthorized: OtelReceiverOutcome = {
  ok: false,
  status: 401,
  body: { error: "invalid device token" },
};

/**
 * Authenticate, decode, and persist an OTLP metrics export. All logic here so it
 * is unit-testable against PGlite + the real captured fixtures; the route only
 * adapts HTTP.
 */
export async function ingestOtelMetrics(
  db: Db,
  env: CredentialEnv,
  bearerToken: string,
  rawBody: unknown,
): Promise<OtelReceiverOutcome> {
  // 1. Authenticate (cheap, before touching the body) — identical to
  //    agent-ingest: parse the token, verify the connection + its device secret.
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
        if (!timingSafeEqualStr(stored, token.secret)) {
          throw new Error("device token mismatch");
        }
      },
    );
  } catch {
    return unauthorized;
  }
  if (connection.status === "paused") {
    return { ok: false, status: 403, body: { error: "connection paused" } };
  }

  // 2. Decode markers (pure, quirk-handling). Nothing to persist → OTLP success.
  const markers = decodeOtelMetrics(rawBody);
  if (markers.length === 0) return { ok: true, status: 200, body: {} };

  // 3. Resolve the payload's subject keys to Revealyst subjects on THIS
  //    connection (idempotent upsert), then map key → id.
  const subjectKeys = [...new Set(markers.map((m) => m.subjectKey))];
  const subjectRows = await scoped.subjects.upsertMany(
    token.connectionId,
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
      connectionId: token.connectionId,
      value: m.value,
      attribution: "person" as const,
      sourceConnector: OTEL_SOURCE,
    }))
    .filter((r): r is typeof r & { subjectId: string } => Boolean(r.subjectId));

  await scoped.metrics.upsertRecords(records);
  return { ok: true, status: 200, body: {}, markersIngested: records.length };
}
