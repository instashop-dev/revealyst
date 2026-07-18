import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { agentSourceConnector } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { collapseSourcesToMax } from "../src/db/org-scope/metrics";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { ingestAgentBatch } from "../src/lib/agent-ingest";
import {
  composeAgentToken,
  generateAgentSecret,
} from "../src/lib/agent-token";
import type { CredentialEnv } from "../src/lib/credentials";

// ADR 0060 / D-DA-8: `source_connector` is part of the metric_records natural
// key, so the delete-then-upsert restatement is connector-scoped — one source
// can never clobber a sibling source's overlapping days, and reads collapse
// two sources' same-(subject,day,dim) rows to MAX so no downstream SUM
// double-counts. Real migrations on PGlite (rule 2).

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

const WINDOW = { from: "2026-07-01", to: "2026-07-31" } as const;

let db: Db;
let orgId: string;
let connectionId: string;
let subjectId: string;

async function rawRows(metricKey: string) {
  return db
    .select()
    .from(schema.metricRecords)
    .where(
      and(
        eq(schema.metricRecords.orgId, orgId),
        eq(schema.metricRecords.metricKey, metricKey),
      ),
    )
    .orderBy(schema.metricRecords.sourceConnector);
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "cs-ingest-org", kind: "personal" })
    .returning();
  orgId = org.id;

  const scoped = forOrg(db, orgId);
  connectionId = (
    await scoped.connections.create({
      vendor: "claude_code_local",
      displayName: "Device",
      authKind: "device_token",
    })
  ).id;
  const [subject] = await scoped.subjects.upsertMany(connectionId, [
    { kind: "person", externalId: "dev@example.com", email: "dev@example.com" },
  ]);
  subjectId = subject.id;
});

describe("collapseSourcesToMax (the read-boundary dedup)", () => {
  const row = (over: Partial<typeof schema.metricRecords.$inferSelect> = {}) =>
    ({
      orgId: "o",
      subjectId: "s1",
      metricKey: "prompts",
      day: "2026-07-01",
      dim: "",
      connectionId: "c",
      value: 5,
      attribution: "person",
      sourceConnector: "claude-code-local@1",
      rawPayloadId: null,
      insertedAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as typeof schema.metricRecords.$inferSelect;

  it("is a strict no-op (same array) when there are no cross-source dups", () => {
    const rows = [
      row({ day: "2026-07-01" }),
      row({ day: "2026-07-02" }),
      row({ subjectId: "s2", day: "2026-07-01" }),
    ];
    // Identity: single-source data returns the EXACT input (byte-identical
    // reads — the migration-equivalence guarantee for existing orgs).
    expect(collapseSourcesToMax(rows)).toBe(rows);
  });

  it("collapses two sources of the same (subject,day,dim) to MAX", () => {
    const rows = [
      row({ sourceConnector: "claude-code-local@1", value: 5 }),
      row({ sourceConnector: "claude_export@1", value: 12 }),
    ];
    const out = collapseSourcesToMax(rows);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(12); // MAX, never SUM (would be 17)
  });

  it("carries the LOWEST attribution of the collapsed group", () => {
    const rows = [
      row({ sourceConnector: "a@1", value: 9, attribution: "person" }),
      row({ sourceConnector: "b@1", value: 3, attribution: "account" }),
    ];
    const out = collapseSourcesToMax(rows);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(9);
    expect(out[0].attribution).toBe("account"); // degraded input surfaced
  });

  it("does not merge rows that differ by day or dim", () => {
    const rows = [
      row({ day: "2026-07-01" }),
      row({ day: "2026-07-02" }),
      row({ dim: "model=x" }),
    ];
    expect(collapseSourcesToMax(rows)).toHaveLength(3);
  });
});

describe("connector-scoped restatement (no cross-source clobber)", () => {
  it("keeps both sources' rows under the source-scoped natural key", async () => {
    const scoped = forOrg(db, orgId);
    await scoped.metrics.upsertRecords([
      {
        subjectId,
        metricKey: "prompts",
        day: "2026-07-01",
        connectionId,
        value: 5,
        attribution: "person",
        sourceConnector: "claude-code-local@1",
      },
      {
        subjectId,
        metricKey: "prompts",
        day: "2026-07-01",
        connectionId,
        value: 12,
        attribution: "person",
        sourceConnector: "claude_export@1",
      },
    ]);

    // Two physical rows persist (source is part of the key)...
    expect(await rawRows("prompts")).toHaveLength(2);
    // ...but the read boundary collapses them to ONE MAX row.
    const read = await scoped.metrics.records({
      metricKey: "prompts",
      ...WINDOW,
    });
    expect(read).toHaveLength(1);
    expect(read[0].value).toBe(12);
  });

  it("a source-scoped window-delete removes ONLY that source's rows", async () => {
    const scoped = forOrg(db, orgId);
    // Restate the live source's window; the export's overlapping day survives.
    await scoped.metrics.deleteWindowForConnection(
      connectionId,
      "claude-code-local@1",
      WINDOW.from,
      WINDOW.to,
    );
    const rows = await rawRows("prompts");
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceConnector).toBe("claude_export@1");
    expect(rows[0].value).toBe(12);
  });

  it("deleteSignals:false leaves the connection's signals untouched", async () => {
    const scoped = forOrg(db, orgId);
    await scoped.metrics.upsertSignals([
      {
        subjectId,
        day: "2026-07-01",
        hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 3 : 0)),
        peakConcurrency: 1,
        sourceGranularity: "1h",
      },
    ]);
    // The export source restates its records but must NOT touch signals.
    await scoped.metrics.deleteWindowForConnection(
      connectionId,
      "claude_export@1",
      WINDOW.from,
      WINDOW.to,
      { deleteSignals: false },
    );
    const signals = await scoped.metrics.signals({ subjectId, ...WINDOW });
    expect(signals).toHaveLength(1); // survived

    // The default (deleteSignals: true) DOES sweep them.
    await scoped.metrics.deleteWindowForConnection(
      connectionId,
      "claude-code-local@1",
      WINDOW.from,
      WINDOW.to,
    );
    expect(await scoped.metrics.signals({ subjectId, ...WINDOW })).toHaveLength(
      0,
    );
  });
});

describe("agentSourceConnector (server-composed, closed set)", () => {
  it("composes the live connector id from the summarizer version", () => {
    expect(agentSourceConnector("claude-code-local", 1)).toBe(
      "claude-code-local@1",
    );
    expect(agentSourceConnector("claude-code-local", 3)).toBe(
      "claude-code-local@3",
    );
  });
  it("composes a fixed, distinct id for the export source", () => {
    expect(agentSourceConnector("claude-export", 1)).toBe("claude_export@1");
    expect(agentSourceConnector("claude-export", 9)).toBe("claude_export@1");
  });
});

describe("agent ingest end-to-end: export source can't clobber the live source", () => {
  it("a claude-export push restates only its own rows and writes no signals", async () => {
    // A fresh org with its own device connection + token.
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: "cs-e2e-org", kind: "personal" })
      .returning();
    const scoped = forOrg(db, org.id);
    const conn = (
      await scoped.connections.create({
        vendor: "claude_code_local",
        displayName: "Device",
        authKind: "device_token",
      })
    ).id;
    const secret = generateAgentSecret();
    await scoped.connections.storeCredential(conn, "device_token", secret, ENV);
    const token = composeAgentToken(org.id, conn, secret);

    const subject = {
      kind: "person" as const,
      externalId: "dev@example.com",
    };
    const subjectDescriptor = { ...subject, email: null, displayName: null };

    // 1) The live connector syncs Jul 1-2 (with a signal on Jul 1).
    const live = await ingestAgentBatch(db, ENV, token, {
      agentVersion: "0.1.0",
      summarizerVersion: 1,
      window: { start: "2026-07-01", end: "2026-07-02" },
      subjects: [subjectDescriptor],
      records: [
        { subject, metricKey: "prompts", day: "2026-07-01", dim: "", value: 10, attribution: "person" },
        { subject, metricKey: "prompts", day: "2026-07-02", dim: "", value: 20, attribution: "person" },
      ],
      signals: [
        {
          subject,
          day: "2026-07-01",
          hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 4 : 0)),
          peakConcurrency: 1,
          sourceGranularity: "1h",
        },
      ],
      gaps: [],
    });
    expect(live.ok).toBe(true);

    // 2) A Claude-export import (source: "claude-export") lands an OVERLAPPING
    // window Jul 1-2 with different values and NO signals.
    const exported = await ingestAgentBatch(db, ENV, token, {
      agentVersion: "0.1.0",
      summarizerVersion: 1,
      source: "claude-export",
      window: { start: "2026-07-01", end: "2026-07-02" },
      subjects: [subjectDescriptor],
      records: [
        { subject, metricKey: "prompts", day: "2026-07-01", dim: "", value: 3, attribution: "person" },
        { subject, metricKey: "prompts", day: "2026-07-02", dim: "", value: 4, attribution: "person" },
      ],
      signals: [],
      gaps: [],
    });
    expect(exported.ok).toBe(true);

    // Both sources' rows coexist: 2 days × 2 sources = 4 physical rows.
    const rows = await db
      .select()
      .from(schema.metricRecords)
      .where(
        and(
          eq(schema.metricRecords.orgId, org.id),
          eq(schema.metricRecords.metricKey, "prompts"),
        ),
      );
    expect(rows).toHaveLength(4);
    const sources = new Set(rows.map((r) => r.sourceConnector));
    expect(sources).toEqual(
      new Set(["claude-code-local@1", "claude_export@1"]),
    );

    // The live connector's rows are UNTOUCHED (not clobbered by the export).
    const liveRows = rows.filter(
      (r) => r.sourceConnector === "claude-code-local@1",
    );
    expect(liveRows.map((r) => r.value).sort()).toEqual([10, 20]);

    // The read boundary collapses each day to MAX (10 and 20, never 13/24).
    const read = await forOrg(db, org.id).metrics.records({
      metricKey: "prompts",
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(read.map((r) => r.value).sort((a, b) => a - b)).toEqual([10, 20]);

    // The export wrote NO signals and did NOT delete the live signal.
    const signals = await forOrg(db, org.id).metrics.signals({
      subjectId: rows[0].subjectId,
      from: "2026-07-01",
      to: "2026-07-02",
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].peakConcurrency).toBe(1);
  });
});
