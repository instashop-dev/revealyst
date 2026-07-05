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
// Retry policy: a RetryableConnectorError (429 / 5xx / network) propagates
// to the queue consumer, which retries the MESSAGE with backoff — nothing
// here loops. Anything else is permanent: recorded on the run + the
// connection, and the message is acked (no poison-message loop).

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

/**
 * One backfill CHUNK, then the next cursor is enqueued. Resumability is
 * structural: every write is an idempotent upsert and the next message is
 * sent only after this chunk fully landed, so a crash re-delivers THIS
 * message and re-covers the same days harmlessly.
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
  if (outcome !== "success") {
    return; // recorded; a permanent failure stops the chain audibly
  }
  const nextStart = addDays(chunk.end, 1);
  if (nextStart <= message.window.end) {
    await deps.send({ ...message, cursorStart: nextStart });
  }
}

type RunOutcome = "success" | "skipped" | "permanent-failure";

async function executeRun(
  db: Db,
  message: ConnectorPollMessage | ConnectorBackfillMessage,
  kind: "poll" | "backfill",
  window: DateWindow,
  deps: PollDeps,
): Promise<RunOutcome> {
  const scoped = forOrg(db, message.orgId);
  const connection = await scoped.connections.get(message.connectionId);
  if (!connection || connection.status === "paused") {
    return "skipped"; // deleted or paused since dispatch — not an error
  }
  const entry = (deps.resolveConnector ?? getConnector)(connection.vendor);
  if (!entry) {
    return "skipped"; // vendor module not shipped yet (e.g. W2-J vendors)
  }
  const now = deps.now ?? (() => new Date());
  const run = await scoped.connectorRuns.start({
    connectionId: connection.id,
    kind,
    windowStart: window.start,
    windowEnd: window.end,
    attempt: deps.attempt ?? 1,
  });

  try {
    // Vendor I/O only inside the credential scope; landing/normalizing/
    // upserting happens after, with the plaintext already dropped.
    const fetched = await scoped.connections.withCredential(
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
        records.push({
          ...metricRecordInputSchema.parse(r),
          rawPayloadId: rawRow.id,
        });
      }
      for (const s of batch.signals) {
        signals.push(subjectDaySignalInputSchema.parse(s));
      }
      gaps.push(...batch.gaps);
    }

    const missing = new Map<string, SubjectDescriptor>();
    for (const { subject } of [...records, ...signals]) {
      const key = `${subject.kind}:${subject.externalId}`;
      if (!byKey.has(key) && !missing.has(key)) {
        missing.set(key, subject);
      }
    }
    if (missing.size > 0) {
      for (const row of await scoped.subjects.upsertMany(connection.id, [
        ...missing.values(),
      ])) {
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

    await scoped.connectorRuns.finish(run.id, {
      subjectsSeen: byKey.size,
      recordsUpserted: records.length,
      signalsUpserted: signals.length,
      gaps: dedupeGaps(gaps),
    });
    await scoped.connections.markPolled(connection.id, { ok: true });
    return "success";
  } catch (error) {
    await scoped.connectorRuns.fail(run.id, errorMessage(error));
    if (error instanceof RetryableConnectorError) {
      throw error; // consumer retries the message with backoff
    }
    await scoped.connections.markPolled(connection.id, {
      ok: false,
      error: errorMessage(error),
    });
    return "permanent-failure";
  }
}

function subjectKey(s: { kind: string; externalId: string }): string {
  return `${s.kind}:${s.externalId}`;
}
