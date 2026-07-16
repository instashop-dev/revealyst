import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildDesktopConfigVector } from "./helpers/desktop-config-vector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { composeAgentToken, generateAgentSecret } from "../src/lib/agent-token";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  canonicalizeConfig,
  composeAndSignDesktopConfig,
  composeDesktopConfig,
  DESKTOP_CONFIG_TTL_MS,
  parseSigningKey,
  signingKeyVersion,
  verifyDesktopConfig,
  type DesktopConfig,
  type DesktopConfigSigningEnv,
  type SignedDesktopConfig,
} from "../src/lib/desktop-config";

// Desktop Agent T4.2 (ADR 0049): the signed remote-config endpoint. The route
// uses getCloudflareContext (via getApiContext), which can't resolve outside a
// Workers request — so we mock getApiContext to a PGlite db + a test env, and
// otherwise exercise the real auth + compose + Ed25519 sign path. Pure-lib
// tests cover the never-broaden law and canonicalization stability.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Generate an ephemeral Ed25519 keypair, like the founder would OFFLINE.
 * Returns the `v<N>:<base64 pkcs8>` secret string and the raw 32-byte public
 * key the agent would bake in. */
async function ephemeralSigningKey(version = "v1"): Promise<{
  signingKey: string;
  publicKeyRaw: Uint8Array;
}> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", kp.privateKey),
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { signingKey: `${version}:${toBase64(pkcs8)}`, publicKeyRaw: raw };
}

// The route mock: getApiContext is replaced per test via these mutable holders.
let mockDb: Db;
let mockEnv: CredentialEnv & DesktopConfigSigningEnv;
vi.mock("../src/lib/api-context", () => ({
  getApiContext: () => ({ db: mockDb, env: mockEnv }),
}));
// The route imports "@/lib/api-context"; the vitest config aliases @ → ./src,
// so mock the same resolved module under the @-path too.
vi.mock("@/lib/api-context", () => ({
  getApiContext: () => ({ db: mockDb, env: mockEnv }),
}));

const ENV_KEK: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

describe("desktop-config lib", () => {
  it("composeDesktopConfig pins defaultContentMode to analytics_only", () => {
    const config = composeDesktopConfig({ signingKeyVersion: "v1" });
    expect(config.defaultContentMode).toBe("analytics_only");
  });

  it("never-broaden: there is no input that widens the content mode", () => {
    // The composer takes NO content-mode parameter — the type has a single
    // literal, so widening is not even expressible. Confirm across varied
    // inputs the value never changes.
    for (const emergencyShutdown of [true, false]) {
      for (const updateChannel of ["internal", "beta", "stable"] as const) {
        const c = composeDesktopConfig({
          signingKeyVersion: "v9",
          emergencyShutdown,
          updateChannel,
          minimumAgentVersion: "9.9.9",
        });
        expect(c.defaultContentMode).toBe("analytics_only");
      }
    }
  });

  it("expiry fields are sane: expiresAt is exactly TTL after issuedAt", () => {
    const now = Date.UTC(2026, 6, 17, 10, 0, 0);
    const config = composeDesktopConfig({ now, signingKeyVersion: "v1" });
    const issued = Date.parse(config.issuedAt);
    const expires = Date.parse(config.expiresAt);
    expect(issued).toBe(now);
    expect(expires).toBeGreaterThan(issued);
    expect(expires - issued).toBe(DESKTOP_CONFIG_TTL_MS);
  });

  it("canonicalization is stable: key order does not change the bytes", () => {
    const base = composeDesktopConfig({
      now: 1_000_000,
      signingKeyVersion: "v1",
    });
    // A shuffled-key clone of the SAME logical object must canonicalize
    // identically (sorted keys, no whitespace).
    const shuffled = {
      signingKeyVersion: base.signingKeyVersion,
      connectors: { claude_code: { ...base.connectors.claude_code } },
      emergencyShutdown: base.emergencyShutdown,
      defaultContentMode: base.defaultContentMode,
      updateChannel: base.updateChannel,
      minimumAgentVersion: base.minimumAgentVersion,
      expiresAt: base.expiresAt,
      issuedAt: base.issuedAt,
      configurationVersion: base.configurationVersion,
    } as DesktopConfig;
    expect(canonicalizeConfig(shuffled)).toBe(canonicalizeConfig(base));
    // Different content → different bytes (guards against a degenerate
    // canonicalizer that ignores fields).
    const other = composeDesktopConfig({
      now: 1_000_000,
      signingKeyVersion: "v1",
      emergencyShutdown: true,
    });
    expect(canonicalizeConfig(other)).not.toBe(canonicalizeConfig(base));
  });

  it("same input → same bytes → same signature (deterministic body)", async () => {
    const { signingKey } = await ephemeralSigningKey();
    const env = { DESKTOP_CONFIG_SIGNING_KEY: signingKey };
    const now = 42_000;
    const a = await composeAndSignDesktopConfig(env, { now });
    const b = await composeAndSignDesktopConfig(env, { now });
    // Ed25519 (RFC 8032) is deterministic, and the body is byte-identical, so
    // the signatures must match exactly.
    expect(a.signature).toBe(b.signature);
  });

  it("signs a config that verifies against the raw public key", async () => {
    const { signingKey, publicKeyRaw } = await ephemeralSigningKey();
    const signed = await composeAndSignDesktopConfig({
      DESKTOP_CONFIG_SIGNING_KEY: signingKey,
    });
    expect(await verifyDesktopConfig(publicKeyRaw, signed)).toBe(true);
  });

  it("a tampered body fails verification", async () => {
    const { signingKey, publicKeyRaw } = await ephemeralSigningKey();
    const signed = await composeAndSignDesktopConfig({
      DESKTOP_CONFIG_SIGNING_KEY: signingKey,
    });
    // Flip a field the agent cares about — the signature no longer matches.
    const tampered: SignedDesktopConfig = {
      ...signed,
      minimumAgentVersion: "99.0.0",
    };
    expect(await verifyDesktopConfig(publicKeyRaw, tampered)).toBe(false);
  });

  it("stamps the signing key version into the (signed) body", async () => {
    const { signingKey } = await ephemeralSigningKey("v3");
    const env = { DESKTOP_CONFIG_SIGNING_KEY: signingKey };
    expect(signingKeyVersion(env)).toBe("v3");
    const signed = await composeAndSignDesktopConfig(env);
    expect(signed.signingKeyVersion).toBe("v3");
  });

  it("parseSigningKey rejects a missing or malformed key", () => {
    expect(() => parseSigningKey(undefined)).toThrow(/not configured/);
    expect(() => parseSigningKey("no-separator")).toThrow(/v<N>:<base64/);
    expect(() => parseSigningKey("v1:!!!not-base64!!!")).toThrow();
  });

  it("fail-closed: rejects an out-of-range or malformed connector override", () => {
    // A future admin path could supply a connector override — an out-of-range
    // cadence or malformed version must never get SIGNED and trusted.
    const base = { enabled: true, minimumVersion: "1.0.0", pollIntervalSeconds: 30 };
    // pollIntervalSeconds below the floor / above the ceiling / non-integer.
    expect(() =>
      composeDesktopConfig({
        signingKeyVersion: "v1",
        claudeCode: { ...base, pollIntervalSeconds: 0 },
      }),
    ).toThrow(/pollIntervalSeconds/);
    expect(() =>
      composeDesktopConfig({
        signingKeyVersion: "v1",
        claudeCode: { ...base, pollIntervalSeconds: 999_999 },
      }),
    ).toThrow(/pollIntervalSeconds/);
    expect(() =>
      composeDesktopConfig({
        signingKeyVersion: "v1",
        claudeCode: { ...base, pollIntervalSeconds: 30.5 },
      }),
    ).toThrow(/pollIntervalSeconds/);
    // Malformed connector minimumVersion.
    expect(() =>
      composeDesktopConfig({
        signingKeyVersion: "v1",
        claudeCode: { ...base, minimumVersion: "not-a-version" },
      }),
    ).toThrow(/minimumVersion/);
    // Malformed minimumAgentVersion.
    expect(() =>
      composeDesktopConfig({ signingKeyVersion: "v1", minimumAgentVersion: "1.2" }),
    ).toThrow(/minimumAgentVersion/);
    // A valid in-range override is accepted.
    expect(
      composeDesktopConfig({
        signingKeyVersion: "v1",
        claudeCode: { ...base, pollIntervalSeconds: 60 },
      }).connectors.claude_code.pollIntervalSeconds,
    ).toBe(60);
  });
});

describe("desktop-config golden vector (agent byte-parity fixture)", () => {
  const FIXTURE_PATH = "desktop-agent/src-tauri/fixtures/desktop-config-vector.json";

  it("the checked-in vector matches a fresh regeneration (drift guard)", async () => {
    const onDisk = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const regenerated = JSON.parse(
      JSON.stringify(await buildDesktopConfigVector()),
    );
    // If this fails, the config shape / canonicalization / fixed inputs
    // changed — re-run `npx tsx scripts/gen-desktop-config-vector.mts` and
    // ship the agent side against the new bytes.
    expect(onDisk).toEqual(regenerated);
  });

  it("the vector's signature verifies against its own public key over canonicalBytes", async () => {
    const v = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const publicKeyRaw = new Uint8Array(
      atob(v.publicKeyRaw)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
    // Reconstruct the signed object and verify — proves the agent, given only
    // the baked public key + this JSON, can validate it.
    const signed: SignedDesktopConfig = { ...v.config, signature: v.signature };
    expect(await verifyDesktopConfig(publicKeyRaw, signed)).toBe(true);

    // And the canonicalBytes field really is the signed byte layout: decoding
    // it must equal the canonicalization of the config body.
    const decoded = new TextDecoder().decode(
      new Uint8Array(
        atob(v.canonicalBytes)
          .split("")
          .map((c) => c.charCodeAt(0)),
      ),
    );
    expect(decoded).toBe(canonicalizeConfig(v.config));
  });
});

describe("GET /api/desktop/config route", () => {
  let db: Db;
  let orgId: string;
  let connId: string;
  let pausedConnId: string;
  let token: string;
  let pausedToken: string;
  let publicKeyRaw: Uint8Array;

  const req = (bearer?: string) =>
    new Request("http://localhost/api/desktop/config", {
      method: "GET",
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "desktop-config", "personal")).id;
    const scoped = forOrg(db, orgId);

    connId = (
      await scoped.connections.create({
        vendor: "claude_code_local",
        displayName: "My Mac",
        authKind: "device_token",
      })
    ).id;
    const secret = generateAgentSecret();
    await scoped.connections.storeCredential(connId, "device_token", secret, ENV_KEK);
    token = composeAgentToken(orgId, connId, secret);

    // A second device that the operator has revoked (paused → 403).
    pausedConnId = (
      await scoped.connections.create({
        vendor: "claude_code_local",
        displayName: "Old Laptop",
        authKind: "device_token",
      })
    ).id;
    const pausedSecret = generateAgentSecret();
    await scoped.connections.storeCredential(
      pausedConnId,
      "device_token",
      pausedSecret,
      ENV_KEK,
    );
    pausedToken = composeAgentToken(orgId, pausedConnId, pausedSecret);
    // The canonical revoke path (ADR 0013) — pause the device.
    await scoped.connections.update(pausedConnId, { status: "paused" });

    const key = await ephemeralSigningKey();
    publicKeyRaw = key.publicKeyRaw;

    mockDb = db;
    mockEnv = { ...ENV_KEK, DESKTOP_CONFIG_SIGNING_KEY: key.signingKey };
  });

  it("returns 401 without a token", async () => {
    const { GET } = await import("../src/app/api/desktop/config/route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed token", async () => {
    const { GET } = await import("../src/app/api/desktop/config/route");
    const res = await GET(req("rva1.bad.bad.bad"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a revoked (paused) device", async () => {
    const { GET } = await import("../src/app/api/desktop/config/route");
    const res = await GET(req(pausedToken));
    expect(res.status).toBe(403);
  });

  it("returns a signed config that verifies against the public key", async () => {
    const { GET } = await import("../src/app/api/desktop/config/route");
    const res = await GET(req(token));
    expect(res.status).toBe(200);
    const signed = (await res.json()) as SignedDesktopConfig;

    // The response body carries config + signature, and NOTHING per-user
    // (no counts, no ids) — assert the exact key set.
    expect(Object.keys(signed).sort()).toEqual(
      [
        "configurationVersion",
        "connectors",
        "defaultContentMode",
        "emergencyShutdown",
        "expiresAt",
        "issuedAt",
        "minimumAgentVersion",
        "signature",
        "signingKeyVersion",
        "updateChannel",
      ].sort(),
    );
    expect(signed.defaultContentMode).toBe("analytics_only");
    expect(await verifyDesktopConfig(publicKeyRaw, signed)).toBe(true);
  });

  it("fails closed with 500 (never an unsigned 200) when the signing key is unset", async () => {
    const { GET } = await import("../src/app/api/desktop/config/route");
    const withKey = mockEnv;
    // Authenticate succeeds (KEK present) but there is NO signing key.
    mockEnv = { ...ENV_KEK };
    try {
      const res = await GET(req(token));
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      // Must NOT be a config body — no signature, no config fields leaked.
      expect(body).not.toHaveProperty("signature");
      expect(body).not.toHaveProperty("defaultContentMode");
    } finally {
      mockEnv = withKey;
    }
  });
});
