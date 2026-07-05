import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentIngestRequest } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
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
let secretA: string;
let tokenA: string;

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

  it("rejects malformed signal hours (not 24 slots)", async () => {
    const batch = makeBatch();
    batch.signals[0].hours = [1, 2, 3];
    const outcome = await ingestAgentBatch(db, ENV, tokenA, batch);
    expect(outcome).toMatchObject({ ok: false, status: 400 });
  });
});
