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
    expect(sessions[0].value).toBe(1); // §5: sidechain ≠ session (its tokens still count)
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
    expect(signals[0].hours?.[9]).toBe(6); // deduped events at 09:xx
    expect(signals[0].peakConcurrency).toBe(2); // real overlap: sidechain within main
  });

  // Fix 1 regression (plan R2): the non-vacuous case — the requested
  // lookback must reach back PAST the surviving logs, or the pin is never
  // exercised and this test proves nothing (a default 30/30 gap is safe
  // without the fix). Delete-then-upsert is authoritative for the DECLARED
  // window, so an unpinned wide window would erase the previously-captured
  // June 1 rows below and upsert nothing in their place.
  it("a lookback wider than surviving logs cannot erase captured history", async () => {
    const scoped = forOrg(db, orgId);
    const identity = {
      descriptor: {
        kind: "account" as const,
        externalId: "device:pin-test-device00",
        email: null,
        displayName: null,
      },
      attribution: "account" as const,
    };
    const promptLine = (day: string, session: string) =>
      JSON.stringify({
        type: "user",
        sessionId: session,
        timestamp: `${day}T09:00:00.000Z`,
      });

    // Capture June 1 while its log still exists locally.
    const early = buildIngestRequest({
      sessionContents: [promptLine("2026-06-01", "pin-s1")],
      window: { start: "2026-06-01", end: "2026-06-01" },
      identity,
      agentVersion: "0.1.0",
    });
    expect(
      await ingestAgentBatch(db, ENV, token, early),
    ).toMatchObject({ ok: true });

    // Later: the June 1 log is pruned; only June 20 survives — but the
    // user asks for a lookback reaching back to May 25.
    const wide = buildIngestRequest({
      sessionContents: [promptLine("2026-06-20", "pin-s2")],
      window: { start: "2026-05-25", end: "2026-06-20" },
      identity,
      agentVersion: "0.1.0",
    });
    // Vacuity guard: the pin actually fired…
    expect(wide.window).toEqual({ start: "2026-06-20", end: "2026-06-20" });
    // …and disclosed itself (ADR 0025). This is the seam assertion keeping
    // the CLI mirror, the frozen zod enum, and the emission logic in
    // lockstep: the ingest below only accepts the batch if the frozen
    // schema knows the kind.
    expect(
      wide.gaps.some((g) => g.kind === "sync_window_incomplete"),
    ).toBe(true);
    expect(
      await ingestAgentBatch(db, ENV, token, wide),
    ).toMatchObject({ ok: true });

    // The previously-captured day survives the wide re-sync…
    const juneFirst = await scoped.metrics.records({
      metricKey: "active_day",
      from: "2026-06-01",
      to: "2026-06-01",
    });
    expect(juneFirst).toHaveLength(1);
    // …and the surviving day landed.
    const juneTwentieth = await scoped.metrics.records({
      metricKey: "active_day",
      from: "2026-06-20",
      to: "2026-06-20",
    });
    expect(juneTwentieth).toHaveLength(1);
  });
});
