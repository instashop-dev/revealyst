import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { composeAgentToken, generateAgentSecret } from "../src/lib/agent-token";
import { ApiError } from "../src/lib/api-impl";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  ownDevices,
  renameDevice,
  revokeDevice,
  toDeviceView,
} from "../src/lib/desktop-devices";
import { recordDesktopHeartbeat } from "../src/lib/desktop-heartbeat";
import { authenticateDeviceToken } from "../src/lib/device-token";

// Desktop device management (Desktop Agent T2.4, ADR 0050): heartbeat stamping,
// self-owned rename/revoke, self-view filtering, and the §27.4 multi-device
// independence guarantee. All against PGlite, mirroring device-token.test.ts.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

async function seedUser(db: Db, id: string): Promise<string> {
  await (db as unknown as ReturnType<typeof drizzle>)
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@example.com` })
    .onConflictDoNothing();
  return id;
}

type MintedDevice = { id: string; token: string };

async function mintDevice(
  db: Db,
  orgId: string,
  userId: string,
  opts?: { name?: string; platform?: "macos" | "windows"; vendor?: string },
): Promise<MintedDevice> {
  const scope = forOrg(db, orgId);
  const conn = await scope.connections.create({
    vendor: opts?.vendor ?? "claude_code_local",
    displayName: opts?.name ?? "MacBook",
    authKind: "device_token",
    config: {
      source: "desktop-agent",
      platform: opts?.platform ?? "macos",
      architecture: "arm64",
      agentVersion: "0.1.0",
      installationId: crypto.randomUUID(),
      pairedByUserId: userId,
    },
  });
  const secret = generateAgentSecret();
  await scope.connections.storeCredential(conn.id, "device_token", secret, ENV);
  return { id: conn.id, token: composeAgentToken(orgId, conn.id, secret) };
}

describe("desktop device management (T2.4)", () => {
  let db: Db;
  let orgId: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "devices", "personal")).id;
    userA = await seedUser(db, "user-a");
    userB = await seedUser(db, "user-b");
  });

  describe("heartbeat", () => {
    it("stamps lastHeartbeatAt + refreshed agentVersion + queueDepth into config, preserving pairing keys", async () => {
      const device = await mintDevice(db, orgId, userA, { name: "hb-device" });
      const when = new Date("2026-07-16T12:00:00.000Z");
      const outcome = await recordDesktopHeartbeat(
        db,
        ENV,
        device.token,
        { agentVersion: "0.2.0", queueDepth: 5 },
        when,
      );
      expect(outcome.status).toBe(200);
      expect(outcome.body).toEqual({ ok: true });

      const row = await forOrg(db, orgId).connections.get(device.id);
      const config = row?.config as Record<string, unknown>;
      expect(config.lastHeartbeatAt).toBe(when.toISOString());
      expect(config.agentVersion).toBe("0.2.0");
      expect(config.queueDepth).toBe(5);
      // Pairing-time keys survive the shallow merge.
      expect(config.platform).toBe("macos");
      expect(config.pairedByUserId).toBe(userA);
      expect(config.installationId).toBeTruthy();
    });

    it("accepts a zero queue depth", async () => {
      const device = await mintDevice(db, orgId, userA);
      const outcome = await recordDesktopHeartbeat(db, ENV, device.token, {
        agentVersion: "1.0.0",
        queueDepth: 0,
      });
      expect(outcome.status).toBe(200);
    });

    it("rejects a non-numeric queueDepth (strict zod) with 400", async () => {
      const device = await mintDevice(db, orgId, userA);
      const outcome = await recordDesktopHeartbeat(db, ENV, device.token, {
        agentVersion: "0.2.0",
        queueDepth: "5",
      });
      expect(outcome.status).toBe(400);
    });

    it("rejects a negative queueDepth with 400", async () => {
      const device = await mintDevice(db, orgId, userA);
      const outcome = await recordDesktopHeartbeat(db, ENV, device.token, {
        agentVersion: "0.2.0",
        queueDepth: -1,
      });
      expect(outcome.status).toBe(400);
    });

    it("rejects an oversized agentVersion with 400", async () => {
      const device = await mintDevice(db, orgId, userA);
      const outcome = await recordDesktopHeartbeat(db, ENV, device.token, {
        agentVersion: "x".repeat(65),
        queueDepth: 1,
      });
      expect(outcome.status).toBe(400);
    });

    it("rejects unknown extra keys (strict) with 400", async () => {
      const device = await mintDevice(db, orgId, userA);
      const outcome = await recordDesktopHeartbeat(db, ENV, device.token, {
        agentVersion: "0.2.0",
        queueDepth: 1,
        events: [{ secret: "content" }],
      });
      expect(outcome.status).toBe(400);
    });

    it("rejects a missing token with 401 (before body validation)", async () => {
      const outcome = await recordDesktopHeartbeat(db, ENV, "", {
        agentVersion: "0.2.0",
        queueDepth: 1,
      });
      expect(outcome.status).toBe(401);
    });

    it("rejects a device_token connection whose vendor isn't a desktop device with 401", async () => {
      const notADevice = await mintDevice(db, orgId, userA, {
        vendor: "cursor",
      });
      const outcome = await recordDesktopHeartbeat(db, ENV, notADevice.token, {
        agentVersion: "0.2.0",
        queueDepth: 1,
      });
      expect(outcome.status).toBe(401);
    });
  });

  describe("revoke", () => {
    it("pauses the connection and destroys the credential, so the old token can no longer authenticate or heartbeat", async () => {
      const device = await mintDevice(db, orgId, userA, { name: "to-revoke" });
      const scope = forOrg(db, orgId);

      // Sanity: it authenticates before revoke.
      expect((await authenticateDeviceToken(db, ENV, device.token)).ok).toBe(true);

      await revokeDevice(scope, { deviceId: device.id, userId: userA });

      const row = await scope.connections.get(device.id);
      expect(row?.status).toBe("paused");

      // Auth now fails (credential gone) and the heartbeat is rejected.
      const auth = await authenticateDeviceToken(db, ENV, device.token);
      expect(auth.ok).toBe(false);
      const hb = await recordDesktopHeartbeat(db, ENV, device.token, {
        agentVersion: "0.2.0",
        queueDepth: 1,
      });
      expect(hb.status).toBeGreaterThanOrEqual(400);
      expect(hb.body).not.toEqual({ ok: true });
    });

    it("§27.4: revoking device A leaves device B authenticating and syncing", async () => {
      const deviceA = await mintDevice(db, orgId, userA, { name: "mac-a" });
      const deviceB = await mintDevice(db, orgId, userA, { name: "win-b" });
      const scope = forOrg(db, orgId);

      await revokeDevice(scope, { deviceId: deviceA.id, userId: userA });

      // A is gone…
      expect((await authenticateDeviceToken(db, ENV, deviceA.token)).ok).toBe(
        false,
      );
      // …B is entirely unaffected.
      const authB = await authenticateDeviceToken(db, ENV, deviceB.token);
      expect(authB.ok).toBe(true);
      const hbB = await recordDesktopHeartbeat(db, ENV, deviceB.token, {
        agentVersion: "0.2.0",
        queueDepth: 2,
      });
      expect(hbB.status).toBe(200);
    });

    it("refuses to revoke another member's device (404), never touching it", async () => {
      const device = await mintDevice(db, orgId, userB, { name: "b-owned" });
      const scope = forOrg(db, orgId);
      await expect(
        revokeDevice(scope, { deviceId: device.id, userId: userA }),
      ).rejects.toBeInstanceOf(ApiError);
      // Untouched: still active, still authenticates.
      const row = await scope.connections.get(device.id);
      expect(row?.status).not.toBe("paused");
      expect((await authenticateDeviceToken(db, ENV, device.token)).ok).toBe(true);
    });
  });

  describe("rename", () => {
    it("persists a new display name and audits the change", async () => {
      const device = await mintDevice(db, orgId, userA, { name: "old-name" });
      const scope = forOrg(db, orgId);
      const before = (await scope.auditLog.list({ limit: 200 })).length;

      const result = await renameDevice(scope, {
        deviceId: device.id,
        userId: userA,
        name: "  Work Mac  ",
      });
      expect(result).toEqual({ ok: true, name: "Work Mac" });

      const row = await scope.connections.get(device.id);
      expect(row?.displayName).toBe("Work Mac");
      const after = await scope.auditLog.list({ limit: 200 });
      expect(after.length).toBe(before + 1);
      expect(after[0]?.action).toBe("desktop.device_rename");
    });

    it("refuses to rename another member's device (404)", async () => {
      const device = await mintDevice(db, orgId, userB, { name: "b-name" });
      const scope = forOrg(db, orgId);
      await expect(
        renameDevice(scope, {
          deviceId: device.id,
          userId: userA,
          name: "hijacked",
        }),
      ).rejects.toBeInstanceOf(ApiError);
      const row = await scope.connections.get(device.id);
      expect(row?.displayName).toBe("b-name");
    });

    it("404s an unknown device id", async () => {
      const scope = forOrg(db, orgId);
      await expect(
        renameDevice(scope, {
          deviceId: "00000000-0000-4000-8000-000000000000",
          userId: userA,
          name: "nope",
        }),
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("self-view filtering (ownDevices)", () => {
    it("returns only the caller's own desktop devices, excluding others' and non-devices", async () => {
      const iso = (await createFixtureOrg(db, "devices-iso", "personal")).id;
      const uA = await seedUser(db, "iso-a");
      const uB = await seedUser(db, "iso-b");
      const aDevice = await mintDevice(db, iso, uA, { name: "a-owned" });
      await mintDevice(db, iso, uB, { name: "b-owned" });
      // A non-device connection in the same org must never appear.
      await forOrg(db, iso).connections.create({
        vendor: "cursor",
        displayName: "Cursor key",
        authKind: "api_key",
        config: { pairedByUserId: uA },
      });

      const all = await forOrg(db, iso).connections.list();
      const mine = ownDevices(all, uA);
      expect(mine.map((c) => c.id)).toEqual([aDevice.id]);
    });
  });

  describe("toDeviceView", () => {
    it("maps config fields, with null heartbeat before the first ping and values after", async () => {
      const view = await createFixtureOrg(db, "devices-view", "personal");
      const u = await seedUser(db, "view-a");
      const device = await mintDevice(db, view.id, u, {
        name: "View Mac",
        platform: "windows",
      });
      const scope = forOrg(db, view.id);

      const before = toDeviceView((await scope.connections.get(device.id))!);
      expect(before).toMatchObject({
        name: "View Mac",
        platform: "windows",
        agentVersion: "0.1.0",
        lastHeartbeatAt: null,
        queueDepth: null,
        revoked: false,
      });
      expect(before.enrolledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      await recordDesktopHeartbeat(
        db,
        ENV,
        device.token,
        { agentVersion: "3.0.0", queueDepth: 9 },
        new Date("2026-07-16T00:00:00.000Z"),
      );
      const after = toDeviceView((await scope.connections.get(device.id))!);
      expect(after).toMatchObject({
        agentVersion: "3.0.0",
        lastHeartbeatAt: "2026-07-16T00:00:00.000Z",
        queueDepth: 9,
      });
    });
  });
});
