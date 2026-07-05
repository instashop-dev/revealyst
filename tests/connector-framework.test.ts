import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { RegisteredConnector } from "../src/connectors/registry";
import type {
  Connector,
  DateWindow,
  RawPayloadEnvelope,
} from "../src/contracts/connector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  addDays,
  chunkDaysFor,
  chunkForCursor,
  daysBetweenInclusive,
  DEFAULT_BACKFILL_DAYS,
  EXPECTED_CALL_LATENCY_MS,
  MAX_CALLS_PER_MESSAGE,
  planBackfillChunks,
  WALL_TIME_BUDGET_MS,
} from "../src/poller/backfill";
import { dispatchDueConnectorWork } from "../src/poller/dispatch";
import type { PollMessage } from "../src/poller/messages";
import { processPollMessage } from "../src/poller/process";
import {
  credentialKindFor,
  retryDelaySeconds,
  RetryableConnectorError,
  type PollDeps,
} from "../src/poller/run";

// W1-D framework suite: the poll pipeline (credential scope → poll → raw
// landing → pure normalize → org-scoped upserts → connector_runs log), the
// chunked-resumable backfill chain, dispatch policy, and the CI-enforced
// wall-time budget (workflow doc: "max seconds per queue message").

function testKek(): string {
  const bytes = new Uint8Array(32).fill(9);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };
const NOW = () => new Date("2026-06-13T10:00:00Z");

type FakePayload = { days: string[] };

/**
 * Deterministic fake vendor: poll() emits one envelope covering the asked
 * window; normalize() emits one active_day record per day for one person
 * subject, plus a signal on the first day. `behavior` knobs simulate vendor
 * failures and latency; `calls` counts vendor API calls (1 per poll +
 * 1 per discover) for the budget assertions.
 */
function makeFake(behavior?: {
  pollError?: () => Error;
  callLatencyMs?: number;
  callsPerPoll?: number;
}) {
  const calls = { discover: 0, poll: 0 };
  const connector: Connector = {
    vendor: "cursor",
    capabilities: {
      subDaily: "1h",
      attributionCeiling: "person",
      restatementWindowDays: 2,
      maxBackfillDays: 90,
    },
    async validateAuth() {
      return { ok: true };
    },
    async discover() {
      calls.discover++;
      return [
        {
          kind: "person",
          externalId: "u1",
          email: "u1@fixture.example",
          displayName: "U One",
        },
      ];
    },
    async poll(ctx, window) {
      const perPoll = behavior?.callsPerPoll ?? 1;
      for (let i = 0; i < perPoll; i++) {
        calls.poll++;
        if (behavior?.callLatencyMs) {
          await new Promise((r) => setTimeout(r, behavior.callLatencyMs));
        }
      }
      if (behavior?.pollError) {
        throw behavior.pollError();
      }
      const days: string[] = [];
      for (let d = window.start; d <= window.end; d = addDays(d, 1)) {
        days.push(d);
      }
      return [
        { kind: "fake.daily", window, payload: { days } satisfies FakePayload },
      ];
    },
    normalize(raw: RawPayloadEnvelope) {
      const payload = raw.payload as FakePayload;
      return {
        records: payload.days.map((day) => ({
          subject: { kind: "person" as const, externalId: "u1" },
          metricKey: "active_day" as const,
          day,
          dim: "",
          value: 1,
          attribution: "person" as const,
        })),
        signals: [
          {
            subject: { kind: "person" as const, externalId: "u1" },
            day: payload.days[0],
            hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 3 : 0)),
            peakConcurrency: 1,
            sourceGranularity: "1h" as const,
          },
        ],
        gaps: [{ kind: "other" as const, detail: "fake gap" }],
      };
    },
  };
  const entry: RegisteredConnector = {
    connector,
    sourceConnector: "fake@1",
    maxCallsPerDay: 1,
    pollIntervalMinutes: 60,
  };
  return { entry, calls };
}

function makeDeps(
  entry: RegisteredConnector,
  sent: PollMessage[],
): PollDeps {
  return {
    credentialEnv: ENV,
    send: async (m) => {
      sent.push(m);
    },
    now: NOW,
    resolveConnector: () => entry,
  };
}

let db: Db;
let orgId: string;

async function newConnection(vendor = "cursor") {
  const scoped = forOrg(db, orgId);
  const conn = await scoped.connections.create({
    vendor,
    displayName: `${vendor} test`,
    authKind: "api_key",
  });
  await scoped.connections.storeCredential(conn.id, "api_key", "sk-test", ENV);
  return conn;
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "connector-fw-org", "team")).id;
});

describe("connector-poll pipeline", () => {
  it("lands raw, normalizes, upserts subjects/records/signals, logs the run", async () => {
    const conn = await newConnection();
    const { entry } = makeFake();
    const window: DateWindow = { start: "2026-06-11", end: "2026-06-13" };
    await processPollMessage(
      db,
      { kind: "connector-poll", orgId, connectionId: conn.id, window },
      makeDeps(entry, []),
    );

    const scoped = forOrg(db, orgId);
    const subjects = await scoped.subjects.list({ connectionId: conn.id });
    expect(subjects).toHaveLength(1);
    expect(subjects[0].email).toBe("u1@fixture.example");

    const records = await scoped.metrics.records({
      metricKey: "active_day",
      from: window.start,
      to: window.end,
    });
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.sourceConnector === "fake@1")).toBe(true);
    expect(records.every((r) => r.rawPayloadId !== null)).toBe(true);
    expect(records.every((r) => r.attribution === "person")).toBe(true);

    const signals = await scoped.metrics.signals({
      subjectId: subjects[0].id,
      from: window.start,
      to: window.end,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].hours?.[9]).toBe(3);

    const run = await scoped.connectorRuns.latest(conn.id);
    expect(run?.status).toBe("success");
    expect(run?.kind).toBe("poll");
    expect(run?.recordsUpserted).toBe(3);
    expect(run?.signalsUpserted).toBe(1);
    expect(run?.gaps).toEqual([{ kind: "other", detail: "fake gap" }]);

    const after = await scoped.connections.get(conn.id);
    expect(after?.status).toBe("active");
    expect(after?.lastSuccessAt).not.toBeNull();
    expect(after?.lastError).toBeNull();
  });

  it("re-polls idempotently: restated windows overwrite, never duplicate", async () => {
    const conn = await newConnection();
    const { entry } = makeFake();
    const window: DateWindow = { start: "2026-06-11", end: "2026-06-13" };
    const msg = {
      kind: "connector-poll",
      orgId,
      connectionId: conn.id,
      window,
    } as const;
    await processPollMessage(db, msg, makeDeps(entry, []));
    await processPollMessage(db, msg, makeDeps(entry, []));

    const rows = await db
      .select()
      .from(schema.metricRecords)
      .where(
        and(
          eq(schema.metricRecords.orgId, orgId),
          eq(schema.metricRecords.connectionId, conn.id),
        ),
      );
    expect(rows).toHaveLength(3); // upsert key absorbed the second pass
    const runs = await forOrg(db, orgId).connectorRuns.list({
      connectionId: conn.id,
    });
    expect(runs).toHaveLength(2); // but every attempt is logged
  });

  it("a retryable vendor error propagates for queue retry and logs the attempt", async () => {
    const conn = await newConnection();
    const { entry } = makeFake({
      pollError: () => new RetryableConnectorError("429 from vendor", 120),
    });
    const window: DateWindow = { start: "2026-06-13", end: "2026-06-13" };
    await expect(
      processPollMessage(
        db,
        { kind: "connector-poll", orgId, connectionId: conn.id, window },
        { ...makeDeps(entry, []), attempt: 2 },
      ),
    ).rejects.toThrow(/429/);

    const scoped = forOrg(db, orgId);
    const run = await scoped.connectorRuns.latest(conn.id);
    expect(run?.status).toBe("error");
    expect(run?.attempt).toBe(2);
    // Transient failure must NOT flip the connection to error — the queue
    // retries silently and the UI keeps showing the last good sync.
    const after = await scoped.connections.get(conn.id);
    expect(after?.status).toBe("pending");
    expect(after?.lastError).toBeNull();
  });

  it("a permanent vendor error is recorded and does not throw (no poison loop)", async () => {
    const conn = await newConnection();
    const { entry } = makeFake({
      pollError: () => new Error("401 invalid x-api-key"),
    });
    const window: DateWindow = { start: "2026-06-13", end: "2026-06-13" };
    await processPollMessage(
      db,
      { kind: "connector-poll", orgId, connectionId: conn.id, window },
      makeDeps(entry, []),
    );
    const scoped = forOrg(db, orgId);
    const run = await scoped.connectorRuns.latest(conn.id);
    expect(run?.status).toBe("error");
    expect(run?.error).toMatch(/401/);
    const after = await scoped.connections.get(conn.id);
    expect(after?.status).toBe("error");
    expect(after?.lastError).toMatch(/401/);
  });

  it("skips silently when the vendor has no registered module", async () => {
    const conn = await newConnection("github_copilot");
    await processPollMessage(
      db,
      {
        kind: "connector-poll",
        orgId,
        connectionId: conn.id,
        window: { start: "2026-06-13", end: "2026-06-13" },
      },
      {
        credentialEnv: ENV,
        send: async () => {},
        now: NOW,
        resolveConnector: () => undefined,
      },
    );
    const run = await forOrg(db, orgId).connectorRuns.latest(conn.id);
    expect(run).toBeUndefined();
  });
});

describe("chunked resumable backfill", () => {
  it("walks the cursor chain to cover the whole window, one chunk per message", async () => {
    const conn = await newConnection();
    const { entry } = makeFake();
    const window: DateWindow = { start: "2026-03-16", end: "2026-06-13" }; // 90 days
    const chunkDays = chunkDaysFor(entry.maxCallsPerDay);

    const sent: PollMessage[] = [];
    const deps = makeDeps(entry, sent);
    await processPollMessage(
      db,
      {
        kind: "connector-backfill",
        orgId,
        connectionId: conn.id,
        window,
        cursorStart: window.start,
        chunkDays,
      },
      deps,
    );
    // Drain the chain the way the queue consumer would.
    while (sent.length > 0) {
      const next = sent.shift()!;
      await processPollMessage(db, next, deps);
    }

    const scoped = forOrg(db, orgId);
    const runs = await scoped.connectorRuns.list({ connectionId: conn.id });
    const expectedChunks = planBackfillChunks(window, chunkDays);
    expect(runs.filter((r) => r.kind === "backfill")).toHaveLength(
      expectedChunks.length,
    );
    expect(runs.every((r) => r.status === "success")).toBe(true);

    const records = await scoped.metrics.records({
      metricKey: "active_day",
      from: window.start,
      to: window.end,
    });
    const connRecords = records.filter((r) => r.connectionId === conn.id);
    expect(connRecords).toHaveLength(daysBetweenInclusive(window.start, window.end));
  });

  it("re-delivering a mid-chain message is idempotent (resume-safe)", async () => {
    const conn = await newConnection();
    const { entry } = makeFake();
    const window: DateWindow = { start: "2026-06-01", end: "2026-06-13" };
    const msg = {
      kind: "connector-backfill",
      orgId,
      connectionId: conn.id,
      window,
      cursorStart: "2026-06-05",
      chunkDays: 5,
    } as const;
    const sent: PollMessage[] = [];
    const deps = makeDeps(entry, sent);
    await processPollMessage(db, msg, deps);
    await processPollMessage(db, msg, deps); // simulated re-delivery

    const chunk = chunkForCursor(window, "2026-06-05", 5);
    const records = await forOrg(db, orgId).metrics.records({
      metricKey: "active_day",
      from: chunk.start,
      to: chunk.end,
    });
    expect(records.filter((r) => r.connectionId === conn.id)).toHaveLength(
      daysBetweenInclusive(chunk.start, chunk.end),
    );
    // Both deliveries enqueue the same next cursor — the chain converges.
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
  });

  it("a permanent failure stops the chain audibly instead of enqueueing on", async () => {
    const conn = await newConnection();
    const { entry } = makeFake({ pollError: () => new Error("boom") });
    const sent: PollMessage[] = [];
    await processPollMessage(
      db,
      {
        kind: "connector-backfill",
        orgId,
        connectionId: conn.id,
        window: { start: "2026-06-01", end: "2026-06-13" },
        cursorStart: "2026-06-01",
        chunkDays: 5,
      },
      makeDeps(entry, sent),
    );
    expect(sent).toHaveLength(0);
    const run = await forOrg(db, orgId).connectorRuns.latest(conn.id);
    expect(run?.status).toBe("error");
  });
});

describe("cron dispatch", () => {
  it("new connection with credential → backfill chain-start + first poll", async () => {
    const conn = await newConnection();
    const { entry } = makeFake();
    const sent: PollMessage[] = [];
    await dispatchDueConnectorWork(db, {
      send: async (m) => {
        sent.push(m);
      },
      now: NOW,
      resolveConnector: (v) => (v === "cursor" ? entry : undefined),
    });

    const mine = sent.filter(
      (m) =>
        (m.kind === "connector-poll" || m.kind === "connector-backfill") &&
        m.connectionId === conn.id,
    );
    const backfill = mine.find((m) => m.kind === "connector-backfill");
    const poll = mine.find((m) => m.kind === "connector-poll");
    expect(backfill).toBeDefined();
    expect(poll).toBeDefined();
    if (backfill?.kind === "connector-backfill") {
      expect(
        daysBetweenInclusive(backfill.window.start, backfill.window.end),
      ).toBe(DEFAULT_BACKFILL_DAYS);
      expect(backfill.cursorStart).toBe(backfill.window.start);
      expect(backfill.chunkDays).toBe(chunkDaysFor(entry.maxCallsPerDay));
    }
    if (poll?.kind === "connector-poll") {
      // Regular poll re-covers the vendor restatement window.
      expect(daysBetweenInclusive(poll.window.start, poll.window.end)).toBe(
        entry.connector.capabilities.restatementWindowDays + 1,
      );
    }
  });

  it("recently-polled + backfill-started connection gets nothing", async () => {
    const conn = await newConnection();
    const scoped = forOrg(db, orgId);
    await scoped.connections.markPolled(conn.id, { ok: true });
    await scoped.connectorRuns.start({ connectionId: conn.id, kind: "backfill" });
    const { entry } = makeFake();
    const sent: PollMessage[] = [];
    await dispatchDueConnectorWork(db, {
      send: async (m) => {
        sent.push(m);
      },
      // markPolled stamped real now; a minute later nothing is due.
      now: () => new Date(Date.now() + 60_000),
      resolveConnector: (v) => (v === "cursor" ? entry : undefined),
    });
    expect(
      sent.filter(
        (m) =>
          (m.kind === "connector-poll" || m.kind === "connector-backfill") &&
          m.connectionId === conn.id,
      ),
    ).toHaveLength(0);
  });

  it("a connection without a stored credential is never dispatched", async () => {
    const scoped = forOrg(db, orgId);
    const conn = await scoped.connections.create({
      vendor: "cursor",
      displayName: "no-cred",
      authKind: "api_key",
    });
    const { entry } = makeFake();
    const sent: PollMessage[] = [];
    await dispatchDueConnectorWork(db, {
      send: async (m) => {
        sent.push(m);
      },
      now: NOW,
      resolveConnector: () => entry,
    });
    expect(
      sent.filter(
        (m) =>
          (m.kind === "connector-poll" || m.kind === "connector-backfill") &&
          m.connectionId === conn.id,
      ),
    ).toHaveLength(0);
  });
});

describe("wall-time budget (CI-enforced Queue limit)", () => {
  it("chunk sizing keeps every vendor's worst-case calls under the ceiling", () => {
    for (let callsPerDay = 1; callsPerDay <= 24; callsPerDay++) {
      const days = chunkDaysFor(callsPerDay);
      if (callsPerDay <= MAX_CALLS_PER_MESSAGE) {
        expect(days * callsPerDay).toBeLessThanOrEqual(MAX_CALLS_PER_MESSAGE);
      } else {
        expect(days).toBe(1); // heavy vendors degrade to one day/message
      }
    }
  });

  it("the modeled worst-case message fits the budget with headroom", () => {
    // The contract the framework must keep: MAX calls × p95 latency + fixed
    // overhead ≤ budget. If someone raises MAX_CALLS_PER_MESSAGE or a
    // vendor's latency model past what a queue message can absorb, THIS
    // fails — the limit is enforced by CI, not by memory (workflow §3).
    const OVERHEAD_MS = 10_000; // discover + normalize + upserts + DB
    expect(
      MAX_CALLS_PER_MESSAGE * EXPECTED_CALL_LATENCY_MS + OVERHEAD_MS,
    ).toBeLessThanOrEqual(WALL_TIME_BUDGET_MS);
  });

  it("planBackfillChunks covers 90 days exactly, no gaps, no overlaps", () => {
    const window: DateWindow = { start: "2026-03-16", end: "2026-06-13" };
    const chunks = planBackfillChunks(window, 7);
    expect(chunks[0].start).toBe(window.start);
    expect(chunks[chunks.length - 1].end).toBe(window.end);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBe(addDays(chunks[i - 1].end, 1));
    }
    const covered = chunks.reduce(
      (sum, c) => sum + daysBetweenInclusive(c.start, c.end),
      0,
    );
    expect(covered).toBe(daysBetweenInclusive(window.start, window.end));
  });

  it("a worst-case chunk executes inside the budget (measured)", async () => {
    const conn = await newConnection();
    // Model MAX calls at 20ms each: proportionally 1% of the real budget —
    // asserted at 10% to stay robust on slow CI runners while still
    // catching an accidental serial-fanout regression.
    const { entry, calls } = makeFake({
      callsPerPoll: MAX_CALLS_PER_MESSAGE,
      callLatencyMs: 20,
    });
    const started = performance.now();
    await processPollMessage(
      db,
      {
        kind: "connector-backfill",
        orgId,
        connectionId: conn.id,
        window: { start: "2026-05-29", end: "2026-06-13" },
        cursorStart: "2026-05-29",
        chunkDays: 16,
      },
      makeDeps(entry, []),
    );
    const elapsed = performance.now() - started;
    expect(calls.poll).toBe(MAX_CALLS_PER_MESSAGE);
    expect(elapsed).toBeLessThan(WALL_TIME_BUDGET_MS / 10);
  });
});

describe("plumbing", () => {
  it("maps auth kinds to credential row kinds", () => {
    expect(credentialKindFor("api_key")).toBe("api_key");
    expect(credentialKindFor("admin_key")).toBe("api_key");
    expect(credentialKindFor("analytics_key")).toBe("api_key");
    expect(credentialKindFor("github_app")).toBe("github_app_private_key");
    expect(credentialKindFor("pat")).toBe("pat");
    expect(credentialKindFor("device_token")).toBe("device_token");
    expect(() => credentialKindFor("nope")).toThrow(/unknown auth kind/);
  });

  it("backs off exponentially and caps at an hour", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(20)).toBe(3600);
  });
});
