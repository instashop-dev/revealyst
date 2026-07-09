import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthCheckResult,
  Connector,
} from "../src/contracts/connector";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  clearRegistryForTests,
  registerConnector,
} from "../src/connectors/registry";
import type { PollMessage } from "../src/poller/messages";
import {
  ApiError,
  createConnection,
  pollConnection,
  putConnectionCredential,
} from "../src/lib/api-impl";

// W2-H PR2: the onboarding connect write path — create, validate-on-save,
// and enqueue the first backfill + poll — over forOrg, with a fake connector
// and a captured queue producer (no Worker runtime needed).

function testKek(version: string, fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${version}:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek("v1", 1) };

// Mutable so a single fake covers both the accept and reject paths.
let validateResult: AuthCheckResult = { ok: true };
const FAKE_MAX_CALLS_PER_DAY = 4;

const fakeConnector: Connector = {
  vendor: "anthropic_console",
  capabilities: {
    subDaily: "1h",
    attributionCeiling: "person",
    restatementWindowDays: 2,
    maxBackfillDays: 90,
  },
  async validateAuth() {
    return validateResult;
  },
  async discover() {
    return [];
  },
  async poll() {
    return [];
  },
  normalize() {
    return { records: [], signals: [], gaps: [] };
  },
};

let db: Db;
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "connect-org", "personal")).id;
  otherOrgId = (await createFixtureOrg(db, "connect-rival", "personal")).id;

  clearRegistryForTests();
  registerConnector({
    connector: fakeConnector,
    sourceConnector: "fake@1",
    maxCallsPerDay: FAKE_MAX_CALLS_PER_DAY,
    pollIntervalMinutes: 60,
  });
});

afterAll(() => clearRegistryForTests());

describe("createConnection (frozen connectionsCreate)", () => {
  it("creates a pending connection in the contract shape", async () => {
    const { connection } = await createConnection(forOrg(db, orgId), {
      vendor: "anthropic_console",
      displayName: "My Anthropic",
      authKind: "api_key",
    });
    expect(connection.vendor).toBe("anthropic_console");
    expect(connection.status).toBe("pending");
    expect(connection.lastSuccessAt).toBeNull();
  });
});

describe("putConnectionCredential (validate-on-save)", () => {
  // Each test sets validateResult as needed; reset so no test depends on a
  // prior test remembering a trailing reset.
  beforeEach(() => {
    validateResult = { ok: true };
  });

  it("stores and validates a good key, leaving the connection un-errored", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Good key",
      authKind: "api_key",
    });
    const res = await putConnectionCredential(
      scope,
      connection.id,
      { kind: "api_key", value: "sk-good" },
      ENV,
    );
    expect(res).toEqual({ ok: true });
    expect((await scope.connections.get(connection.id))?.status).toBe("pending");
  });

  it("marks the connection errored and 400s on a rejected key", async () => {
    validateResult = { ok: false, reason: "401 invalid api key" };
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Bad key",
      authKind: "api_key",
    });
    const error = await putConnectionCredential(
      scope,
      connection.id,
      { kind: "api_key", value: "sk-bad" },
      ENV,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    const row = await scope.connections.get(connection.id);
    expect(row?.status).toBe("error");
    expect(row?.lastError).toBe("401 invalid api key");
  });

  it("a rejected key on a PAUSED connection 400s but never un-pauses (ADR 0013)", async () => {
    validateResult = { ok: false, reason: "401 invalid api key" };
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Paused, bad key",
      authKind: "api_key",
    });
    await scope.connections.update(connection.id, { status: "paused" });
    const error = await putConnectionCredential(
      scope,
      connection.id,
      { kind: "api_key", value: "sk-bad" },
      ENV,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    // "error" is a dispatch candidate; pause must stick (setStatus guard).
    const row = await scope.connections.get(connection.id);
    expect(row?.status).toBe("paused");
  });

  it("skips validation for a vendor with no shipped connector", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "cursor",
      displayName: "Cursor (unshipped)",
      authKind: "admin_key",
    });
    const res = await putConnectionCredential(
      scope,
      connection.id,
      { kind: "api_key", value: "cur-key" },
      ENV,
    );
    expect(res).toEqual({ ok: true });
    expect((await scope.connections.get(connection.id))?.status).toBe("pending");
  });

  it("stores but does not error/500 when validation is inconclusive (throws)", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Flaky validate",
      authKind: "api_key",
    });
    const original = fakeConnector.validateAuth;
    fakeConnector.validateAuth = async () => {
      throw new Error("ETIMEDOUT talking to vendor");
    };
    try {
      const res = await putConnectionCredential(
        scope,
        connection.id,
        { kind: "api_key", value: "sk-maybe-good" },
        ENV,
      );
      // Transient validation failure must NOT 500 or mark the connection
      // errored — the key is stored and the next poll validates for real.
      expect(res).toEqual({ ok: true });
      expect((await scope.connections.get(connection.id))?.status).toBe(
        "pending",
      );
    } finally {
      fakeConnector.validateAuth = original;
    }
  });

  it("404s an unknown connection", async () => {
    const error = await putConnectionCredential(
      forOrg(db, orgId),
      "00000000-0000-4000-8000-000000000000",
      { kind: "api_key", value: "x" },
      ENV,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it("is org-scoped: another org cannot write this connection's credential", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Owned",
      authKind: "api_key",
    });
    const error = await putConnectionCredential(
      forOrg(db, otherOrgId),
      connection.id,
      { kind: "api_key", value: "x" },
      ENV,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});

describe("pollConnection (frozen connectionsPoll)", () => {
  const NOW = () => new Date("2026-06-15T00:00:00.000Z");

  it("enqueues only a restatement-window poll — never a backfill (cron owns that)", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Fresh",
      authKind: "api_key",
    });
    const sent: PollMessage[] = [];
    const res = await pollConnection(scope, connection.id, {
      send: async (m) => {
        sent.push(m);
      },
      now: NOW,
    });
    expect(res).toEqual({ ok: true });
    // restatementWindowDays = 2. No backfill message: enqueuing one from a
    // request would race the cron dispatcher and fork a duplicate crawl.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "connector-poll",
      orgId,
      connectionId: connection.id,
      window: { start: "2026-06-13", end: "2026-06-15" },
      // On-demand polls chain a score-recompute after the ingest lands so
      // the dashboard shows the fresh sync without waiting for the nightly.
      recompute: true,
    });
  });

  it("is idempotent under repeated calls: only cheap poll messages, no backfill fork", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Double clicked",
      authKind: "api_key",
    });
    const sent: PollMessage[] = [];
    const send = async (m: PollMessage) => {
      sent.push(m);
    };
    await pollConnection(scope, connection.id, { send, now: NOW });
    await pollConnection(scope, connection.id, { send, now: NOW });
    // Two clicks → two (idempotent, bounded) polls, zero backfills.
    expect(sent.map((m) => m.kind)).toEqual([
      "connector-poll",
      "connector-poll",
    ]);
  });

  it("400s a vendor with no shipped connector", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "cursor",
      displayName: "Cursor",
      authKind: "admin_key",
    });
    const error = await pollConnection(scope, connection.id, {
      send: async () => {},
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });

  it("is org-scoped: another org cannot poll this connection", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Owned2",
      authKind: "api_key",
    });
    const error = await pollConnection(forOrg(db, otherOrgId), connection.id, {
      send: async () => {},
      now: NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});
