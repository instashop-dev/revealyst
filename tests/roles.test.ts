import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { ApiError, setPersonRole } from "../src/lib/api-impl";

// W6-B (ADR 0030): the roles reference table + org-scoped person→role
// assignment CRUD, run against the real generated migrations on PGlite (rule 2:
// fixtures over coupling — no live DB).

let db: Db;
let orgA: string;
let orgB: string;
let alice: string;
let bob: string;
let bAlice: string;

async function makePerson(orgId: string, pseudonym: string) {
  const [row] = await db
    .insert(schema.people)
    .values({ orgId, pseudonym })
    .returning();
  return row.id;
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db.insert(schema.orgs).values({ name: "org-a" }).returning();
  const [b] = await db.insert(schema.orgs).values({ name: "org-b" }).returning();
  orgA = a.id;
  orgB = b.id;
  // A real actor so the handler's audit_log.actor_user_id FK is satisfied.
  await db
    .insert(schema.user)
    .values({ id: "w6b-actor", name: "Admin", email: "w6b@example.com" });
  alice = await makePerson(orgA, "alice");
  bob = await makePerson(orgA, "bob");
  bAlice = await makePerson(orgB, "b-alice");
});

describe("roles reference table (seeded)", () => {
  it("is seeded with the engineering role set, active and ordered by sort", async () => {
    const list = await forOrg(db, orgA).roles.list();
    expect(list.length).toBeGreaterThanOrEqual(8);
    // All returned rows are active.
    expect(list.every((r) => r.isActive)).toBe(true);
    // Ordered ascending by sort.
    const sorts = list.map((r) => r.sort);
    expect([...sorts].sort((x, y) => x - y)).toEqual(sorts);
    // The launch set is present.
    const slugs = new Set(list.map((r) => r.slug));
    for (const slug of [
      "backend",
      "frontend",
      "fullstack",
      "mobile",
      "platform",
      "data",
      "ml",
      "sre",
    ]) {
      expect(slugs.has(slug), `missing seeded role ${slug}`).toBe(true);
    }
  });

  it("is global reference data (same rows regardless of org scope)", async () => {
    const aList = await forOrg(db, orgA).roles.list();
    const bList = await forOrg(db, orgB).roles.list();
    expect(bList.map((r) => r.slug)).toEqual(aList.map((r) => r.slug));
  });
});

describe("role assignment CRUD", () => {
  it("assigns a role and reads it back per person", async () => {
    const row = await forOrg(db, orgA).roles.assign({
      personId: alice,
      roleSlug: "backend",
    });
    expect(row.orgId).toBe(orgA);
    expect(row.personId).toBe(alice);
    expect(row.roleSlug).toBe("backend");

    const got = await forOrg(db, orgA).roles.getForPerson(alice);
    expect(got?.roleSlug).toBe("backend");
  });

  it("reassigns (upsert) rather than duplicating — one role per person", async () => {
    await forOrg(db, orgA).roles.assign({ personId: alice, roleSlug: "backend" });
    await forOrg(db, orgA).roles.assign({ personId: alice, roleSlug: "platform" });

    const assignments = await forOrg(db, orgA).roles.assignments();
    const aliceRows = assignments.filter((r) => r.personId === alice);
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0].roleSlug).toBe("platform");
  });

  it("unassign removes the row (idempotent)", async () => {
    await forOrg(db, orgA).roles.assign({ personId: bob, roleSlug: "data" });
    await forOrg(db, orgA).roles.unassign(bob);
    expect(await forOrg(db, orgA).roles.getForPerson(bob)).toBeUndefined();
    // No-op on an already-absent assignment.
    await expect(forOrg(db, orgA).roles.unassign(bob)).resolves.toBeUndefined();
  });

  it("assignments() only returns the scope's own org rows", async () => {
    await forOrg(db, orgB).roles.assign({ personId: bAlice, roleSlug: "frontend" });
    const aAssignments = await forOrg(db, orgA).roles.assignments();
    expect(aAssignments.every((r) => r.personId !== bAlice)).toBe(true);
    const bAssignments = await forOrg(db, orgB).roles.assignments();
    expect(bAssignments.some((r) => r.personId === bAlice)).toBe(true);
  });

  it("rejects an unknown role slug (role FK)", async () => {
    await expect(
      forOrg(db, orgA).roles.assign({ personId: alice, roleSlug: "wizard" }),
    ).rejects.toThrow();
  });

  it("rejects assigning a person from another org (composite tenant FK)", async () => {
    await expect(
      forOrg(db, orgA).roles.assign({ personId: bAlice, roleSlug: "backend" }),
    ).rejects.toThrow();
  });

  it("cascade-deletes a person's assignment when the person is deleted", async () => {
    const victim = await makePerson(orgA, "victim");
    await forOrg(db, orgA).roles.assign({ personId: victim, roleSlug: "sre" });
    await db.delete(schema.people).where(eq(schema.people.id, victim));
    const rows = await forOrg(db, orgA).roles.assignments();
    expect(rows.every((r) => r.personId !== victim)).toBe(true);
  });
});

describe("setPersonRole handler (W6-B, ADR 0030)", () => {
  it("assigns a valid role and writes an audit entry", async () => {
    const p = await makePerson(orgA, "handler-assign");
    const scope = forOrg(db, orgA);
    const res = await setPersonRole(scope, {
      personId: p,
      roleSlug: "frontend",
      actorUserId: "w6b-actor",
    });
    expect(res).toEqual({ ok: true });
    expect((await scope.roles.getForPerson(p))?.roleSlug).toBe("frontend");
    const audit = await scope.auditLog.list();
    expect(
      audit.some(
        (a) => a.action === "person.role_set" && a.targetId === p,
      ),
    ).toBe(true);
  });

  it("null roleSlug unassigns and writes an unset audit entry", async () => {
    const p = await makePerson(orgA, "handler-unassign");
    const scope = forOrg(db, orgA);
    await scope.roles.assign({ personId: p, roleSlug: "data" });
    const res = await setPersonRole(scope, {
      personId: p,
      roleSlug: null,
      actorUserId: "w6b-actor",
    });
    expect(res).toEqual({ ok: true });
    expect(await scope.roles.getForPerson(p)).toBeUndefined();
    const audit = await scope.auditLog.list();
    expect(
      audit.some((a) => a.action === "person.role_unset" && a.targetId === p),
    ).toBe(true);
  });

  it("400s on an unknown role slug (no assignment written)", async () => {
    const p = await makePerson(orgA, "handler-badrole");
    const scope = forOrg(db, orgA);
    await expect(
      setPersonRole(scope, {
        personId: p,
        roleSlug: "wizard",
        actorUserId: "w6b-actor",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await scope.roles.getForPerson(p)).toBeUndefined();
  });

  it("404s when the person does not belong to the org", async () => {
    const scope = forOrg(db, orgA);
    await expect(
      setPersonRole(scope, {
        personId: bAlice,
        roleSlug: "backend",
        actorUserId: "w6b-actor",
      }),
    ).rejects.toMatchObject({ status: 404 });
    // orgB's own assignment for bAlice (set earlier) is untouched — org A's
    // rejected call never reached across the tenant boundary.
    expect((await forOrg(db, orgB).roles.getForPerson(bAlice))?.roleSlug).toBe(
      "frontend",
    );
  });

  it("ApiError is the thrown type (maps to an HTTP status at the route)", async () => {
    const scope = forOrg(db, orgA);
    await expect(
      setPersonRole(scope, {
        personId: "00000000-0000-0000-0000-000000000000",
        roleSlug: "backend",
        actorUserId: "w6b-actor",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
