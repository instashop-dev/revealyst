import { PGlite } from "@electric-sql/pglite";
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
import { authenticateDeviceToken } from "../src/lib/device-token";

// T2.1 (Desktop Agent plan): the shared device-token verifier, extracted from
// otel-receiver.ts so /api/agent/ingest, /v1/metrics, and /v1/logs share ONE
// implementation. These tests pin the verifier's contract directly at its new
// home: 401 for anything auth-shaped (malformed / unknown / wrong secret —
// one indistinguishable message), 403 ONLY once authenticated but paused, and
// the success shape (org scope + the already-fetched connection row). The
// otel-receiver and agent-ingest suites separately pin that route behavior
// did not change.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

describe("authenticateDeviceToken (shared verifier)", () => {
  let db: Db;
  let orgId: string;
  let connId: string;
  let secret: string;
  let token: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "device-token", "team")).id;
    const scoped = forOrg(db, orgId);
    connId = (
      await scoped.connections.create({
        vendor: "claude_code_local",
        displayName: "Desktop Agent device",
        authKind: "device_token",
      })
    ).id;
    secret = generateAgentSecret();
    await scoped.connections.storeCredential(connId, "device_token", secret, ENV);
    token = composeAgentToken(orgId, connId, secret);
  });

  it("authenticates a valid device token and returns the connection row", async () => {
    const result = await authenticateDeviceToken(db, ENV, token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orgId).toBe(orgId);
      expect(result.connectionId).toBe(connId);
      // The success carries the row the verifier already fetched — the
      // agent-ingest adoption relies on this to avoid a re-read.
      expect(result.connection.id).toBe(connId);
      expect(result.connection.vendor).toBe("claude_code_local");
    }
  });

  it("rejects a missing/empty token with 401", async () => {
    const result = await authenticateDeviceToken(db, ENV, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: "invalid device token" });
    }
  });

  it("rejects a malformed token with 401", async () => {
    for (const bad of [
      "rva1.bad.bad.bad", // non-UUID org/connection
      `rvaX.${orgId}.${connId}.${secret}`, // wrong prefix
      `rva1.${orgId}.${connId}`, // missing secret segment
      `rva1.${orgId}.${connId}.${secret}.extra`, // extra segment
    ]) {
      const result = await authenticateDeviceToken(db, ENV, bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    }
  });

  it("rejects a wrong secret with the same 401 as an unknown connection", async () => {
    const wrongSecret = composeAgentToken(orgId, connId, generateAgentSecret());
    const result = await authenticateDeviceToken(db, ENV, wrongSecret);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      // Indistinguishable from every other auth failure — a probe can't
      // learn whether the connection exists.
      expect(result.body).toEqual({ error: "invalid device token" });
    }
  });

  it("rejects an unknown connection with 401", async () => {
    const noSuchConnection = "00000000-0000-4000-8000-000000000000";
    const result = await authenticateDeviceToken(
      db,
      ENV,
      composeAgentToken(orgId, noSuchConnection, secret),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a connection whose authKind isn't device_token with 401", async () => {
    const scoped = forOrg(db, orgId);
    const wrongKind = await scoped.connections.create({
      vendor: "cursor",
      displayName: "Not a device connection",
      authKind: "api_key",
    });
    const result = await authenticateDeviceToken(
      db,
      ENV,
      composeAgentToken(orgId, wrongKind.id, secret),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a paused connection with 403 (authenticated, but revoked)", async () => {
    const scoped = forOrg(db, orgId);
    await scoped.connections.update(connId, { status: "paused" });
    try {
      const result = await authenticateDeviceToken(db, ENV, token);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(403);
        expect(result.body).toEqual({ error: "connection paused" });
      }
    } finally {
      // Un-pause even when an assertion throws — a leaked `paused` would
      // cascade a confusing failure into sibling tests.
      await scoped.connections.update(connId, { status: "active" });
    }
  });
});
