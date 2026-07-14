import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  composeAgentToken,
  generateAgentSecret,
} from "../src/lib/agent-token";
import type { CredentialEnv } from "../src/lib/credentials";
import { ingestOtelMetrics } from "../src/lib/otel-receiver";

// W7-8: the OTLP receiver end-to-end — device-token auth (reusing agent-ingest's
// scheme), decode a REAL captured payload, land markers in metric_records.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

/** A real captured metrics payload that actually contains active_time. */
function aCapturedMetricsPayload(): unknown {
  for (const f of readdirSync("fixtures/otel")) {
    if (!/metrics-\d+\.captured\.json$/.test(f)) continue;
    const j = JSON.parse(readFileSync(`fixtures/otel/${f}`, "utf8"));
    if (JSON.stringify(j).includes("claude_code.active_time.total")) return j;
  }
  throw new Error("no captured metrics fixture with active_time");
}

describe("ingestOtelMetrics", () => {
  let db: Db;
  let orgId: string;
  let connId: string;
  let token: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "otel-recv", "team")).id;
    const scoped = forOrg(db, orgId);
    connId = (
      await scoped.connections.create({
        vendor: "claude_code_local",
        displayName: "Claude Code OTel",
        authKind: "device_token",
      })
    ).id;
    const secret = generateAgentSecret();
    await scoped.connections.storeCredential(connId, "device_token", secret, ENV);
    token = composeAgentToken(orgId, connId, secret);
  });

  it("rejects an invalid / missing token with 401", async () => {
    expect((await ingestOtelMetrics(db, ENV, "", {})).status).toBe(401);
    expect((await ingestOtelMetrics(db, ENV, "rva1.bad.bad.bad", {})).status).toBe(401);
  });

  it("authenticates, decodes a REAL payload, and lands markers in metric_records", async () => {
    const outcome = await ingestOtelMetrics(db, ENV, token, aCapturedMetricsPayload());
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe(200);
    expect(outcome.markersIngested).toBeGreaterThan(0);

    // The markers actually landed on a resolved subject.
    const rows = await db
      .select()
      .from(schema.metricRecords)
      .where(eq(schema.metricRecords.metricKey, "otel_active_time"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === orgId)).toBe(true);
    expect(rows.every((r) => r.sourceConnector === "claude-code-otel@1")).toBe(true);
    expect(rows.every((r) => r.attribution === "person")).toBe(true);
  });

  it("is idempotent: re-POSTing the same payload doesn't duplicate rows", async () => {
    const payload = aCapturedMetricsPayload();
    await ingestOtelMetrics(db, ENV, token, payload);
    const before = (await db.select().from(schema.metricRecords)).length;
    await ingestOtelMetrics(db, ENV, token, payload);
    const after = (await db.select().from(schema.metricRecords)).length;
    expect(after).toBe(before); // frozen upsert key — a re-export restates, not appends
  });
});
