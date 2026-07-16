import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { ApiError, setTeamManager } from "../src/lib/api-impl";

// D-TCI-3 (ADR 0044): the org-scoped team → manager assignment layer + the
// setTeamManager handler, run against the real generated migrations on PGlite
// (rule 2: fixtures over coupling — no live DB). A manager is an org MEMBER
// (auth user) with ≥1 team_managers row; the Better Auth role stays admin|member.

let db: Db;
let orgA: string;
let orgB: string;
let teamA1: string;
let teamA2: string;
let teamB1: string;
// Auth users. adminA is org A's admin (the actor); memberA is an org A member;
// memberB belongs to org B.
const ADMIN_A = "tm-admin-a";
const MEMBER_A = "tm-member-a";
const OUTSIDER = "tm-outsider"; // a real user, but NOT an org A member
const MEMBER_B = "tm-member-b";

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db.insert(schema.orgs).values({ name: "org-a" }).returning();
  const [b] = await db.insert(schema.orgs).values({ name: "org-b" }).returning();
  orgA = a.id;
  orgB = b.id;

  await db.insert(schema.user).values([
    { id: ADMIN_A, name: "Admin A", email: "admin-a@example.com" },
    { id: MEMBER_A, name: "Member A", email: "member-a@example.com" },
    { id: OUTSIDER, name: "Outsider", email: "outsider@example.com" },
    { id: MEMBER_B, name: "Member B", email: "member-b@example.com" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId: orgA, userId: ADMIN_A, role: "admin" },
    { orgId: orgA, userId: MEMBER_A, role: "member" },
    { orgId: orgB, userId: MEMBER_B, role: "admin" },
  ]);

  teamA1 = (await forOrg(db, orgA).teams.create("Platform")).id;
  teamA2 = (await forOrg(db, orgA).teams.create("Product")).id;
  teamB1 = (await forOrg(db, orgB).teams.create("B Team")).id;
});

describe("teamManagers namespace CRUD", () => {
  it("assigns a manager and reads it back per team", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamManagers.assign(teamA1, MEMBER_A);
    const rows = await scope.teamManagers.listForTeam(teamA1);
    expect(rows.map((r) => r.userId)).toContain(MEMBER_A);
    expect(rows.every((r) => r.teamId === teamA1)).toBe(true);
  });

  it("assign is idempotent (a repeat is a no-op, not a duplicate)", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamManagers.assign(teamA1, MEMBER_A);
    await scope.teamManagers.assign(teamA1, MEMBER_A);
    const rows = await scope.teamManagers.listForTeam(teamA1);
    expect(rows.filter((r) => r.userId === MEMBER_A)).toHaveLength(1);
  });

  it("managedTeamIds returns every team a user manages in this org", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamManagers.assign(teamA1, ADMIN_A);
    await scope.teamManagers.assign(teamA2, ADMIN_A);
    const managed = await scope.teamManagers.managedTeamIds(ADMIN_A);
    expect(new Set(managed)).toEqual(new Set([teamA1, teamA2]));
  });

  it("managedTeamIds is org-scoped (a foreign org sees none of it)", async () => {
    // ADMIN_A manages teams in org A; org B's scope must return nothing for it.
    const managedUnderB = await forOrg(db, orgB).teamManagers.managedTeamIds(
      ADMIN_A,
    );
    expect(managedUnderB).toEqual([]);
  });

  it("managedTeamIds is empty for a non-manager (the isManager=false case)", async () => {
    expect(
      await forOrg(db, orgA).teamManagers.managedTeamIds(OUTSIDER),
    ).toEqual([]);
  });

  it("list() only returns the scope's own org grants", async () => {
    await forOrg(db, orgB).teamManagers.assign(teamB1, MEMBER_B);
    const aList = await forOrg(db, orgA).teamManagers.list();
    expect(aList.every((r) => r.teamId !== teamB1)).toBe(true);
    const bList = await forOrg(db, orgB).teamManagers.list();
    expect(bList.some((r) => r.teamId === teamB1 && r.userId === MEMBER_B)).toBe(
      true,
    );
  });

  it("remove deletes the grant (idempotent)", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamManagers.assign(teamA2, MEMBER_A);
    await scope.teamManagers.remove(teamA2, MEMBER_A);
    expect(
      (await scope.teamManagers.listForTeam(teamA2)).some(
        (r) => r.userId === MEMBER_A,
      ),
    ).toBe(false);
    // No-op on an already-absent grant.
    await expect(
      scope.teamManagers.remove(teamA2, MEMBER_A),
    ).resolves.toBeUndefined();
  });

  it("rejects a team from another org (composite tenant FK)", async () => {
    await expect(
      forOrg(db, orgA).teamManagers.assign(teamB1, MEMBER_A),
    ).rejects.toThrow();
  });

  it("cascade-deletes manager grants when the team is deleted", async () => {
    const victimTeam = (await forOrg(db, orgA).teams.create("Doomed")).id;
    await forOrg(db, orgA).teamManagers.assign(victimTeam, MEMBER_A);
    await db.delete(schema.teams).where(eq(schema.teams.id, victimTeam));
    const rows = await forOrg(db, orgA).teamManagers.list();
    expect(rows.every((r) => r.teamId !== victimTeam)).toBe(true);
  });

  it("cascade-deletes manager grants when the auth user is deleted", async () => {
    const scope = forOrg(db, orgA);
    await db
      .insert(schema.user)
      .values({ id: "tm-temp", name: "Temp", email: "temp@example.com" });
    await db
      .insert(schema.orgMembers)
      .values({ orgId: orgA, userId: "tm-temp", role: "member" });
    await scope.teamManagers.assign(teamA1, "tm-temp");
    await db.delete(schema.user).where(eq(schema.user.id, "tm-temp"));
    expect(
      (await scope.teamManagers.listForTeam(teamA1)).some(
        (r) => r.userId === "tm-temp",
      ),
    ).toBe(false);
  });
});

describe("setTeamManager handler (D-TCI-3, ADR 0044)", () => {
  it("adds a manager and writes an audit entry", async () => {
    const scope = forOrg(db, orgA);
    const res = await setTeamManager(
      { db, scope },
      { teamId: teamA2, userId: MEMBER_A, action: "add", actorUserId: ADMIN_A },
    );
    expect(res).toEqual({ ok: true });
    expect(
      (await scope.teamManagers.listForTeam(teamA2)).some(
        (r) => r.userId === MEMBER_A,
      ),
    ).toBe(true);
    const audit = await scope.auditLog.list();
    expect(
      audit.some(
        (a) => a.action === "team.manager_add" && a.targetId === teamA2,
      ),
    ).toBe(true);
  });

  it("removes a manager and writes an audit entry", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamManagers.assign(teamA2, MEMBER_A);
    const res = await setTeamManager(
      { db, scope },
      {
        teamId: teamA2,
        userId: MEMBER_A,
        action: "remove",
        actorUserId: ADMIN_A,
      },
    );
    expect(res).toEqual({ ok: true });
    const audit = await scope.auditLog.list();
    expect(
      audit.some(
        (a) => a.action === "team.manager_remove" && a.targetId === teamA2,
      ),
    ).toBe(true);
  });

  it("400s when the target user is not a workspace member (no grant written)", async () => {
    const scope = forOrg(db, orgA);
    await expect(
      setTeamManager(
        { db, scope },
        {
          teamId: teamA1,
          userId: OUTSIDER,
          action: "add",
          actorUserId: ADMIN_A,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await scope.teamManagers.listForTeam(teamA1)).some(
        (r) => r.userId === OUTSIDER,
      ),
    ).toBe(false);
  });

  it("404s when the team does not belong to the org (cross-org attempt)", async () => {
    const scope = forOrg(db, orgA);
    await expect(
      setTeamManager(
        { db, scope },
        {
          teamId: teamB1,
          userId: MEMBER_A,
          action: "add",
          actorUserId: ADMIN_A,
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws ApiError (maps to an HTTP status at the route)", async () => {
    const scope = forOrg(db, orgA);
    await expect(
      setTeamManager(
        { db, scope },
        {
          teamId: "00000000-0000-0000-0000-000000000000",
          userId: MEMBER_A,
          action: "add",
          actorUserId: ADMIN_A,
        },
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
