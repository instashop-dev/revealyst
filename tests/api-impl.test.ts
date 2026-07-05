import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  ApiError,
  createTeam,
  listConnections,
  listPeople,
  listTeams,
  putTeamMembers,
} from "../src/lib/api-impl";

let db: Db;
let scope: ReturnType<typeof forOrg>;
let otherScope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "Acme", kind: "team" })
    .returning();
  const [otherOrg] = await db
    .insert(schema.orgs)
    .values({ name: "Rival", kind: "team" })
    .returning();
  scope = forOrg(db, org.id);
  otherScope = forOrg(db, otherOrg.id);
});

describe("teams routes (frozen teamsList/teamsCreate/teamsPutMembers)", () => {
  it("lists no teams as an empty contract-valid payload", async () => {
    expect(await listTeams(scope)).toEqual({ teams: [] });
  });

  it("creates a team and counts members through the contract shape", async () => {
    const created = await createTeam(scope, "Core Engineering");
    expect(created.name).toBe("Core Engineering");

    const alice = await scope.people.create({ displayName: "Alice" });
    const bob = await scope.people.create({ displayName: "Bob" });
    await putTeamMembers(scope, created.id, [alice.id, bob.id]);

    const { teams } = await listTeams(scope);
    expect(teams).toEqual([
      { id: created.id, name: "Core Engineering", memberCount: 2 },
    ]);
  });

  it("PUT replaces the member set exactly", async () => {
    const team = await createTeam(scope, "Replaceable");
    const p1 = await scope.people.create({});
    const p2 = await scope.people.create({});
    await putTeamMembers(scope, team.id, [p1.id, p2.id]);
    await putTeamMembers(scope, team.id, [p1.id]);
    const { teams } = await listTeams(scope);
    expect(teams.find((t) => t.id === team.id)?.memberCount).toBe(1);
  });

  it("404s an unknown team", async () => {
    await expect(
      putTeamMembers(scope, "00000000-0000-4000-8000-000000000000", []),
    ).rejects.toThrowError(ApiError);
  });

  it("400s a person from another org (tenant isolation)", async () => {
    const team = await createTeam(scope, "Isolated");
    const foreign = await otherScope.people.create({});
    const error = await putTeamMembers(scope, team.id, [foreign.id]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });
});

describe("people route (frozen peopleList, §7 privacy by shape)", () => {
  it("nulls displayName in private mode and keeps it otherwise", async () => {
    const named = await scope.people.create({ displayName: "Carol Named" });

    const privatePayload = await listPeople(scope, "private");
    const privateCarol = privatePayload.people.find((p) => p.id === named.id);
    expect(privateCarol?.displayName).toBeNull();
    expect(privateCarol?.pseudonym).toBeTruthy();

    const fullPayload = await listPeople(scope, "full");
    const fullCarol = fullPayload.people.find((p) => p.id === named.id);
    expect(fullCarol?.displayName).toBe("Carol Named");
  });

  it("never leaks emails — the strict personRef shape rejects extras", async () => {
    await scope.people.create({ email: "secret@example.com" });
    const payload = await listPeople(scope, "full");
    for (const person of payload.people) {
      expect(Object.keys(person).sort()).toEqual([
        "displayName",
        "id",
        "pseudonym",
      ]);
    }
  });
});

describe("connections route (frozen connectionsList)", () => {
  it("maps rows to the contract shape, honest about never-synced state", async () => {
    const connection = await scope.connections.create({
      vendor: "anthropic_console",
      displayName: "Anthropic prod",
      authKind: "api_key",
    });
    const payload = await listConnections(scope);
    const row = payload.connections.find((c) => c.id === connection.id);
    expect(row).toEqual({
      id: connection.id,
      vendor: "anthropic_console",
      displayName: "Anthropic prod",
      status: "pending",
      lastSuccessAt: null,
      lastError: null,
    });
  });

  it("surfaces error status with its message", async () => {
    const connection = await scope.connections.create({
      vendor: "openai",
      displayName: "OpenAI org",
      authKind: "admin_key",
    });
    await scope.connections.setStatus(connection.id, "error", "401 from vendor");
    const payload = await listConnections(scope);
    const row = payload.connections.find((c) => c.id === connection.id);
    expect(row?.status).toBe("error");
    expect(row?.lastError).toBe("401 from vendor");
  });
});
