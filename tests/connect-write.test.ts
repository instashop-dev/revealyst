import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { addDays, chunkDaysFor } from "../src/poller/backfill";
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
  it("stores and validates a good key, leaving the connection un-errored", async () => {
    validateResult = { ok: true };
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
    validateResult = { ok: true };
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

  it("enqueues the first backfill chain-start + a poll", async () => {
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

    const backfill = sent.find((m) => m.kind === "connector-backfill");
    const poll = sent.find((m) => m.kind === "connector-poll");
    expect(backfill).toMatchObject({
      orgId,
      connectionId: connection.id,
      window: { start: addDays("2026-06-15", -89), end: "2026-06-15" },
      cursorStart: addDays("2026-06-15", -89),
      chunkDays: chunkDaysFor(FAKE_MAX_CALLS_PER_DAY),
    });
    // restatementWindowDays = 2.
    expect(poll).toMatchObject({
      orgId,
      connectionId: connection.id,
      window: { start: "2026-06-13", end: "2026-06-15" },
    });
  });

  it("does not re-start backfill once a backfill run exists", async () => {
    const scope = forOrg(db, orgId);
    const { connection } = await createConnection(scope, {
      vendor: "anthropic_console",
      displayName: "Backfilled",
      authKind: "api_key",
    });
    await scope.connectorRuns.start({
      connectionId: connection.id,
      kind: "backfill",
    });
    const sent: PollMessage[] = [];
    await pollConnection(scope, connection.id, {
      send: async (m) => {
        sent.push(m);
      },
      now: NOW,
    });
    expect(sent.map((m) => m.kind)).toEqual(["connector-poll"]);
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
