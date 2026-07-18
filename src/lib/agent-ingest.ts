import {
  agentIngestRequestSchema,
  agentSourceConnector,
  type AgentIngestRequest,
} from "../contracts/api";
import { isValidAiToolDim, isValidTaskCategoryDim } from "../contracts/metrics";
import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import type { PollMessage } from "../poller/messages";
import { previousDay } from "../scoring";
import type { CredentialEnv } from "./credentials";
import type { DesktopAccessTokenEnv } from "./desktop-access-token";
import { authenticateDesktopBearer } from "./device-token";

// Core of POST /api/agent/ingest (ADR 0002), kept out of the Next route
// handler so it is unit-testable against PGlite. Auth and tenancy both
// derive from the device token: the org scope is the token's own orgId, so
// there is no path to another org's rows, and the AAD-bound credential
// verify fails for a token replayed against a foreign connection.
//
// Ordering is deliberate: cheap token auth FIRST, expensive body
// validation only for callers holding a real credential (no
// unauthenticated zod-parse of 100k-row payloads).

export type AgentIngestOutcome =
  | {
      ok: true;
      status: 200;
      body: { ok: true; subjects: number; records: number; signals: number };
    }
  | { ok: false; status: 400 | 401 | 403; body: { error: string } };

/** A dimensionless metric has dim ""; a dimensioned one is "model=<id>" /
 * "feature=<name>". 128 chars is generous for any real label and hostile
 * to content smuggling. */
const MAX_DIM_LENGTH = 128;

function badRequest(error: string): AgentIngestOutcome {
  return { ok: false, status: 400, body: { error } };
}

export type AgentIngestDeps = {
  /** Queue producer for the post-commit score-recompute enqueue (Fix 2).
   * Injected (mirroring PollDeps.send) so this stays PGlite-unit-testable;
   * the route supplies POLL_QUEUE.send. Optional: absent in tests that
   * don't care, and the enqueue is best-effort either way. */
  send?: (message: PollMessage) => Promise<void>;
};

export async function ingestAgentBatch(
  db: Db,
  env: CredentialEnv & DesktopAccessTokenEnv,
  bearerToken: string,
  rawBody: unknown,
  deps: AgentIngestDeps = {},
): Promise<AgentIngestOutcome> {
  // --- 1. Authenticate (cheap, before touching the body) ---------------
  // Shared verifier (T2.1, src/lib/device-token.ts) — semantics identical to
  // the inline check this replaced: 401 for a malformed token / unknown
  // connection / wrong authKind / wrong secret (one indistinguishable
  // message), 403 only for an authenticated-but-paused connection (the
  // operator's revocation gesture — ingest never re-activates it), all
  // BEFORE the body is parsed. The success carries the connection row the
  // verifier already fetched, so adoption added no DB round-trip.
  // Accepts EITHER the short-lived access token OR the legacy device token
  // (T7.2, ADR 0058) — semantics otherwise identical to the device-token-only
  // check this replaced.
  const auth = await authenticateDesktopBearer(db, env, bearerToken);
  if (!auth.ok) {
    return { ok: false, status: auth.status, body: auth.body };
  }
  const { connection, orgId } = auth;

  // --- 2. Validate (authenticated callers only) -------------------------
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

  if (body.window.start > body.window.end) {
    return badRequest("window.start must be <= window.end");
  }

  // Every record/signal must reference a declared subject, carry a day
  // inside the declared window (a re-push is authoritative for its window,
  // so out-of-window days would silently escape restatement), and never
  // claim person attribution for a non-person subject (invariant b).
  const declared = new Set(
    body.subjects.map((s) => `${s.kind}:${s.externalId}`),
  );
  for (const item of [...body.records, ...body.signals]) {
    const key = `${item.subject.kind}:${item.subject.externalId}`;
    if (!declared.has(key)) {
      return badRequest(`undeclared subject referenced: ${key}`);
    }
    if (item.day < body.window.start || item.day > body.window.end) {
      return badRequest(`day ${item.day} outside declared window`);
    }
  }
  for (const record of body.records) {
    if (record.attribution === "person" && record.subject.kind !== "person") {
      return badRequest(
        `person attribution claimed for ${record.subject.kind} subject — never fabricate people`,
      );
    }
    // Defense in depth: the frozen metric_records.dim is unbounded, and a
    // connector's dim is derived from vendor free text (here, the log's
    // message.model). A hostile local process can plant a log to smuggle
    // content through dim; bound its length and reject control characters
    // so it can never be an exfil channel. The CLI also sanitizes model
    // before it becomes a dim — this is the server-side backstop.
    const hasControlChar = Array.from(record.dim).some(
      (c) => c.charCodeAt(0) <= 0x20,
    );
    if (record.dim.length > MAX_DIM_LENGTH || hasControlChar) {
      return badRequest(
        "dim too long or contains whitespace/control characters",
      );
    }
    // Closed-enum backstop for ai_tool_used (ADR 0057): its `dim` MUST be
    // exactly `tool=<id>` with `id` in the closed AI-app enum (AI_TOOL_IDS).
    // The device validator already rejects an out-of-set label; this is the
    // server-side twin, so an in-length-range but out-of-enum value (a smuggled
    // snippet) is a 400, never a stored dim. Other metric keys keep the generic
    // length/charset bound above — only ai_tool_used is a closed enum today.
    if (record.metricKey === "ai_tool_used" && !isValidAiToolDim(record.dim)) {
      return badRequest(
        "ai_tool_used dim must be tool=<known AI app> from the closed enum",
      );
    }
    // Closed-enum backstop for task_category (ADR 0059): its `dim` MUST be
    // exactly `task_category=<id>` with `id` in the closed work-type enum
    // (TASK_CATEGORY_IDS). The device classifier is a closed Rust enum and the
    // device validator already rejects an out-of-set label; this is the
    // server-side twin, so an in-length-range but out-of-enum value (a smuggled
    // prompt snippet) is a 400, never a stored dim.
    if (
      record.metricKey === "task_category" &&
      !isValidTaskCategoryDim(record.dim)
    ) {
      return badRequest(
        "task_category dim must be task_category=<known work type> from the closed enum",
      );
    }
  }

  // --- 3. Write (transactional: a re-push replaces the window) ----------
  // The server composes the source_connector from the batch's declared source
  // (ADR 0060) — `claude-code-local@<v>` for the live connector (unchanged
  // default), `claude_export@1` for an export import. The window-delete is
  // scoped to THIS source, so an export re-push never clobbers the live
  // connector's overlapping days (D-DA-8), and vice versa.
  const source = body.source ?? "claude-code-local";
  const sourceConnector = agentSourceConnector(source, body.summarizerVersion);
  // The shared device connection's sub-daily signals are owned solely by the
  // live `claude-code-local` source (subject_day_signals has no source column,
  // so it cannot be scoped per source). The `claude-export` import contributes
  // day-level records only — it must neither delete nor upsert signals, or it
  // would wipe the live connector's histograms. So skip the signal sweep for it.
  const isExportSource = source === "claude-export";
  const counts = await db.transaction(async (tx) => {
    const txScoped = forOrg(tx as unknown as Db, orgId);

    // Land the sanitized batch itself as the raw payload (it contains only
    // metric shapes by construction) so normalization stays replayable and
    // records carry a raw_payload_id like every other connector.
    const rawRow = await txScoped.raw.insert({
      connectionId: connection.id,
      vendor: connection.vendor,
      kind: "agent.ingest",
      windowStart: new Date(`${body.window.start}T00:00:00.000Z`),
      windowEnd: new Date(`${body.window.end}T00:00:00.000Z`),
      payload: body,
    });

    const subjectRows = await txScoped.subjects.upsertMany(
      connection.id,
      body.subjects,
    );
    const subjectIds = new Map(
      subjectRows.map((s) => [`${s.kind}:${s.externalId}`, s.id]),
    );

    // Delete-then-upsert: stale natural keys (a model dim that vanished
    // from a corrected batch) must not survive a restatement. Scoped to this
    // source (ADR 0060); the export source leaves signals untouched.
    await txScoped.metrics.deleteWindowForConnection(
      connection.id,
      sourceConnector,
      body.window.start,
      body.window.end,
      { deleteSignals: !isExportSource },
    );
    await txScoped.metrics.upsertRecords(
      body.records.map((r) => ({
        subjectId: subjectIds.get(
          `${r.subject.kind}:${r.subject.externalId}`,
        )!,
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
    await txScoped.metrics.upsertSignals(
      body.signals.map((s) => ({
        subjectId: subjectIds.get(
          `${s.subject.kind}:${s.subject.externalId}`,
        )!,
        day: s.day,
        hours: s.hours,
        peakConcurrency: s.peakConcurrency,
        sourceGranularity: s.sourceGranularity,
      })),
    );
    await txScoped.connections.markSynced(connection.id);

    // ADR 0025 gap sink: land the batch's honesty gaps where the dashboard
    // readers actually collect them (connector_runs.gaps → collectGaps) —
    // previously agent-pushed gaps were validated and then silently buried
    // in the raw_payloads blob, invisible to every reader. One completed
    // run row per accepted push (append-only, like poll attempts);
    // read-time dedupe collapses repeats across runs.
    const run = await txScoped.connectorRuns.start({
      connectionId: connection.id,
      kind: "agent_ingest",
      windowStart: body.window.start,
      windowEnd: body.window.end,
    });
    await txScoped.connectorRuns.finish(run.id, {
      subjectsSeen: subjectRows.length,
      recordsUpserted: body.records.length,
      signalsUpserted: body.signals.length,
      gaps: body.gaps,
    });

    return {
      subjects: subjectRows.length,
      records: body.records.length,
      signals: body.signals.length,
    };
  });

  // Fix 2 (plan PR2): the "click Sync → watch your score" payoff. Chain the
  // same score-recompute message connector polls send (poller/run.ts) —
  // AFTER the transaction committed, never inside it (a rolled-back write
  // must not trigger recompute), and best-effort (the ingest already
  // succeeded; a lost message self-heals at the nightly cron). Guarded on
  // the submitted batch being non-empty so a zero-row batch replayed on a
  // leaked token can't be amplified into full-org recomputes (plan §7.4);
  // note an idempotent replay of a NON-empty batch still enqueues — the
  // recompute itself is idempotent on the frozen score_results upsert key,
  // so the cost is bounded, not incorrect.
  if (deps.send && counts.records + counts.signals > 0) {
    try {
      await deps.send({
        kind: "score-recompute",
        orgId,
        day: previousDay(new Date().toISOString().slice(0, 10)),
      });
    } catch (error) {
      console.warn(
        `score-recompute enqueue after agent ingest failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { ok: true, status: 200, body: { ok: true, ...counts } };
}
