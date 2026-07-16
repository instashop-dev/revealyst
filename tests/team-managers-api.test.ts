import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for /api/teams/:id/managers (D-TCI-3, ADR 0044). Invokes
// the REAL route handlers (admin gate, body parse, error mapping, and the
// org-scoped write + ADR-0010 audit row) against a PGlite-backed db. Only the
// request-context resolver (appContext) is mocked — it needs the Workers
// runtime. This is the manager-vs-member authorization matrix: an admin
// succeeds; a plain member AND a (non-admin) manager both get 403, because a
// manager is still Better Auth role "member".

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { DELETE as managersDELETE, POST as managersPOST } from "@/app/api/teams/[id]/managers/route";

let db: Db;
let orgId: string;
let teamId: string;
const ADMIN = "api-admin";
const MEMBER = "api-member";
const MANAGER = "api-manager"; // a member who manages a team — still role "member"

function ctxFor(opts: { userId: string; role?: "admin" | "member" }) {
  return {
    env: {},
    db,
    session: { user: { id: opts.userId } },
    user: { id: opts.userId },
    org: { id: orgId, kind: "team" as const },
    role: opts.role ?? "admin",
    isPlatformAdmin: false,
    scope: forOrg(db, orgId),
  };
}

const jsonReq = (method: string, body?: unknown) =>
  new Request("http://localhost/api/teams/x/managers", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "api-org", kind: "team" })
    .returning();
  orgId = org.id;
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Admin", email: "admin@api.example" },
    { id: MEMBER, name: "Member", email: "member@api.example" },
    { id: MANAGER, name: "Manager", email: "manager@api.example" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId, userId: ADMIN, role: "admin" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: MANAGER, role: "member" },
  ]);
  teamId = (await forOrg(db, orgId).teams.create("Platform")).id;
  // MANAGER already manages the team — proving a manager still can't assign.
  await forOrg(db, orgId).teamManagers.assign(teamId, MANAGER);
});

beforeEach(() => {
  h.ctx = ctxFor({ userId: ADMIN });
});

describe("POST /api/teams/:id/managers (assign)", () => {
  it("an admin assigns a member as manager and an audit row is written", async () => {
    const res = await managersPOST(jsonReq("POST", { userId: MEMBER }), params(teamId));
    expect(res.status).toBe(200);
    const managers = await forOrg(db, orgId).teamManagers.listForTeam(teamId);
    expect(managers.some((m) => m.userId === MEMBER)).toBe(true);
    const audit = await forOrg(db, orgId).auditLog.list();
    expect(audit.some((a) => a.action === "team.manager_add")).toBe(true);
  });

  it("a non-admin member gets 403 (no grant written)", async () => {
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    const res = await managersPOST(jsonReq("POST", { userId: MEMBER }), params(teamId));
    expect(res.status).toBe(403);
  });

  it("a (non-admin) manager CANNOT assign managers — still 403", async () => {
    // MANAGER manages the team but holds Better Auth role "member": the admin
    // gate rejects them exactly like any other member.
    h.ctx = ctxFor({ userId: MANAGER, role: "member" });
    const res = await managersPOST(jsonReq("POST", { userId: MEMBER }), params(teamId));
    expect(res.status).toBe(403);
  });

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await managersPOST(jsonReq("POST", { userId: MEMBER }), params(teamId));
    expect(res.status).toBe(401);
  });

  it("400s on a non-member target user id", async () => {
    const res = await managersPOST(jsonReq("POST", { userId: "nobody" }), params(teamId));
    expect(res.status).toBe(400);
  });

  it("400s on a malformed body (missing userId)", async () => {
    const res = await managersPOST(jsonReq("POST", {}), params(teamId));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/teams/:id/managers (remove)", () => {
  it("an admin removes a manager", async () => {
    await forOrg(db, orgId).teamManagers.assign(teamId, MEMBER);
    const res = await managersDELETE(jsonReq("DELETE", { userId: MEMBER }), params(teamId));
    expect(res.status).toBe(200);
    const managers = await forOrg(db, orgId).teamManagers.listForTeam(teamId);
    expect(managers.some((m) => m.userId === MEMBER)).toBe(false);
  });

  it("a non-admin member gets 403 on remove", async () => {
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    const res = await managersDELETE(jsonReq("DELETE", { userId: MANAGER }), params(teamId));
    expect(res.status).toBe(403);
  });
});
