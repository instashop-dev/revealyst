import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentIngestRequest } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { PollMessage } from "../src/poller/messages";
import { previousDay } from "../src/scoring";
import { ingestAgentBatch } from "../src/lib/agent-ingest";
import {
  composeAgentToken,
  generateAgentSecret,
  parseAgentToken,
  timingSafeEqualStr,
} from "../src/lib/agent-token";
import type { CredentialEnv } from "../src/lib/credentials";

// ADR 0002: the Revealyst Agent ingest path. Auth and tenancy both derive
// from the device token; everything lands through forOrg, idempotently, on
// the frozen metric_records upsert key. Real migrations on PGlite (rule 2).

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

const DEV_SUBJECT = { kind: "person", externalId: "dev@example.com" } as const;

function makeBatch(
  overrides: Partial<AgentIngestRequest> = {},
): AgentIngestRequest {
  return {
    agentVersion: "0.1.0",
    summarizerVersion: 1,
    window: { start: "2026-07-01", end: "2026-07-02" },
    subjects: [
      {
        kind: "person",
        externalId: "dev@example.com",
        email: "dev@example.com",
        displayName: null,
      },
    ],
    records: [
      {
        subject: DEV_SUBJECT,
        metricKey: "sessions",
        day: "2026-07-01",
        dim: "",
        value: 3,
        attribution: "person",
      },
      {
        subject: DEV_SUBJECT,
        metricKey: "tokens_output",
        day: "2026-07-01",
        dim: "",
        value: 4200,
        attribution: "person",
      },
      {
        subject: DEV_SUBJECT,
        metricKey: "model_tokens",
        day: "2026-07-01",
        dim: "model=claude-fable-5",
        value: 4000,
        attribution: "person",
      },
    ],
    signals: [
      {
        subject: DEV_SUBJECT,
        day: "2026-07-01",
        hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)),
        peakConcurrency: 2,
        sourceGranularity: "event",
      },
    ],
    gaps: [],
    ...overrides,
  };
}

let db: Db;
let orgA: string;
let orgB: string;
let connA: string; // claude_code_local + device_token, secret stored
let connKeyed: string; // api_key connection — must never accept agent ingest
let connExpired: string; // device_token with an expired credential
let connPaused: string; // device_token, valid secret, operator-paused
let connProbe: string; // device_token used only for last_used_at probes
let secretA: string;
let tokenA: string;
let secretPaused: string;
let secretProbe: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db
    .insert(schema.orgs)
    .values({ name: "agent-org-a", kind: "personal" })
    .returning();
  const [b] = await db
    .insert(schema.orgs)
    .values({ name: "agent-org-b", kind: "team" })
    .returning();
  orgA = a.id;
  orgB = b.id;

  const scopedA = forOrg(db, orgA);
  connA = (
    await scopedA.connections.create({
      vendor: "claude_code_local",
      displayName: "Revealyst Agent",
      authKind: "device_token",
    })
  ).id;
  connKeyed = (
    await scopedA.connections.create({
      vendor: "anthropic_console",
      displayName: "Anthropic",
      authKind: "api_key",
    })
  ).id;
  connExpired = (
    await scopedA.connections.create({
      vendor: "claude_code_local",
      displayName: "Stale Agent",
      authKind: "device_token",
    })
  ).id;

  secretA = generateAgentSecret();
  await scopedA.connections.storeCredential(
    connA,
    "device_token",
    secretA,
    ENV,
  );
  tokenA = composeAgentToken(orgA, connA, secretA);

  await scopedA.connections.storeCredential(
    connExpired,
    "device_token",
    generateAgentSecret(),
    ENV,
    new Date(Date.now() - 1000),
  );
  await scopedA.connections.storeCredential(
    connKeyed,
    "api_key",
    "sk-ant-not-a-device-token",
    ENV,
  );

  connPaused = (
    await scopedA.connections.create({
      vendor: "claude_code_local",
      displayName: "Paused Agent",
      authKind: "device_token",
    })
  ).id;
  secretPaused = generateAgentSecret();
  await scopedA.connections.storeCredential(
    connPaused,
    "device_token",
    secretPaused,
    ENV,
  );
  await scopedA.connections.setStatus(connPaused, "paused");

  connProbe = (
    await scopedA.connections.create({
      vendor: "claude_code_local",
      displayName: "Probe Agent",
      authKind: "device_token",
    })
  ).id;
  secretProbe = generateAgentSecret();
  await scopedA.connections.storeCredential(
    connProbe,
    "device_token",
    secretProbe,
    ENV,
  );
});

describe("agent token format", () => {
  it("round-trips compose → parse", () => {
    const parsed = parseAgentToken(tokenA);
    expect(parsed).toEqual({ orgId: orgA, connectionId: connA, secret: secretA });
  });

  it("rejects malformed tokens structurally", () => {
    expect(parseAgentToken("")).toBeNull();
    expect(parseAgentToken("rva1.not-a-uuid.also-not.secret")).toBeNull();
    expect(parseAgentToken(`rva2.${orgA}.${connA}.${secretA}`)).toBeNull();
    expect(parseAgentToken(`rva1.${orgA}.${connA}`)).toBeNull();
    expect(parseAgentToken(`rva1.${orgA}.${connA}.short`)).toBeNull();
  });

  it("timingSafeEqualStr compares correctly", () => {
    expect(timingSafeEqualStr(secretA, secretA)).toBe(true);
    expect(timingSafeEqualStr(secretA, generateAgentSecret())).toBe(false);
    expect(timingSafeEqualStr(secretA, secretA.slice(1))).toBe(false);
  });
});

describe("agent ingest — happy path", () => {
  it("lands records, signals, raw payload, and sync stamps", async () => {
    const outcome = await ingestAgentBatch(db, ENV, tokenA, makeBatch());
    expect(outcome).toMatchObject({
      ok: true,
      status: 200,
      body: { ok: true, subjects: 1, records: 3, signals: 1 },
    });

    const scoped = forOrg(db, orgA);
    const sessions = await scoped.metrics.records({
      metricKey: "sessions",
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].value).toBe(3);
    expect(sessions[0].attribution).toBe("person");
    expect(sessions[0].sourceConnector).toBe("claude-code-local@1");
    expect(sessions[0].rawPayloadId).not.toBeNull();

    const modelTokens = await scoped.metrics.records({
      metricKey: "model_tokens",
      from: "2026-07-01",
      to: "2026-07-02",
      dim: "model=claude-fable-5",
    });
    expect(modelTokens).toHaveLength(1);

    const [subject] = await scoped.subjects.list({ connectionId: connA });
    expect(subject.kind).toBe("person");
    expect(subject.email).toBe("dev@example.com");
    const signals = await scoped.metrics.signals({
      subjectId: subject.id,
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].hours?.[9]).toBe(5);
    expect(signals[0].peakConcurrency).toBe(2);
    expect(signals[0].sourceGranularity).toBe("event");

    const conn = await scoped.connections.get(connA);
    expect(conn.status).toBe("active");
    expect(conn.lastSuccessAt).not.toBeNull();
    expect(conn.lastError).toBeNull();

    const raw = await scoped.raw.get(sessions[0].rawPayloadId!);
    expect(raw.kind).toBe("agent.ingest");
    expect(raw.vendor).toBe("claude_code_local");
  });

  it("re-pushing a window overwrites idempotently (no duplicate rows)", async () => {
    const batch = makeBatch();
    batch.records[0].value = 7; // restated day
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome.ok).toBe(true);

    const sessions = await forOrg(db, orgA).metrics.records({
      metricKey: "sessions",
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(sessions).toHaveLength(1); // same natural key → same row
    expect(sessions[0].value).toBe(7);
  });

  it("a re-push is authoritative for its window: stale keys are removed", async () => {
    // Push a batch containing a model dim that will "disappear" after a
    // summarizer fix — the adversarial-review finding: upsert-only ingest
    // would double-count model_mix forever.
    const withStale = makeBatch();
    withStale.records.push({
      subject: DEV_SUBJECT,
      metricKey: "model_tokens",
      day: "2026-07-01",
      dim: "model=claude-mislabeled-4",
      value: 999,
      attribution: "person",
    });
    expect((await ingestAgentBatch(db, ENV, tokenA, withStale)).ok).toBe(true);
    const scoped = forOrg(db, orgA);
    expect(
      await scoped.metrics.records({
        metricKey: "model_tokens",
        from: "2026-07-01",
        to: "2026-07-02",
        dim: "model=claude-mislabeled-4",
      }),
    ).toHaveLength(1);

    // Corrected re-push of the SAME window without that dim.
    expect((await ingestAgentBatch(db, ENV, tokenA, makeBatch())).ok).toBe(
      true,
    );
    expect(
      await scoped.metrics.records({
        metricKey: "model_tokens",
        from: "2026-07-01",
        to: "2026-07-02",
        dim: "model=claude-mislabeled-4",
      }),
    ).toHaveLength(0); // stale key gone
    expect(
      await scoped.metrics.records({
        metricKey: "model_tokens",
        from: "2026-07-01",
        to: "2026-07-02",
        dim: "model=claude-fable-5",
      }),
    ).toHaveLength(1); // restated key present
  });

  it("never lands anything visible to another org", async () => {
    const sessionsB = await forOrg(db, orgB).metrics.records({
      metricKey: "sessions",
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(sessionsB).toHaveLength(0);
    expect(await forOrg(db, orgB).subjects.list()).toHaveLength(0);
  });
});

describe("agent ingest — auth rejections (all 401, one message)", () => {
  const expect401 = (outcome: Awaited<ReturnType<typeof ingestAgentBatch>>) => {
    expect(outcome).toMatchObject({
      ok: false,
      status: 401,
      body: { error: "invalid device token" },
    });
  };

  it("rejects a garbage bearer token", async () => {
    expect401(await ingestAgentBatch(db, ENV, "not-a-token", makeBatch()));
    expect401(await ingestAgentBatch(db, ENV, "", makeBatch()));
  });

  it("rejects a well-formed token with the wrong secret", async () => {
    const forged = composeAgentToken(orgA, connA, generateAgentSecret());
    expect401(await ingestAgentBatch(db, ENV, forged, makeBatch()));
  });

  it("rejects a token aimed at a non-device-token connection", async () => {
    const wrongKind = composeAgentToken(orgA, connKeyed, secretA);
    expect401(await ingestAgentBatch(db, ENV, wrongKind, makeBatch()));
  });

  it("rejects a cross-org token (connection not in the token's org)", async () => {
    const crossOrg = composeAgentToken(orgB, connA, secretA);
    expect401(await ingestAgentBatch(db, ENV, crossOrg, makeBatch()));
  });

  it("rejects an expired device token", async () => {
    // Even with the CORRECT secret shape, the expired credential kills it —
    // but we don't know the stored secret here; a fresh one is equivalent
    // because expiry is checked before comparison in withCredential.
    const expired = composeAgentToken(orgA, connExpired, generateAgentSecret());
    expect401(await ingestAgentBatch(db, ENV, expired, makeBatch()));
  });
});

describe("agent ingest — body validation (400 before any write)", () => {
  it("rejects a record referencing an undeclared subject", async () => {
    const batch = makeBatch();
    batch.records.push({
      subject: { kind: "person", externalId: "ghost@example.com" },
      metricKey: "prompts",
      day: "2026-07-01",
      dim: "",
      value: 1,
      attribution: "person",
    });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) {
      expect(outcome.body.error).toMatch(/undeclared subject/);
    }
  });

  it("rejects unknown metric keys via the frozen schema", async () => {
    const batch = makeBatch() as unknown as Record<string, unknown>;
    (batch.records as Record<string, unknown>[])[0].metricKey =
      "prompt_content"; // not a canonical metric — and never will be
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a non-object body", async () => {
    const outcome = await ingestAgentBatch(db, ENV, tokenA, "hello");
    expect(outcome).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an over-long or control-char dim (content-smuggling backstop)", async () => {
    const longDim = makeBatch();
    longDim.records[0].dim = `model=${"x".repeat(200)}`;
    expect(await ingestAgentBatch(db, ENV, tokenA, longDim)).toMatchObject({
      ok: false,
      status: 400,
    });

    const contentDim = makeBatch();
    // A model field smuggling text would land here as a spaced dim.
    contentDim.records[0].dim = "model=rotate AWS key AKIA";
    const outcome = await ingestAgentBatch(db, ENV, tokenA, contentDim);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) {
      expect(outcome.body.error).toMatch(/whitespace\/control/);
    }
  });

  it("accepts a valid ai_tool_used flag with a closed-enum tool dim (ADR 0057)", async () => {
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "ai_tool_used",
          day: "2026-07-01",
          dim: "tool=claude-desktop",
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: true, status: 200 });
    const rows = await forOrg(db, orgA).metrics.records({
      metricKey: "ai_tool_used",
      from: "2026-07-01",
      to: "2026-07-02",
      dim: "tool=claude-desktop",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(1);
  });

  it("rejects an out-of-enum ai_tool_used dim (smuggled label, in-range length)", async () => {
    // The length/charset bound alone would pass this — it's short and clean —
    // so the closed-enum backstop must catch it (a smuggled snippet). Nothing
    // is written (400 before the transaction).
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "ai_tool_used",
          day: "2026-07-01",
          dim: "tool=some-secret-note",
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) {
      expect(outcome.body.error).toMatch(/ai_tool_used dim must be/);
    }
    expect(
      await forOrg(db, orgA).metrics.records({
        metricKey: "ai_tool_used",
        from: "2026-07-01",
        to: "2026-07-02",
        dim: "tool=some-secret-note",
      }),
    ).toHaveLength(0);
  });

  it("rejects an ai_tool_used dim missing the tool= prefix", async () => {
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "ai_tool_used",
          day: "2026-07-01",
          dim: "claude-desktop", // no `tool=` prefix
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    expect(await ingestAgentBatch(db, ENV, tokenA, batch)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("accepts a valid task_category count with a closed-enum dim (ADR 0059)", async () => {
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "task_category",
          day: "2026-07-01",
          dim: "task_category=drafting",
          value: 3,
          attribution: "person",
        },
        // The two dimensionless worktype counts ride alongside, empty dim.
        {
          subject: DEV_SUBJECT,
          metricKey: "iteration_depth",
          day: "2026-07-01",
          dim: "",
          value: 2,
          attribution: "person",
        },
        {
          subject: DEV_SUBJECT,
          metricKey: "verification_behavior",
          day: "2026-07-01",
          dim: "",
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: true, status: 200 });
    const rows = await forOrg(db, orgA).metrics.records({
      metricKey: "task_category",
      from: "2026-07-01",
      to: "2026-07-02",
      dim: "task_category=drafting",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(3);
  });

  it("accepts task_category=other (the mandatory catch-all)", async () => {
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "task_category",
          day: "2026-07-01",
          dim: "task_category=other",
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    expect(await ingestAgentBatch(db, ENV, tokenA, batch)).toMatchObject({
      ok: true,
      status: 200,
    });
  });

  it("rejects an out-of-enum task_category dim (smuggled prompt snippet, in-range length)", async () => {
    // Short, clean ASCII with NO whitespace/control chars — the generic
    // length/charset bound passes it — so the closed-enum backstop (ADR 0059)
    // must be what catches it. This is the exact smuggled-snippet vector the
    // classifier's closed Rust enum prevents on the device; here is the
    // server-side twin. Nothing is written (400 before the transaction).
    const smuggled = "task_category=secret-memo-contents";
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "task_category",
          day: "2026-07-01",
          dim: smuggled,
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) {
      expect(outcome.body.error).toMatch(/task_category dim must be/);
    }
    expect(
      await forOrg(db, orgA).metrics.records({
        metricKey: "task_category",
        from: "2026-07-01",
        to: "2026-07-02",
        dim: smuggled,
      }),
    ).toHaveLength(0);
  });

  it("rejects a task_category dim missing the task_category= prefix", async () => {
    const batch = makeBatch({
      records: [
        {
          subject: DEV_SUBJECT,
          metricKey: "task_category",
          day: "2026-07-01",
          dim: "drafting", // no `task_category=` prefix
          value: 1,
          attribution: "person",
        },
      ],
      signals: [],
    });
    expect(await ingestAgentBatch(db, ENV, tokenA, batch)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("rejects malformed signal hours (not 24 slots)", async () => {
    const batch = makeBatch();
    batch.signals[0].hours = [1, 2, 3];
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects record/signal days outside the declared window", async () => {
    const batch = makeBatch();
    batch.records[0].day = "2026-06-15"; // before window.start
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) {
      expect(outcome.body.error).toMatch(/outside declared window/);
    }
  });

  it("rejects person attribution on a non-person subject", async () => {
    const batch = makeBatch({
      subjects: [
        {
          kind: "account",
          externalId: "device:abc123",
          email: null,
          displayName: null,
        },
      ],
      records: [
        {
          subject: { kind: "account", externalId: "device:abc123" },
          metricKey: "sessions",
          day: "2026-07-01",
          dim: "",
          value: 1,
          attribution: "person", // fabricating a person from a device
        },
      ],
      signals: [],
    });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    if (!outcome.ok) {
      expect(outcome.body.error).toMatch(/never fabricate people/);
    }
  });
});

describe("agent ingest — operator controls", () => {
  it("a paused connection rejects ingest (403) and stays paused", async () => {
    const token = composeAgentToken(orgA, connPaused, secretPaused);
    const outcome = await ingestAgentBatch(db, ENV, token, makeBatch());
    expect(outcome).toMatchObject({
      ok: false,
      status: 403,
      body: { error: "connection paused" },
    });

    const scoped = forOrg(db, orgA);
    const conn = await scoped.connections.get(connPaused);
    expect(conn.status).toBe("paused"); // NOT silently re-activated
    expect(await scoped.subjects.list({ connectionId: connPaused })).toHaveLength(0);
  });

  it("a forged-secret probe never stamps last_used_at", async () => {
    const forged = composeAgentToken(orgA, connProbe, generateAgentSecret());
    const outcome = await ingestAgentBatch(db, ENV, forged, makeBatch());
    expect(outcome).toMatchObject({ ok: false, status: 401 });

    const [credRow] = await db
      .select()
      .from(schema.connectionCredentials)
      .where(
        and(
          eq(schema.connectionCredentials.connectionId, connProbe),
          eq(schema.connectionCredentials.kind, "device_token"),
        ),
      );
    expect(credRow.lastUsedAt).toBeNull(); // probe ≠ legitimate device use

    // …while a genuine push does stamp it.
    const genuine = composeAgentToken(orgA, connProbe, secretProbe);
    expect((await ingestAgentBatch(db, ENV, genuine, makeBatch())).ok).toBe(
      true,
    );
    const [after] = await db
      .select()
      .from(schema.connectionCredentials)
      .where(
        and(
          eq(schema.connectionCredentials.connectionId, connProbe),
          eq(schema.connectionCredentials.kind, "device_token"),
        ),
      );
    expect(after.lastUsedAt).not.toBeNull();
  });
});

describe("agent ingest — honesty-gap sink (ADR 0025)", () => {
  it("an accepted push lands a completed agent_ingest run row carrying the gaps", async () => {
    const batch = makeBatch({
      gaps: [
        {
          kind: "sync_window_incomplete",
          detail: "local logs only cover from 2026-07-01",
        },
        { kind: "other", detail: "spend estimate uses list prices" },
      ],
    });
    expect((await ingestAgentBatch(db, ENV, tokenA, batch)).ok).toBe(true);

    const run = await forOrg(db, orgA).connectorRuns.latest(connA);
    expect(run).toMatchObject({
      kind: "agent_ingest",
      status: "success",
      windowStart: "2026-07-01",
      windowEnd: "2026-07-02",
      subjectsSeen: 1,
      recordsUpserted: 3,
      signalsUpserted: 1,
    });
    // The gaps are no longer buried in raw_payloads — they sit exactly
    // where collectGaps (both dashboard readers) collects from.
    expect(run.gaps).toEqual(batch.gaps);
  });

  it("a rejected push writes no run row", async () => {
    const before = await forOrg(db, orgA).connectorRuns.list({
      connectionId: connA,
    });
    const bad = makeBatch();
    bad.records[0].day = "2026-06-15"; // outside window → 400
    expect((await ingestAgentBatch(db, ENV, tokenA, bad)).ok).toBe(false);
    const after = await forOrg(db, orgA).connectorRuns.list({
      connectionId: connA,
    });
    expect(after).toHaveLength(before.length);
  });
});

describe("agent ingest — score-recompute enqueue (Fix 2, plan PR2)", () => {
  const collect = () => {
    const sent: PollMessage[] = [];
    return {
      sent,
      send: async (message: PollMessage) => {
        sent.push(message);
      },
    };
  };

  it("a successful ingest with rows enqueues exactly one recompute for the token's org", async () => {
    const { sent, send } = collect();
    // Bracket the call so the day assertion can't flake across a UTC
    // midnight boundary (the lib reads its own clock).
    const before = previousDay(new Date().toISOString().slice(0, 10));
    const outcome = await ingestAgentBatch(db, ENV, tokenA, makeBatch(), {
      send,
    });
    const after = previousDay(new Date().toISOString().slice(0, 10));
    expect(outcome.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "score-recompute",
      orgId: orgA, // from the token, never the payload
    });
    expect([before, after]).toContain(
      (sent[0] as { day: string }).day,
    );
  });

  it("failed ingests never enqueue: bad auth, bad body, paused connection", async () => {
    const { sent, send } = collect();
    await ingestAgentBatch(db, ENV, "not-a-token", makeBatch(), { send });

    const badBody = makeBatch();
    badBody.records[0].day = "2026-06-15"; // outside window → 400
    await ingestAgentBatch(db, ENV, tokenA, badBody, { send });

    const paused = composeAgentToken(orgA, connPaused, secretPaused);
    await ingestAgentBatch(db, ENV, paused, makeBatch(), { send });

    expect(sent).toHaveLength(0);
  });

  it("a zero-row (empty) batch does not enqueue — no amplification on empty syncs", async () => {
    const { sent, send } = collect();
    const empty = makeBatch({ records: [], signals: [] });
    const outcome = await ingestAgentBatch(db, ENV, tokenA, empty, { send });
    expect(outcome.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("a throwing queue never fails the committed ingest (best-effort)", async () => {
    const outcome = await ingestAgentBatch(db, ENV, tokenA, makeBatch(), {
      send: async () => {
        throw new Error("queue unavailable");
      },
    });
    expect(outcome).toMatchObject({ ok: true, status: 200 });
  });

  it("omitting deps keeps the legacy call shape working (no enqueue)", async () => {
    const outcome = await ingestAgentBatch(db, ENV, tokenA, makeBatch());
    expect(outcome.ok).toBe(true);
  });
});
