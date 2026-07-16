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
import {
  MAX_LOG_LINES,
  MAX_LOG_LINE_LENGTH,
  recordDesktopDiagnostics,
  scrubLogTail,
  type DiagnosticsLogRecord,
} from "../src/lib/desktop-diagnostics";

// T4.3 (Desktop Agent plan, spec §23.2): the diagnostics SINK. These tests pin
// the invariant-b structural guarantee — the bundle schema has NO field that can
// carry an activity payload, so a content-bearing key is rejected 400 (not
// filtered) — plus device-token auth, the oversized-bundle 413, and the
// server-side log-tail re-scrub.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

/** A minimal valid bundle — counts / versions / states / clean log lines. */
function validBundle(overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: "1.4.2",
    platform: "macos",
    architecture: "arm64",
    connectorStates: [{ id: "claude_code", state: "collecting" }],
    queueCounts: { pending: 3, quarantined: 0 },
    lastSuccessfulSync: "2026-07-16T10:00:00.000Z",
    configVersion: 7,
    policyVersion: "policy-2026-07-01",
    updateState: "up_to_date",
    logTail: ["2026-07-16T10:00:00Z INFO sync completed queueCount=3"],
    ...overrides,
  };
}

describe("recordDesktopDiagnostics (T4.3 sink)", () => {
  let db: Db;
  let orgId: string;
  let deviceConnId: string;
  let deviceSecret: string;
  let deviceToken: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "desktop-diagnostics", "personal")).id;
    const scoped = forOrg(db, orgId);
    deviceConnId = (
      await scoped.connections.create({
        vendor: "claude_code_local",
        displayName: "Desktop Agent device",
        authKind: "device_token",
      })
    ).id;
    deviceSecret = generateAgentSecret();
    await scoped.connections.storeCredential(
      deviceConnId,
      "device_token",
      deviceSecret,
      ENV,
    );
    deviceToken = composeAgentToken(orgId, deviceConnId, deviceSecret);
  });

  /** Capture the emitted structured line instead of writing to Workers Logs. */
  function captureEmit() {
    const records: DiagnosticsLogRecord[] = [];
    return {
      records,
      emit: (record: DiagnosticsLogRecord) => records.push(record),
    };
  }

  // --- Auth --------------------------------------------------------------

  it("rejects a missing/empty device token with 401 (no emit)", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(db, ENV, "", validBundle(), cap.emit);
    expect(out.status).toBe(401);
    expect(cap.records).toHaveLength(0);
  });

  it("rejects a wrong secret with 401 (no emit)", async () => {
    const cap = captureEmit();
    const forged = composeAgentToken(orgId, deviceConnId, generateAgentSecret());
    const out = await recordDesktopDiagnostics(db, ENV, forged, validBundle(), cap.emit);
    expect(out.status).toBe(401);
    expect(cap.records).toHaveLength(0);
  });

  it("rejects a paused (revoked) device with 403 (no emit)", async () => {
    const scoped = forOrg(db, orgId);
    await scoped.connections.update(deviceConnId, { status: "paused" });
    try {
      const cap = captureEmit();
      const out = await recordDesktopDiagnostics(
        db,
        ENV,
        deviceToken,
        validBundle(),
        cap.emit,
      );
      expect(out.status).toBe(403);
      expect(cap.records).toHaveLength(0);
    } finally {
      await scoped.connections.update(deviceConnId, { status: "active" });
    }
  });

  it("rejects a non-device_token vendor with 401", async () => {
    const scoped = forOrg(db, orgId);
    const nonDevice = await scoped.connections.create({
      vendor: "cursor",
      displayName: "Not a device",
      authKind: "device_token",
    });
    const secret = generateAgentSecret();
    await scoped.connections.storeCredential(nonDevice.id, "device_token", secret, ENV);
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      composeAgentToken(orgId, nonDevice.id, secret),
      validBundle(),
      cap.emit,
    );
    expect(out.status).toBe(401);
    expect(cap.records).toHaveLength(0);
  });

  // --- Structural payload impossibility (invariant b) --------------------

  it("rejects a bundle with an `events` payload key → 400 (payloads structurally impossible)", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({ events: [{ prompt: "secret user prompt text" }] }),
      cap.emit,
    );
    expect(out.status).toBe(400);
    // Nothing was emitted — the content-bearing bundle never reached the sink.
    expect(cap.records).toHaveLength(0);
  });

  it("rejects every content-shaped key (`payload`, `prompt`, `response`, `messages`) with 400", async () => {
    for (const key of ["payload", "prompt", "response", "messages", "content"]) {
      const cap = captureEmit();
      const out = await recordDesktopDiagnostics(
        db,
        ENV,
        deviceToken,
        validBundle({ [key]: "any activity content" }),
        cap.emit,
      );
      expect(out.status, `key ${key} must be rejected`).toBe(400);
      expect(cap.records).toHaveLength(0);
    }
  });

  it("rejects a nested unknown key inside connectorStates → 400", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({
        connectorStates: [
          { id: "claude_code", state: "collecting", payload: "sneaky" },
        ],
      }),
      cap.emit,
    );
    expect(out.status).toBe(400);
    expect(cap.records).toHaveLength(0);
  });

  it("rejects an unknown queueCounts key → 400", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({ queueCounts: { pending: 1, quarantined: 0, prompt: "x" } }),
      cap.emit,
    );
    expect(out.status).toBe(400);
    expect(cap.records).toHaveLength(0);
  });

  it("rejects an unknown connector state string → 400", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({ connectorStates: [{ id: "x", state: "exfiltrating" }] }),
      cap.emit,
    );
    expect(out.status).toBe(400);
  });

  // --- Oversized bundle --------------------------------------------------

  it("rejects too many log lines (over MAX_LOG_LINES) → 400", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({ logTail: new Array(MAX_LOG_LINES + 1).fill("ok line") }),
      cap.emit,
    );
    expect(out.status).toBe(400);
  });

  it("rejects an over-length log line (> MAX_LOG_LINE_LENGTH) → 400", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({ logTail: ["z".repeat(MAX_LOG_LINE_LENGTH + 1)] }),
      cap.emit,
    );
    expect(out.status).toBe(400);
  });

  // --- Re-scrub ----------------------------------------------------------

  it("drops a token-shaped log line in the emitted record (defense-in-depth)", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle({
        logTail: [
          "2026-07-16T10:00:00Z INFO clean line queueCount=3",
          `2026-07-16T10:00:01Z DEBUG token=rva1.${orgId}.${deviceConnId}.supersecret`,
          "2026-07-16T10:00:02Z INFO another clean line",
        ],
      }),
      cap.emit,
    );
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, logLinesDropped: 1 });
    expect(cap.records).toHaveLength(1);
    const rec = cap.records[0];
    expect(rec.logLinesDropped).toBe(1);
    expect(rec.logTail).toHaveLength(2);
    // The rva1. secret is nowhere in the emitted record.
    expect(JSON.stringify(rec)).not.toContain("supersecret");
    expect(JSON.stringify(rec)).not.toContain("rva1.");
  });

  // --- Happy path + emitted record shape ---------------------------------

  it("accepts a valid bundle (200) and emits a record with NO payload field", async () => {
    const cap = captureEmit();
    const out = await recordDesktopDiagnostics(
      db,
      ENV,
      deviceToken,
      validBundle(),
      cap.emit,
    );
    expect(out.status).toBe(200);
    expect(cap.records).toHaveLength(1);
    const rec = cap.records[0];
    expect(rec.evt).toBe("desktop.diagnostics");
    expect(rec.orgId).toBe(orgId);
    expect(rec.connectionId).toBe(deviceConnId);
    expect(rec.queueCounts).toEqual({ pending: 3, quarantined: 0 });
    // The emitted record's keys are counts/versions/states/logs ONLY — no
    // payload/events/prompt/response field exists on the record type.
    const forbidden = ["events", "payload", "prompt", "response", "messages", "content"];
    for (const key of forbidden) {
      expect(Object.keys(rec)).not.toContain(key);
    }
  });
});

// --- Pure re-scrub unit tests -------------------------------------------------

describe("scrubLogTail", () => {
  it("drops rva1. tokens, bearer headers, secrets, PEM keys, and content markers", () => {
    const lines = [
      "clean INFO line",
      "token=rva1.aaa.bbb.ccc",
      "Authorization: Bearer abcdef1234567890",
      "api_key=deadbeefdeadbeef",
      "-----BEGIN RSA PRIVATE KEY-----",
      "prompt: what is the meaning of life",
      "response = here is the answer",
      "clean DEBUG queueCount=5",
    ];
    const { kept, dropped } = scrubLogTail(lines);
    expect(dropped).toBe(6);
    expect(kept).toEqual(["clean INFO line", "clean DEBUG queueCount=5"]);
  });

  it("drops long base64/hex-looking blobs", () => {
    const blob = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"; // 40 chars
    const { kept, dropped } = scrubLogTail([`data=${blob}`, "short=abc"]);
    expect(dropped).toBe(1);
    expect(kept).toEqual(["short=abc"]);
  });

  it("keeps ordinary diagnostic lines untouched", () => {
    const lines = [
      "2026-07-16 INFO connector claude_code state=collecting",
      "2026-07-16 WARN retry count=2 code=E_TIMEOUT",
      "queue pending=3 quarantined=0",
    ];
    const { kept, dropped } = scrubLogTail(lines);
    expect(dropped).toBe(0);
    expect(kept).toEqual(lines);
  });
});
