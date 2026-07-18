import { describe, expect, it } from "vitest";
import {
  DESKTOP_ACCESS_TOKEN_AUDIENCE,
  DESKTOP_ACCESS_TOKEN_ISSUER,
  type DesktopAccessTokenEnv,
  signDesktopAccessToken,
  verifyDesktopAccessToken,
} from "../src/lib/desktop-access-token";

// T7.2 (Desktop Agent M7), ADR 0058: short-lived HMAC-SHA256 access tokens.
// These pin the pure sign/verify contract: a fresh token verifies to its bound
// (org, connection); ANY tampering, wrong issuer/audience, expiry, wrong key,
// or algorithm swap rejects; a missing key is benign (returns false, never
// throws); and a token minted under the previous key still verifies during a
// rotation window.

/** Deterministic 32-byte test key, base64. Never a real secret. */
function testKey(fill: number, version = "v1"): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${version}:${btoa(binary)}`;
}

const ENV: DesktopAccessTokenEnv = {
  DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testKey(9),
};

const ORG = "11111111-1111-4111-8111-111111111111";
const CONN = "22222222-2222-4222-8222-222222222222";

describe("desktop access token: sign + verify round-trip", () => {
  it("verifies a fresh token to its bound org + connection", async () => {
    const { token, expiresInSeconds } = await signDesktopAccessToken(ENV, {
      orgId: ORG,
      connectionId: CONN,
    });
    expect(expiresInSeconds).toBe(15 * 60);
    const result = await verifyDesktopAccessToken(ENV, token);
    expect(result).toEqual({ ok: true, orgId: ORG, connectionId: CONN });
  });

  it("produces a 3-segment JWT with an HS256 header carrying the key version", async () => {
    const { token } = await signDesktopAccessToken(ENV, {
      orgId: ORG,
      connectionId: CONN,
    });
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    expect(header).toMatchObject({ alg: "HS256", typ: "JWT", kid: "v1" });
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    expect(payload.iss).toBe(DESKTOP_ACCESS_TOKEN_ISSUER);
    expect(payload.aud).toBe(DESKTOP_ACCESS_TOKEN_AUDIENCE);
    expect(payload.sub).toBe(CONN);
    expect(payload.org).toBe(ORG);
  });
});

describe("desktop access token: rejection (forge/replay/tamper)", () => {
  it("rejects a token signed with a different key", async () => {
    const { token } = await signDesktopAccessToken(
      { DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testKey(1) },
      { orgId: ORG, connectionId: CONN },
    );
    expect(await verifyDesktopAccessToken(ENV, token)).toEqual({ ok: false });
  });

  it("rejects a tampered payload (org swapped) — the signature no longer covers it", async () => {
    const { token } = await signDesktopAccessToken(ENV, {
      orgId: ORG,
      connectionId: CONN,
    });
    const [h, , s] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        iss: DESKTOP_ACCESS_TOKEN_ISSUER,
        aud: DESKTOP_ACCESS_TOKEN_AUDIENCE,
        sub: CONN,
        org: "99999999-9999-4999-8999-999999999999",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
      "utf8",
    ).toString("base64url");
    expect(
      await verifyDesktopAccessToken(ENV, `${h}.${forgedPayload}.${s}`),
    ).toEqual({ ok: false });
  });

  it("rejects an expired token", async () => {
    const past = Date.now() - 60 * 60 * 1000; // minted an hour ago
    const { token } = await signDesktopAccessToken(ENV, {
      orgId: ORG,
      connectionId: CONN,
      now: past,
      ttlSeconds: 60, // expired 59 minutes ago
    });
    expect(await verifyDesktopAccessToken(ENV, token)).toEqual({ ok: false });
  });

  it("rejects an alg=none / alg-confusion token even with a valid-looking body", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
      "utf8",
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: DESKTOP_ACCESS_TOKEN_ISSUER,
        aud: DESKTOP_ACCESS_TOKEN_AUDIENCE,
        sub: CONN,
        org: ORG,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
      "utf8",
    ).toString("base64url");
    // No signature, and the header asks for "none".
    expect(await verifyDesktopAccessToken(ENV, `${header}.${payload}.`)).toEqual(
      { ok: false },
    );
  });

  it("rejects a token whose audience is not the desktop API", async () => {
    // Hand-mint a token with a foreign audience under the real key.
    const key = testKey(9);
    const secret = Uint8Array.from(
      Buffer.from(key.slice(key.indexOf(":") + 1), "base64"),
    );
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const b64u = (o: unknown) =>
      Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
    const signingInput = `${b64u({ alg: "HS256", typ: "JWT", kid: "v1" })}.${b64u(
      {
        iss: DESKTOP_ACCESS_TOKEN_ISSUER,
        aud: "some-other-audience",
        sub: CONN,
        org: ORG,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      },
    )}`;
    const sig = Buffer.from(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(signingInput),
      ),
    ).toString("base64url");
    expect(
      await verifyDesktopAccessToken(ENV, `${signingInput}.${sig}`),
    ).toEqual({ ok: false });
  });

  it("rejects garbage / non-JWT strings without throwing", async () => {
    for (const bad of ["", "not-a-token", "a.b", "a.b.c.d", "rva1.x.y.z"]) {
      expect(await verifyDesktopAccessToken(ENV, bad)).toEqual({ ok: false });
    }
  });

  it("returns benign false (never throws) when no signing key is configured", async () => {
    const { token } = await signDesktopAccessToken(ENV, {
      orgId: ORG,
      connectionId: CONN,
    });
    expect(await verifyDesktopAccessToken({}, token)).toEqual({ ok: false });
  });

  it("throws on ISSUANCE when the signing key is absent (fail closed)", async () => {
    await expect(
      signDesktopAccessToken({}, { orgId: ORG, connectionId: CONN }),
    ).rejects.toThrow(/not configured/);
  });
});

describe("desktop access token: key rotation", () => {
  it("verifies a token minted under the PREVIOUS key during a rotation window", async () => {
    // Minted under v1; server has since rotated so v1 is now PREVIOUS.
    const { token } = await signDesktopAccessToken(
      { DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testKey(9, "v1") },
      { orgId: ORG, connectionId: CONN },
    );
    const rotated: DesktopAccessTokenEnv = {
      DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testKey(5, "v2"),
      DESKTOP_ACCESS_TOKEN_SIGNING_KEY_PREVIOUS: testKey(9, "v1"),
    };
    expect(await verifyDesktopAccessToken(rotated, token)).toEqual({
      ok: true,
      orgId: ORG,
      connectionId: CONN,
    });
  });

  it("rejects a token once its key is fully retired (no longer current or previous)", async () => {
    const { token } = await signDesktopAccessToken(
      { DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testKey(9, "v1") },
      { orgId: ORG, connectionId: CONN },
    );
    const fullyRotated: DesktopAccessTokenEnv = {
      DESKTOP_ACCESS_TOKEN_SIGNING_KEY: testKey(5, "v2"),
      DESKTOP_ACCESS_TOKEN_SIGNING_KEY_PREVIOUS: testKey(3, "v1b"),
    };
    expect(await verifyDesktopAccessToken(fullyRotated, token)).toEqual({
      ok: false,
    });
  });
});
