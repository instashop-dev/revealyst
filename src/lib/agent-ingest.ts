import {
  agentIngestRequestSchema,
  type AgentIngestRequest,
} from "../contracts/api";
import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { parseAgentToken, timingSafeEqualStr } from "./agent-token";
import type { CredentialEnv } from "./credentials";

// Core of POST /api/agent/ingest (ADR 0002), kept out of the Next route
// handler so it is unit-testable against PGlite. Auth and tenancy both
// derive from the device token: the org scope is the token's own orgId, so
// there is no path to another org's rows, and the AAD-bound credential
// verify fails for a token replayed against a foreign connection.

export type AgentIngestOutcome =
  | {
      ok: true;
      status: 200;
      body: { ok: true; subjects: number; records: number; signals: number };
    }
  | { ok: false; status: 400 | 401; body: { error: string } };

const unauthorized: AgentIngestOutcome = {
  ok: false,
  status: 401,
  // One message for every auth-shaped failure — a probe can't distinguish
  // "no such connection" from "wrong secret".
  body: { error: "invalid device token" },
};

function badRequest(error: string): AgentIngestOutcome {
  return { ok: false, status: 400, body: { error } };
}

export async function ingestAgentBatch(
  db: Db,
  env: CredentialEnv,
  bearerToken: string,
  rawBody: unknown,
): Promise<AgentIngestOutcome> {
  const token = parseAgentToken(bearerToken);
  if (!token) {
    return unauthorized;
  }

  const parsed = agentIngestRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest(
      `invalid ingest body: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const body: AgentIngestRequest = parsed.data;

  // Every record/signal must reference a declared subject — catches CLI
  // bugs before anything is written.
  const declared = new Set(
    body.subjects.map((s) => `${s.kind}:${s.externalId}`),
  );
  for (const r of [...body.records, ...body.signals]) {
    const key = `${r.subject.kind}:${r.subject.externalId}`;
    if (!declared.has(key)) {
      return badRequest(`undeclared subject referenced: ${key}`);
    }
  }

  const scoped = forOrg(db, token.orgId);
  const connection = await scoped.connections.get(token.connectionId);
  if (!connection || connection.authKind !== "device_token") {
    return unauthorized;
  }

  let secretMatches: boolean;
  try {
    secretMatches = await scoped.connections.withCredential(
      token.connectionId,
      "device_token",
      env,
      async (stored) => timingSafeEqualStr(stored, token.secret),
    );
  } catch {
    // Missing credential, expired credential, or AAD/decrypt failure — all
    // collapse to the same 401.
    return unauthorized;
  }
  if (!secretMatches) {
    return unauthorized;
  }

  // Land the sanitized batch itself as the raw payload (it contains only
  // metric shapes by construction) so normalization stays replayable and
  // records carry a raw_payload_id like every other connector.
  const rawRow = await scoped.raw.insert({
    connectionId: connection.id,
    vendor: connection.vendor,
    kind: "agent.ingest",
    windowStart: new Date(`${body.window.start}T00:00:00.000Z`),
    windowEnd: new Date(`${body.window.end}T00:00:00.000Z`),
    payload: body,
  });

  const subjectRows = await scoped.subjects.upsertMany(
    connection.id,
    body.subjects,
  );
  const subjectIds = new Map(
    subjectRows.map((s) => [`${s.kind}:${s.externalId}`, s.id]),
  );

  const sourceConnector = `claude-code-local@${body.summarizerVersion}`;
  await scoped.metrics.upsertRecords(
    body.records.map((r) => ({
      subjectId: subjectIds.get(`${r.subject.kind}:${r.subject.externalId}`)!,
      metricKey: r.metricKey,
      day: r.day,
      dim: r.dim,
      connectionId: connection.id,
      value: r.value,
      attribution: r.attribution,
      sourceConnector,
      rawPayloadId: rawRow.id,
    })),
  );
  await scoped.metrics.upsertSignals(
    body.signals.map((s) => ({
      subjectId: subjectIds.get(`${s.subject.kind}:${s.subject.externalId}`)!,
      day: s.day,
      hours: s.hours,
      peakConcurrency: s.peakConcurrency,
      sourceGranularity: s.sourceGranularity,
    })),
  );
  await scoped.connections.markSynced(connection.id);

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      subjects: subjectRows.length,
      records: body.records.length,
      signals: body.signals.length,
    },
  };
}
