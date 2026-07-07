import { getConnector } from "../connectors/registry";
import type { VendorId } from "../contracts/attribution";
import type {
  ConnectorContext,
  DateWindow,
  HonestyGap,
} from "../contracts/connector";
import {
  metricRecordInputSchema,
  subjectDaySignalInputSchema,
  type MetricRecordInput,
  type SubjectDaySignalInput,
} from "../contracts/metrics";
import type { Db } from "../db/client";
import { forOrg, type SubjectDescriptor } from "../db/org-scope";
import type { CredentialEnv } from "../lib/credentials";
import { addDays, chunkForCursor } from "./backfill";
import type {
  ConnectorBackfillMessage,
  ConnectorPollMessage,
  PollMessage,
} from "./messages";

// One connector run = one queue message: credential-scoped vendor I/O,
// raw landing, PURE normalize, org-scoped upserts, connector_runs logging.
// Retry policy (ADR 0005/0006), by phase:
//  - vendor phase: a RetryableConnectorError (429 / 5xx / network)
//    propagates to the queue consumer, which retries the MESSAGE with
//    backoff — nothing here loops. Any other vendor-phase error (401, bad
//    key, plan gate) is permanent: recorded on the run + the connection.
//  - post-vendor phase (raw landing, normalize, upserts): errors rethrow
//    for queue retry — the common cause is a transient DB failure, and a
//    deterministic normalize bug still surfaces as repeated failed run
//    rows + a stale last_success_at rather than bricking the connection.
// Either way the dispatcher keeps polling errored connections (self-heal).

/** Vendor said "not now" — the consumer retries the message with delay. */
export class RetryableConnectorError extends Error {
  readonly delaySeconds: number;
  constructor(message: string, delaySeconds: number) {
    super(message);
    this.name = "RetryableConnectorError";
    this.delaySeconds = delaySeconds;
  }
}

/** Exponential backoff for queue re-delivery: 30s, 60s, 120s, … ≤ 1h. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600);
}

export type PollDeps = {
  credentialEnv: CredentialEnv;
  /** Enqueue a follow-up message (the backfill cursor chain). */
  send: (message: PollMessage, opts?: { delaySeconds?: number }) => Promise<void>;
  /** Queue delivery attempt (message.attempts) — logged on the run row. */
  attempt?: number;
  now?: () => Date;
  /** Test seam: overrides the vendor registry. */
  resolveConnector?: typeof getConnector;
};

/** connections.auth_kind → the credential row kind that stores its secret.
 * Admin/analytics keys are api_key-shaped secrets; the distinction lives on
 * the connection, not the ciphertext row. */
export function credentialKindFor(
  authKind: string,
): "api_key" | "github_app_private_key" | "pat" | "device_token" {
  switch (authKind) {
    case "api_key":
    case "admin_key":
    case "analytics_key":
      return "api_key";
    case "github_app":
      return "github_app_private_key";
    case "pat":
      return "pat";
    case "device_token":
      return "device_token";
    default:
      throw new Error(`unknown auth kind: ${authKind}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dedupeGaps(gaps: HonestyGap[]): HonestyGap[] {
  const seen = new Map<string, HonestyGap>();
  for (const gap of gaps) {
    seen.set(`${gap.kind}:${gap.detail ?? ""}`, gap);
  }
  return [...seen.values()];
}

export async function runConnectorPoll(
  db: Db,
  message: ConnectorPollMessage,
  deps: PollDeps,
): Promise<void> {
  await executeRun(db, message, "poll", message.window, deps);
}

/** Delay before a paused connection's backfill chunk re-checks (ADR 0006). */
export const PAUSED_BACKFILL_RETRY_SECONDS = 3600;

/**
 * One backfill CHUNK, then the next cursor is enqueued. Resumability is
 * structural: every write is an idempotent upsert and the next message is
 * sent only after this chunk fully landed, so a crash re-delivers THIS
 * message and re-covers the same days harmlessly.
 *
 * Chain survival (ADR 0006): a permanently-failed chunk is a RECORDED HOLE,
 * not a chain-killer — the rest of the window still backfills. A paused
 * connection re-enqueues the same cursor with a delay, so unpausing resumes
 * the chain instead of silently truncating history. Only a deleted
 * connection (or a vendor with no module) drops the chain.
 */
export async function runConnectorBackfill(
  db: Db,
  message: ConnectorBackfillMessage,
  deps: PollDeps,
): Promise<void> {
  const chunk = chunkForCursor(
    message.window,
    message.cursorStart,
    message.chunkDays,
  );
  const outcome = await executeRun(db, message, "backfill", chunk, deps);
  if (outcome === "skipped-paused") {
    await deps.send(message, { delaySeconds: PAUSED_BACKFILL_RETRY_SECONDS });
    return;
  }
  if (outcome === "skipped-gone") {
    return; // connection deleted / vendor module gone — chain ends
  }
  const nextStart = addDays(chunk.end, 1);
  if (nextStart > message.window.end) {
    return; // chain complete
  }
  // Fork guard: an at-least-once redelivery of THIS message after the next
  // cursor was already sent would fork a duplicate parallel chain. If any
  // backfill run for the next chunk already exists, another delivery got
  // there first — don't send again. (Duplicates that race before the next
  // chunk STARTS still collapse here one hop later.)
  const runs = await forOrg(db, message.orgId).connectorRuns.list({
    connectionId: message.connectionId,
    limit: 50,
  });
  const nextAlreadyStarted = runs.some(
    (r) => r.kind === "backfill" && r.windowStart === nextStart,
  );
  if (!nextAlreadyStarted) {
    await deps.send({ ...message, cursorStart: nextStart });
  }
}

type RunOutcome =
  | "success"
  | "skipped-gone"
  | "skipped-paused"
  | "permanent-failure";

async function executeRun(
  db: Db,
  message: ConnectorPollMessage | ConnectorBackfillMessage,
  kind: "poll" | "backfill",
  window: DateWindow,
  deps: PollDeps,
): Promise<RunOutcome> {
  const scoped = forOrg(db, message.orgId);
  const connection = await scoped.connections.get(message.connectionId);
  if (!connection) {
    return "skipped-gone"; // deleted since dispatch — not an error
  }
  if (connection.status === "paused") {
    return "skipped-paused"; // pause sticks; backfill chains wait, polls drop
  }
  const entry = (deps.resolveConnector ?? getConnector)(connection.vendor);
  if (!entry) {
    return "skipped-gone"; // vendor module not shipped yet (e.g. W2-J vendors)
  }
  const now = deps.now ?? (() => new Date());
  const run = await scoped.connectorRuns.start({
    connectionId: connection.id,
    kind,
    windowStart: window.start,
    windowEnd: window.end,
    attempt: deps.attempt ?? 1,
  });

  // ---- Vendor phase: only here can a failure be a credential/plan
  // problem (permanent) vs a vendor hiccup (retryable). ----
  let fetched: {
    discovered: SubjectDescriptor[];
    envelopes: Awaited<ReturnType<typeof entry.connector.poll>>;
  };
  try {
    // Vendor I/O only inside the credential scope; landing/normalizing/
    // upserting happens after, with the plaintext already dropped.
    fetched = await scoped.connections.withCredential(
      connection.id,
      credentialKindFor(connection.authKind),
      deps.credentialEnv,
      async (credential) => {
        const ctx: ConnectorContext = {
          connection: {
            id: connection.id,
            orgId: message.orgId,
            vendor: connection.vendor as VendorId,
            config: connection.config as Record<string, unknown>,
          },
          credential,
          now,
          log: (m) =>
            console.log(`[${connection.vendor}:${connection.id}] ${m}`),
        };
        // discover() runs on regular polls only — backfill chunks reuse
        // known subjects (+ minimal upserts below) to keep their vendor
        // call count inside the per-message budget.
        const discovered =
          kind === "poll" ? await entry.connector.discover(ctx) : [];
        const envelopes = await entry.connector.poll(ctx, window);
        return { discovered, envelopes };
      },
    );
  } catch (error) {
    await scoped.connectorRuns.fail(run.id, errorMessage(error));
    if (error instanceof RetryableConnectorError) {
      // Stamp last_polled_at (only) so the 5-min dispatcher stops piling
      // duplicate polls onto a vendor that is already rate-limiting us —
      // the queue retries THIS message with backoff.
      await scoped.connections.markPolled(connection.id, {
        ok: false,
        error: errorMessage(error),
        transient: true,
      });
      throw error;
    }
    await scoped.connections.markPolled(connection.id, {
      ok: false,
      error: errorMessage(error),
    });
    return "permanent-failure";
  }

  try {
    // Subject resolution: existing rows first (a minimal re-upsert must
    // never clobber emails discover() already captured), then discover's
    // fresh descriptors, then minimal descriptors for anything normalize
    // references that neither knew about.
    const known = await scoped.subjects.list({ connectionId: connection.id });
    const byKey = new Map(known.map((s) => [subjectKey(s), s.id]));
    if (fetched.discovered.length > 0) {
      for (const row of await scoped.subjects.upsertMany(
        connection.id,
        fetched.discovered,
      )) {
        byKey.set(subjectKey(row), row.id);
      }
    }

    const records: Array<MetricRecordInput & { rawPayloadId: string }> = [];
    const signals: SubjectDaySignalInput[] = [];
    const gaps: HonestyGap[] = [];
    // Descriptors as the connector emitted them (zod strips extras like
    // email off the parsed copies, but a subject born from normalize —
    // e.g. an email-keyed claude_code actor — must keep them for W2-K).
    const referenced = new Map<string, SubjectDescriptor>();
    const remember = (subject: unknown) => {
      const d = subject as SubjectDescriptor;
      const key = `${d.kind}:${d.externalId}`;
      const existing = referenced.get(key);
      if (!existing || (!existing.email && d.email)) {
        referenced.set(key, d);
      }
    };
    for (const envelope of fetched.envelopes) {
      const rawRow = await scoped.raw.insert({
        connectionId: connection.id,
        vendor: connection.vendor,
        kind: envelope.kind,
        windowStart: envelope.window
          ? new Date(`${envelope.window.start}T00:00:00Z`)
          : null,
        windowEnd: envelope.window
          ? new Date(`${addDays(envelope.window.end, 1)}T00:00:00Z`)
          : null,
        payload: envelope.payload,
      });
      // normalize() is PURE — a throw here is a connector bug or a vendor
      // shape change: permanent, with the raw payload landed for replay.
      const batch = entry.connector.normalize({
        ...envelope,
        rawPayloadId: rawRow.id,
      });
      for (const r of batch.records) {
        remember(r.subject);
        records.push({
          ...metricRecordInputSchema.parse(r),
          rawPayloadId: rawRow.id,
        });
      }
      for (const s of batch.signals) {
        remember(s.subject);
        signals.push(subjectDaySignalInputSchema.parse(s));
      }
      gaps.push(...batch.gaps);
    }

    const missing = [...referenced].filter(([key]) => !byKey.has(key));
    if (missing.length > 0) {
      for (const row of await scoped.subjects.upsertMany(
        connection.id,
        missing.map(([, d]) => d),
      )) {
        byKey.set(subjectKey(row), row.id);
      }
    }
    const subjectId = (s: { kind: string; externalId: string }): string => {
      const id = byKey.get(`${s.kind}:${s.externalId}`);
      if (!id) {
        throw new Error(`subject ${s.kind}:${s.externalId} failed to upsert`);
      }
      return id;
    };

    // Delete-then-upsert: a vendor restatement can drop a dim (or a whole
    // day) between polls of the same trailing window, and upsertRecords only
    // touches keys present in THIS batch — a stale natural key from a prior
    // poll would otherwise survive forever and permanently inflate any
    // distinct_dims-based score. Scoped to exactly this run's window, so a
    // backfill chunk's delete never touches days outside its own chunk.
    await scoped.metrics.deleteWindowForConnection(
      connection.id,
      window.start,
      window.end,
    );
    await scoped.metrics.upsertRecords(
      records.map((r) => ({
        subjectId: subjectId(r.subject),
        metricKey: r.metricKey,
        day: r.day,
        dim: r.dim,
        connectionId: connection.id,
        value: r.value,
        attribution: r.attribution,
        sourceConnector: entry.sourceConnector,
        rawPayloadId: r.rawPayloadId,
      })),
    );
    await scoped.metrics.upsertSignals(
      signals.map((s) => ({
        subjectId: subjectId(s.subject),
        day: s.day,
        hours: s.hours,
        peakConcurrency: s.peakConcurrency,
        sourceGranularity: s.sourceGranularity,
      })),
    );

    // Subjects THIS run actually touched (discovered or referenced by
    // normalize) — not the connection's ever-growing lifetime set.
    const seenThisRun = new Set<string>([
      ...fetched.discovered.map((d) => subjectKey(d)),
      ...referenced.keys(),
    ]);
    await scoped.connectorRuns.finish(run.id, {
      subjectsSeen: seenThisRun.size,
      recordsUpserted: records.length,
      signalsUpserted: signals.length,
      gaps: dedupeGaps(gaps),
    });
    await scoped.connections.markPolled(connection.id, { ok: true });
    return "success";
  } catch (error) {
    // Post-vendor phase: raw landing / normalize / upserts. The typical
    // cause is a transient DB failure — retry the message rather than
    // bricking the connection; a deterministic normalize bug shows up as
    // repeated failed runs + stale last_success_at (ADR 0006).
    await scoped.connectorRuns
      .fail(run.id, errorMessage(error))
      .catch(() => {}); // if the DB is down, the rethrow is the signal
    throw error;
  }
}

function subjectKey(s: { kind: string; externalId: string }): string {
  return `${s.kind}:${s.externalId}`;
}
