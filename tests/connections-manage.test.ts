import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";
import {
  ApiError,
  deleteConnection,
  updateConnection,
} from "../src/lib/api-impl";

// ADR 0013: connection management (PATCH rename/pause-resume + DELETE with
// its cascade graph) over forOrg — no Worker runtime needed.

function testKek(version: string, fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${version}:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek("v1", 1) };

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Db;
let scope: ReturnType<typeof forOrg>;
let otherScope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  scope = forOrg(db, (await createFixtureOrg(db, "manage-org", "team")).id);
  otherScope = forOrg(
    db,
    (await createFixtureOrg(db, "manage-rival", "team")).id,
  );
});

async function makeConnection(s: ReturnType<typeof forOrg>, name: string) {
  return s.connections.create({
    vendor: "anthropic_console",
    displayName: name,
    authKind: "api_key",
  });
}

describe("updateConnection (frozen connectionsUpdate, ADR 0013)", () => {
  it("renames through the contract shape", async () => {
    const conn = await makeConnection(scope, "Old name");
    const res = await updateConnection(scope, conn.id, {
      displayName: "New name",
    });
    expect(res.connection).toEqual({
      id: conn.id,
      vendor: "anthropic_console",
      displayName: "New name",
      status: "pending",
      lastSuccessAt: null,
      lastError: null,
    });
  });

  it("pauses and resumes a synced connection, preserving lastError across both (invariant b)", async () => {
    const conn = await makeConnection(scope, "Errored");
    // Sync once (stamps lastSuccessAt), then fail permanently (lastError).
    await scope.connections.markPolled(conn.id, { ok: true });
    await scope.connections.markPolled(conn.id, {
      ok: false,
      error: "429 from vendor",
    });

    const paused = await updateConnection(scope, conn.id, {
      status: "paused",
    });
    expect(paused.connection.status).toBe("paused");
    expect(paused.connection.lastError).toBe("429 from vendor");

    const resumed = await updateConnection(scope, conn.id, {
      status: "active",
    });
    expect(resumed.connection.status).toBe("active");
    // Resume must NOT fabricate a clean state — the next successful poll
    // clears the error via markPolled.
    expect(resumed.connection.lastError).toBe("429 from vendor");
  });

  it("resumes a NEVER-synced connection to pending, not active (invariant b)", async () => {
    const conn = await makeConnection(scope, "Never synced");
    await updateConnection(scope, conn.id, { status: "paused" });
    const resumed = await updateConnection(scope, conn.id, {
      status: "active",
    });
    // No lastSuccessAt → the row must not claim a health it never had.
    expect(resumed.connection.status).toBe("pending");
    expect(resumed.connection.lastSuccessAt).toBeNull();
  });

  it("rejects an empty patch at the contract, and the writer refuses it too", async () => {
    expect(apiRoutes.connectionsUpdate.request.safeParse({}).success).toBe(
      false,
    );
    const conn = await makeConnection(scope, "Untouched");
    await expect(scope.connections.update(conn.id, {})).rejects.toThrowError(
      /at least one field/,
    );
    expect(
      (await scope.connections.get(conn.id))?.displayName,
    ).toBe("Untouched");
  });

  it("404s an unknown id", async () => {
    const error = await updateConnection(scope, UNKNOWN_ID, {
      displayName: "x",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it("404s another org's connection (tenant isolation)", async () => {
    const foreign = await makeConnection(otherScope, "Rival conn");
    const error = await updateConnection(scope, foreign.id, {
      displayName: "hijacked",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect(
      (await otherScope.connections.get(foreign.id))?.displayName,
    ).toBe("Rival conn");
  });

  it("setStatus never touches a paused connection (pause sticks)", async () => {
    const conn = await makeConnection(scope, "Paused stays");
    await scope.connections.update(conn.id, { status: "paused" });
    const row = await scope.connections.setStatus(conn.id, "error", "boom");
    expect(row).toBeUndefined();
    expect((await scope.connections.get(conn.id))?.status).toBe("paused");
  });
});

describe("deleteConnection (frozen connectionsDelete, ADR 0013)", () => {
  it("deletes the connection and its full cascade graph, sparing neighbors", async () => {
    const doomed = await makeConnection(scope, "Doomed");
    const sibling = await makeConnection(scope, "Sibling");
    const foreign = await makeConnection(otherScope, "Rival keeper");

    // Seed the whole dependent graph on both the doomed and the sibling
    // connection so the assertions are non-vacuous in both directions.
    const seedGraph = async (
      s: ReturnType<typeof forOrg>,
      connectionId: string,
      tag: string,
    ) => {
      await s.connections.storeCredential(connectionId, "api_key", "sk-x", ENV);
      const [subject] = await s.subjects.upsertMany(connectionId, [
        { kind: "person", externalId: `${tag}-user`, email: `${tag}@x.com` },
      ]);
      const payload = await s.raw.insert({
        connectionId,
        vendor: "anthropic_console",
        kind: "usage",
        payload: { tag },
      });
      await s.connectorRuns.start({ connectionId, kind: "poll" });
      await s.metrics.upsertRecords([
        {
          subjectId: subject.id,
          metricKey: "prompts",
          day: "2026-07-01",
          connectionId,
          value: 5,
          attribution: "person",
          sourceConnector: "anthropic-console@1",
          rawPayloadId: payload.id,
        },
      ]);
      return subject.id;
    };
    const doomedSubjectId = await seedGraph(scope, doomed.id, "doomed");
    const siblingSubjectId = await seedGraph(scope, sibling.id, "sibling");

    expect(await deleteConnection(scope, doomed.id)).toEqual({ ok: true });

    // Doomed graph is gone — metric_records via the explicit transactional
    // delete (the NO ACTION connection FK blocks the row delete otherwise),
    // everything else via the frozen cascades.
    expect(await scope.connections.get(doomed.id)).toBeUndefined();
    const remaining = {
      credentials: await db
        .select()
        .from(schema.connectionCredentials)
        .where(eq(schema.connectionCredentials.connectionId, doomed.id)),
      subjects: await db
        .select()
        .from(schema.subjects)
        .where(eq(schema.subjects.connectionId, doomed.id)),
      rawPayloads: await db
        .select()
        .from(schema.rawPayloads)
        .where(eq(schema.rawPayloads.connectionId, doomed.id)),
      runs: await db
        .select()
        .from(schema.connectorRuns)
        .where(eq(schema.connectorRuns.connectionId, doomed.id)),
      records: await db
        .select()
        .from(schema.metricRecords)
        .where(eq(schema.metricRecords.subjectId, doomedSubjectId)),
    };
    expect(remaining.credentials).toEqual([]);
    expect(remaining.subjects).toEqual([]);
    expect(remaining.rawPayloads).toEqual([]);
    expect(remaining.runs).toEqual([]);
    expect(remaining.records).toEqual([]);

    // The sibling connection's graph and the other org's connection survive.
    expect(await scope.connections.get(sibling.id)).toBeDefined();
    expect(
      await db
        .select()
        .from(schema.metricRecords)
        .where(eq(schema.metricRecords.subjectId, siblingSubjectId)),
    ).toHaveLength(1);
    expect(await otherScope.connections.get(foreign.id)).toBeDefined();
  });

  it("404s an unknown id", async () => {
    const error = await deleteConnection(scope, UNKNOWN_ID).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it("404s another org's connection and leaves it standing (tenant isolation)", async () => {
    const foreign = await makeConnection(otherScope, "Rival survivor");
    const error = await deleteConnection(scope, foreign.id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect(await otherScope.connections.get(foreign.id)).toBeDefined();
  });
});
