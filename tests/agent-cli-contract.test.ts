import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildIngestRequest } from "../packages/revealyst-agent/src/index";
import { agentIngestRequestSchema } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { ingestAgentBatch } from "../src/lib/agent-ingest";
import {
  composeAgentToken,
  generateAgentSecret,
} from "../src/lib/agent-token";
import type { CredentialEnv } from "../src/lib/credentials";

// THE W1-E seam test (rule 2): the CLI package mirrors the frozen contract
// types locally; this suite proves a REAL batch built by the CLI pipeline
// (fixtures → parse → summarize → buildIngestRequest) validates against
// the frozen zod schemas AND lands end-to-end through the ingest path.
// If either side drifts, this fails CI — the drift cannot ship silently.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

const request = buildIngestRequest({
  sessionContents: [
    readFileSync(
      "fixtures/vendor-payloads/claude-code-local/main-session.jsonl",
      "utf8",
    ),
    readFileSync(
      "fixtures/vendor-payloads/claude-code-local/sidechain-session.jsonl",
      "utf8",
    ),
  ],
  window: { start: "2026-07-01", end: "2026-07-31" },
  identity: {
    descriptor: {
      kind: "person",
      externalId: "dev@example.com",
      email: "dev@example.com",
      displayName: null,
    },
    attribution: "person",
  },
  agentVersion: "0.1.0",
});

describe("CLI batch ↔ frozen contract", () => {
  it("a real built batch parses under the frozen ingest schema", () => {
    const parsed = agentIngestRequestSchema.safeParse(request);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("the account-fallback identity variant parses too", () => {
    const fallback = buildIngestRequest({
      sessionContents: [],
      window: { start: "2026-07-01", end: "2026-07-02" },
      identity: {
        descriptor: {
          kind: "account",
          externalId: "device:abcdef0123456789",
          email: null,
          displayName: null,
        },
        attribution: "account",
      },
      agentVersion: "0.1.0",
    });
    // No events → no records, but the envelope itself must stay valid.
    expect(agentIngestRequestSchema.safeParse(fallback).success).toBe(true);
  });
});

describe("CLI batch lands end-to-end", () => {
  let db: Db;
  let orgId: string;
  let token: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: "cli-e2e", kind: "personal" })
      .returning();
    orgId = org.id;
    const scoped = forOrg(db, orgId);
    const connection = await scoped.connections.create({
      vendor: "claude_code_local",
      displayName: "Revealyst Agent",
      authKind: "device_token",
    });
    const secret = generateAgentSecret();
    await scoped.connections.storeCredential(
      connection.id,
      "device_token",
      secret,
      ENV,
    );
    token = composeAgentToken(orgId, connection.id, secret);
  });

  it("fixtures → parse → summarize → ingest → metric_records", async () => {
    const outcome = await ingestAgentBatch(db, ENV, token, request);
    expect(outcome).toMatchObject({ ok: true, status: 200 });

    const scoped = forOrg(db, orgId);
    const sessions = await scoped.metrics.records({
      metricKey: "sessions",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(sessions).toHaveLength(2); // two active days
    expect(sessions[0].value).toBe(2); // main + sidechain on day 1
    expect(sessions[0].attribution).toBe("person");
    expect(sessions[0].sourceConnector).toBe("claude-code-local@1");

    const [subject] = await scoped.subjects.list();
    expect(subject.email).toBe("dev@example.com");
    const signals = await scoped.metrics.signals({
      subjectId: subject.id,
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(signals).toHaveLength(2);
    expect(signals[0].hours?.[9]).toBe(7);
    expect(signals[0].peakConcurrency).toBe(2);
  });
});
