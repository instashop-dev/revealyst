import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { findDesktopPairingByPairingId } from "../src/db/system";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  consentDesktopPairing,
  desktopConnectPayloadSchema,
  desktopPairingStartSchema,
  DESKTOP_PAIRING_TTL_MS,
  exchangeDesktopPairing,
  generateOneTimeCode,
  isStartPayloadFresh,
  sha256Base64Url,
  startDesktopPairing,
  type DesktopConnectPayload,
} from "../src/lib/desktop-pairing";
import { parseAgentToken } from "../src/lib/agent-token";
import { authenticateDeviceToken } from "../src/lib/device-token";

// Desktop Agent T2.2 (ADR 0047): the full PKCE pairing dance against PGlite —
// start (stateless) → consent (org-scoped row) → exchange (CAS + device-token
// mint), plus every refusal path the plan pins: S256 mismatch, code reuse,
// expiry, cross-org, Team-org consent, double-exchange race.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

/** A verifier the tests hold, like the agent would. */
const VERIFIER = "v".repeat(43);
const STATE = "state-1234_abcd";

let db: Db;
let personalOrg: string;
let personalUser: string;
let teamOrg: string;
let teamUser: string;
let otherPersonalOrg: string;
let otherPersonalUser: string;

async function seedUser(id: string): Promise<string> {
  await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@example.com` })
    .onConflictDoNothing();
  return id;
}

/** Runs start + consent for a fresh pairing and returns everything the agent
 * would hold at exchange time. */
async function startAndConsent(opts?: {
  orgId?: string;
  userId?: string;
  orgKind?: string;
  verifier?: string;
}) {
  const verifier = opts?.verifier ?? VERIFIER;
  const challenge = await sha256Base64Url(verifier);
  const started = startDesktopPairing(
    {
      codeChallenge: challenge,
      state: STATE,
      deviceDisplayName: "Test MacBook",
      platform: "macos",
      architecture: "arm64",
      agentVersion: "0.1.0",
      installationId: crypto.randomUUID(),
    },
    "https://app.revealyst.com",
  );
  const url = new URL(started.browserUrl);
  const payload = desktopConnectPayloadSchema.parse(
    Object.fromEntries(url.searchParams.entries()),
  );
  const scope = forOrg(db, opts?.orgId ?? personalOrg);
  const outcome = await consentDesktopPairing(scope, {
    payload,
    userId: opts?.userId ?? personalUser,
    orgKind: opts?.orgKind ?? "personal",
  });
  return { started, payload, outcome, verifier };
}

function codeFrom(outcome: Awaited<ReturnType<typeof startAndConsent>>["outcome"]): string {
  if (!outcome.ok) throw new Error(`consent failed: ${outcome.error}`);
  return new URL(outcome.redirectUrl).searchParams.get("code")!;
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  personalOrg = (await createFixtureOrg(db, "pair-personal", "personal")).id;
  teamOrg = (await createFixtureOrg(db, "pair-team", "team")).id;
  otherPersonalOrg = (await createFixtureOrg(db, "pair-personal-2", "personal")).id;
  personalUser = await seedUser("pair-user-personal");
  teamUser = await seedUser("pair-user-team");
  otherPersonalUser = await seedUser("pair-user-personal-2");
});

describe("start (stateless)", () => {
  it("validates the payload shape strictly", () => {
    const good = {
      codeChallenge: "c".repeat(43),
      state: STATE,
      deviceDisplayName: "MacBook",
      platform: "macos",
      architecture: "arm64",
      agentVersion: "0.1.0",
      installationId: crypto.randomUUID(),
    };
    expect(desktopPairingStartSchema.safeParse(good).success).toBe(true);
    // Challenge outside 43-128 base64url → rejected.
    expect(
      desktopPairingStartSchema.safeParse({ ...good, codeChallenge: "short" })
        .success,
    ).toBe(false);
    expect(
      desktopPairingStartSchema.safeParse({
        ...good,
        codeChallenge: "c".repeat(43) + "!",
      }).success,
    ).toBe(false);
    expect(
      desktopPairingStartSchema.safeParse({ ...good, platform: "linux" })
        .success,
    ).toBe(false);
    expect(
      desktopPairingStartSchema.safeParse({ ...good, installationId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("mints a browser URL whose params round-trip through the consent schema", async () => {
    const { started, payload } = await startAndConsent();
    expect(started.pairingId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new URL(started.browserUrl).pathname).toBe("/desktop/connect");
    expect(payload.pairing).toBe(started.pairingId);
    expect(payload.state).toBe(STATE);
    expect(payload.name).toBe("Test MacBook");
  });

  it("writes no rows — the pairing row exists only after consent", async () => {
    const started = startDesktopPairing(
      {
        codeChallenge: "c".repeat(43),
        state: STATE,
        deviceDisplayName: "Unconsented",
        platform: "windows",
        architecture: "x64",
        agentVersion: "0.1.0",
        installationId: crypto.randomUUID(),
      },
      "https://app.revealyst.com",
    );
    expect(await findDesktopPairingByPairingId(db, started.pairingId)).toBeUndefined();
  });

  it("start-payload freshness: fresh within 10 minutes, stale after", () => {
    const now = Date.now();
    expect(isStartPayloadFresh(now, now)).toBe(true);
    expect(isStartPayloadFresh(now - DESKTOP_PAIRING_TTL_MS + 1_000, now)).toBe(true);
    expect(isStartPayloadFresh(now - DESKTOP_PAIRING_TTL_MS - 1_000, now)).toBe(false);
    // Far-future issued timestamps are rejected too (beyond clock skew).
    expect(isStartPayloadFresh(now + 10 * 60_000, now)).toBe(false);
  });
});

describe("consent", () => {
  it("refuses a Team org with no row written (D-DA-2)", async () => {
    const { started, outcome } = await startAndConsent({
      orgId: teamOrg,
      userId: teamUser,
      orgKind: "team",
    });
    expect(outcome).toEqual({ ok: false, error: "team_org" });
    expect(await findDesktopPairingByPairingId(db, started.pairingId)).toBeUndefined();
  });

  it("refuses a stale pairing link", async () => {
    const challenge = await sha256Base64Url(VERIFIER);
    const payload: DesktopConnectPayload = {
      pairing: "A".repeat(22),
      challenge,
      state: STATE,
      name: "Old link",
      platform: "macos",
      arch: "arm64",
      version: "0.1.0",
      installation: crypto.randomUUID(),
      issued: Date.now() - DESKTOP_PAIRING_TTL_MS - 60_000,
    };
    const outcome = await consentDesktopPairing(forOrg(db, personalOrg), {
      payload,
      userId: personalUser,
      orgKind: "personal",
    });
    expect(outcome).toEqual({ ok: false, error: "expired" });
  });

  it("creates the row bound to the SESSION user, stores only hashes, audits", async () => {
    const { started, outcome } = await startAndConsent();
    expect(outcome.ok).toBe(true);
    const code = codeFrom(outcome);
    const row = await findDesktopPairingByPairingId(db, started.pairingId);
    expect(row).toBeDefined();
    expect(row!.orgId).toBe(personalOrg);
    expect(row!.consentedUserId).toBe(personalUser);
    // The one-time code is never stored — only its SHA-256.
    expect(row!.codeHash).toBe(await sha256Base64Url(code));
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row!.usedAt).toBeNull();
    expect(row!.connectionId).toBeNull();
    // ≤10-minute TTL.
    expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + DESKTOP_PAIRING_TTL_MS + 1_000,
    );
    // Audit row exists and never carries the code or its hash.
    const audits = await forOrg(db, personalOrg).auditLog.list();
    const consent = audits.find((a) => a.action === "desktop.pairing_consent");
    expect(consent).toBeDefined();
    expect(consent!.actorUserId).toBe(personalUser);
    expect(JSON.stringify(consent)).not.toContain(code);
    expect(JSON.stringify(consent)).not.toContain(row!.codeHash);
  });

  it("replaying the consent form for the same handle refuses (already_used)", async () => {
    const { payload, outcome } = await startAndConsent();
    expect(outcome.ok).toBe(true);
    const replay = await consentDesktopPairing(forOrg(db, personalOrg), {
      payload,
      userId: personalUser,
      orgKind: "personal",
    });
    expect(replay).toEqual({ ok: false, error: "already_used" });
  });

  it("opportunistically reclaims this org's expired rows on the next consent", async () => {
    // Seed an already-expired row for the org directly, then run a fresh
    // consent — the bounded DELETE in the consent path must have removed it.
    const staleHandle = "STALE".repeat(4) + "ab"; // 22 base64url chars
    await forOrg(db, personalOrg).desktopPairing.create({
      pairingId: staleHandle,
      codeChallenge: "c".repeat(43),
      codeHash: "h".repeat(43),
      consentedUserId: personalUser,
      deviceDisplayName: "Stale device",
      platform: "macos",
      architecture: "arm64",
      agentVersion: "0.1.0",
      installationId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(
      await findDesktopPairingByPairingId(db, staleHandle),
    ).toBeDefined();

    const { outcome } = await startAndConsent();
    expect(outcome.ok).toBe(true);
    // The expired row is gone; a live, unexpired row is untouched.
    expect(
      await findDesktopPairingByPairingId(db, staleHandle),
    ).toBeUndefined();
  });

  it("does not reclaim another org's expired rows", async () => {
    const otherStale = "OTHER".repeat(4) + "cd"; // 22 base64url chars
    await forOrg(db, otherPersonalOrg).desktopPairing.create({
      pairingId: otherStale,
      codeChallenge: "c".repeat(43),
      codeHash: "h".repeat(43),
      consentedUserId: otherPersonalUser,
      deviceDisplayName: "Other org stale",
      platform: "windows",
      architecture: "x64",
      agentVersion: "0.1.0",
      installationId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() - 60_000),
    });
    // A consent in personalOrg must not touch otherPersonalOrg's rows.
    const { outcome } = await startAndConsent();
    expect(outcome.ok).toBe(true);
    expect(
      await findDesktopPairingByPairingId(db, otherStale),
    ).toBeDefined();
  });

  it("echoes the agent's state untouched in the redirect", async () => {
    const { outcome } = await startAndConsent();
    if (!outcome.ok) throw new Error("consent failed");
    const url = new URL(outcome.redirectUrl);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      "revealyst://desktop-auth/callback",
    );
    expect(url.searchParams.get("state")).toBe(STATE);
  });
});

describe("exchange", () => {
  it("happy path: mints the device connection and a token that authenticates", async () => {
    const { started, outcome, verifier } = await startAndConsent();
    const code = codeFrom(outcome);
    const result = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code,
      codeVerifier: verifier,
    });
    expect(result.status).toBe(200);
    const token = result.body.token as string;
    const deviceId = result.body.deviceId as string;
    expect(result.body.orgId).toBe(personalOrg);
    expect(parseAgentToken(token)).not.toBeNull();

    // The token round-trips through the LIVE device-token verifier (the same
    // auth /v1/metrics and agent-ingest use) — end-to-end proof.
    const auth = await authenticateDeviceToken(db, ENV, token);
    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.orgId).toBe(personalOrg);
      expect(auth.connectionId).toBe(deviceId);
    }

    // The device connection reuses the EXISTING vendor/authKind values and
    // records self-ownership in config.
    const connection = await forOrg(db, personalOrg).connections.get(deviceId);
    expect(connection.vendor).toBe("claude_code_local");
    expect(connection.authKind).toBe("device_token");
    expect(connection.displayName).toBe("Test MacBook");
    expect((connection.config as Record<string, unknown>).pairedByUserId).toBe(
      personalUser,
    );

    // Pairing row is stamped used + linked; the token appears nowhere in the
    // database (only the envelope-encrypted secret exists).
    const row = await findDesktopPairingByPairingId(db, started.pairingId);
    expect(row!.usedAt).not.toBeNull();
    expect(row!.connectionId).toBe(deviceId);
    const secret = parseAgentToken(token)!.secret;
    const [credential] = await db
      .select()
      .from(schema.connectionCredentials)
      .where(eq(schema.connectionCredentials.connectionId, deviceId));
    expect(JSON.stringify(credential)).not.toContain(secret);

    // Exchange audit row: actor honestly null, consenting user in metadata.
    const audits = await forOrg(db, personalOrg).auditLog.list();
    const minted = audits.find(
      (a) => a.action === "desktop.pairing_exchange" && a.targetId === deviceId,
    );
    expect(minted).toBeDefined();
    expect(minted!.actorUserId).toBeNull();
    expect(
      (minted!.metadata as Record<string, unknown>).consentedUserId,
    ).toBe(personalUser);
    expect(JSON.stringify(minted)).not.toContain(secret);
  });

  it("unknown pairing handle → 404", async () => {
    const result = await exchangeDesktopPairing(db, ENV, {
      pairingId: "Z".repeat(22),
      code: generateOneTimeCode(),
      codeVerifier: VERIFIER,
    });
    expect(result.status).toBe(404);
  });

  it("S256 verifier mismatch → 400, code NOT burned", async () => {
    const { started, outcome, verifier } = await startAndConsent();
    const code = codeFrom(outcome);
    const bad = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code,
      codeVerifier: "w".repeat(43),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("code verifier mismatch");
    // The rightful holder can still complete.
    const good = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code,
      codeVerifier: verifier,
    });
    expect(good.status).toBe(200);
  });

  it("wrong code → 400", async () => {
    const { started, verifier } = await startAndConsent();
    const result = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code: generateOneTimeCode(),
      codeVerifier: verifier,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid code");
  });

  it("code reuse → 400 and no second connection", async () => {
    const { started, outcome, verifier } = await startAndConsent();
    const code = codeFrom(outcome);
    const first = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code,
      codeVerifier: verifier,
    });
    expect(first.status).toBe(200);
    const before = (await forOrg(db, personalOrg).connections.list()).length;
    const second = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code,
      codeVerifier: verifier,
    });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("code already used");
    expect(second.body.token).toBeUndefined();
    expect((await forOrg(db, personalOrg).connections.list()).length).toBe(before);
  });

  it("expired code → 400", async () => {
    const { started, outcome, verifier } = await startAndConsent();
    const code = codeFrom(outcome);
    // Direct row update — the injected-clock equivalent.
    await db
      .update(schema.desktopPairingCodes)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.desktopPairingCodes.pairingId, started.pairingId));
    const result = await exchangeDesktopPairing(db, ENV, {
      pairingId: started.pairingId,
      code,
      codeVerifier: verifier,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("code expired");
  });

  it("cross-org: org A's code with org B's pairing handle → 400, no token", async () => {
    const a = await startAndConsent();
    const b = await startAndConsent({
      orgId: otherPersonalOrg,
      userId: otherPersonalUser,
    });
    const aCode = codeFrom(a.outcome);
    const result = await exchangeDesktopPairing(db, ENV, {
      pairingId: b.started.pairingId,
      code: aCode,
      codeVerifier: a.verifier,
    });
    // B's row exists (handle known) but A's code can never hash-match it —
    // no token is minted for EITHER org.
    expect(result.status).toBe(400);
    expect(result.body.token).toBeUndefined();
    const bRow = await findDesktopPairingByPairingId(db, b.started.pairingId);
    expect(bRow!.usedAt).toBeNull();
    expect(bRow!.connectionId).toBeNull();
  });

  it("double-exchange race: exactly one of two concurrent exchanges wins", async () => {
    const { started, outcome, verifier } = await startAndConsent();
    const code = codeFrom(outcome);
    const body = { pairingId: started.pairingId, code, codeVerifier: verifier };
    const [r1, r2] = await Promise.all([
      exchangeDesktopPairing(db, ENV, body),
      exchangeDesktopPairing(db, ENV, body),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 400]);
    const winner = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 200 ? r2 : r1;
    expect(winner.body.token).toBeDefined();
    expect(loser.body.token).toBeUndefined();
    // Exactly ONE device connection was minted for this pairing.
    const row = await findDesktopPairingByPairingId(db, started.pairingId);
    const devices = (await forOrg(db, personalOrg).connections.list()).filter(
      (c) => c.id === row!.connectionId,
    );
    expect(devices).toHaveLength(1);
  });

  it("self-owned minting is structural: consent carries no target-user input", async () => {
    // The consent surface takes the SESSION user only — there is no request
    // field by which a member could name someone else, so "minting a device
    // for another user" is unrepresentable rather than 403'd. Pin that shape:
    // the payload schema has no user field, and the row owner is the caller.
    const fields = Object.keys(desktopConnectPayloadSchema.shape);
    expect(fields).not.toContain("userId");
    expect(fields).not.toContain("user");
    expect(fields).not.toContain("consentedUserId");
    const { started } = await startAndConsent({
      userId: otherPersonalUser,
      orgId: otherPersonalOrg,
    });
    const row = await findDesktopPairingByPairingId(db, started.pairingId);
    expect(row!.consentedUserId).toBe(otherPersonalUser);
  });
});
