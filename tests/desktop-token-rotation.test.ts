import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { composeAgentToken, generateAgentSecret } from "../src/lib/agent-token";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  type DesktopAccessTokenEnv,
  signDesktopAccessToken,
} from "../src/lib/desktop-access-token";
import { issueDesktopAccessToken } from "../src/lib/desktop-refresh";
import { authenticateDesktopBearer } from "../src/lib/device-token";

// T7.2 (Desktop Agent M7), ADR 0058. End-to-end against PGlite:
//   - the backward-compatible acceptor (authenticateDesktopBearer) accepts BOTH
//     a device token (legacy) and a short-lived access token (target state),
//     and still honors the paused-revocation 403 and unknown-connection 401 for
//     the access-token path;
//   - the /refresh core (issueDesktopAccessToken) mints a working access token
//     from a device token, rejects a bad/paused device token, and degrades to a
//     benign 503 (never a fake token) when the signing key is absent.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
function testAccessKey(): string {
  const bytes = new Uint8Array(32).fill(3);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}

const ENV: CredentialEnv & DesktopAccessTokenEnv = {
  CREDENTIAL_KEK_CURRENT: testKek(),
  DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testAccessKey(),
};

describe("desktop token rotation (ADR 0058)", () => {
  let db: Db;
  let orgId: string;
  let connId: string;
  let secret: string;
  let deviceToken: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "token-rotation", "team")).id;
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
    deviceToken = composeAgentToken(orgId, connId, secret);
  });

  describe("authenticateDesktopBearer — backward compatibility", () => {
    it("still accepts the legacy device token and returns the connection row", async () => {
      const result = await authenticateDesktopBearer(db, ENV, deviceToken);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.orgId).toBe(orgId);
        expect(result.connectionId).toBe(connId);
        expect(result.connection.id).toBe(connId);
      }
    });

    it("accepts a valid short-lived access token and returns the connection row", async () => {
      const { token } = await signDesktopAccessToken(ENV, {
        orgId,
        connectionId: connId,
      });
      const result = await authenticateDesktopBearer(db, ENV, token);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.orgId).toBe(orgId);
        expect(result.connectionId).toBe(connId);
        // The access-token path re-fetches the connection row, so downstream
        // ingest/config logic gets the SAME shape as the device-token path.
        expect(result.connection.id).toBe(connId);
        expect(result.connection.vendor).toBe("claude_code_local");
      }
    });

    it("rejects a signed access token for an unknown connection with 401", async () => {
      const { token } = await signDesktopAccessToken(ENV, {
        orgId,
        connectionId: "00000000-0000-4000-8000-000000000000",
      });
      const result = await authenticateDesktopBearer(db, ENV, token);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.body).toEqual({ error: "invalid device token" });
      }
    });

    it("rejects an invalidly-signed access token with 401 (never falls through to accept)", async () => {
      const { token } = await signDesktopAccessToken(
        { DESKTOP_ACCESS_TOKEN_SIGNING_KEY: `v1:${btoa("x".repeat(32))}` },
        { orgId, connectionId: connId },
      );
      const result = await authenticateDesktopBearer(db, ENV, token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    });

    it("honors the paused-revocation gesture with 403 even for a still-valid access token", async () => {
      const scoped = forOrg(db, orgId);
      const { token } = await signDesktopAccessToken(ENV, {
        orgId,
        connectionId: connId,
      });
      await scoped.connections.update(connId, { status: "paused" });
      try {
        const result = await authenticateDesktopBearer(db, ENV, token);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.status).toBe(403);
          expect(result.body).toEqual({ error: "connection paused" });
        }
      } finally {
        await scoped.connections.update(connId, { status: "active" });
      }
    });
  });

  describe("issueDesktopAccessToken — the /refresh core", () => {
    it("mints a working access token from a valid device token", async () => {
      const outcome = await issueDesktopAccessToken(db, ENV, deviceToken);
      expect(outcome.status).toBe(200);
      expect(outcome.body.tokenType).toBe("Bearer");
      expect(typeof outcome.body.accessToken).toBe("string");
      expect(outcome.body.expiresIn).toBe(15 * 60);
      // The minted token round-trips through the acceptor.
      const accepted = await authenticateDesktopBearer(
        db,
        ENV,
        outcome.body.accessToken as string,
      );
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.connectionId).toBe(connId);
    });

    it("rejects refresh presented with an access token (only the device token may refresh)", async () => {
      // A refresh must use the long-lived refresh credential. An access token
      // lacks the rva1. prefix, so it never authenticates at /refresh — this is
      // what bounds a stolen access token to its short TTL.
      const { token } = await signDesktopAccessToken(ENV, {
        orgId,
        connectionId: connId,
      });
      const outcome = await issueDesktopAccessToken(db, ENV, token);
      expect(outcome.status).toBe(401);
    });

    it("rejects a malformed/unknown device token with 401", async () => {
      const outcome = await issueDesktopAccessToken(db, ENV, "rva1.bad.bad.bad");
      expect(outcome.status).toBe(401);
      expect(outcome.body).toEqual({ error: "invalid device token" });
    });

    it("rejects a paused connection with 403", async () => {
      const scoped = forOrg(db, orgId);
      await scoped.connections.update(connId, { status: "paused" });
      try {
        const outcome = await issueDesktopAccessToken(db, ENV, deviceToken);
        expect(outcome.status).toBe(403);
      } finally {
        await scoped.connections.update(connId, { status: "active" });
      }
    });

    it("degrades to a benign 503 (never a fake token) when the signing key is absent", async () => {
      const outcome = await issueDesktopAccessToken(
        db,
        { CREDENTIAL_KEK_CURRENT: testKek() },
        deviceToken,
      );
      expect(outcome.status).toBe(503);
      expect(outcome.body.accessToken).toBeUndefined();
    });
  });
});
