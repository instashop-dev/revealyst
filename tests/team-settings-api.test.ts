import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for PATCH /api/teams/:id/settings (ADR 0045 spend half,
// D-TCI-2). Invokes the REAL route handler (admin gate, body parse, error
// mapping, the org-scoped teamSettings.set + the ADR-0010 audit row) against a
// PGlite-backed db. Only appContext is mocked (it needs the Workers runtime).
// This is the toggle-route authorization matrix: an admin succeeds; a plain
// member AND a (non-admin) manager both get 403; a cross-org / unknown team is
// 404; and an audit row is written on success.

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({ appContext: async () => h.ctx }));

import { PATCH as settingsPATCH } from "@/app/api/teams/[id]/settings/route";

let db: Db;
let orgId: string;
let otherOrgId: string;
let teamId: string;
let otherTeamId: string;
const ADMIN = "ts-admin";
const MEMBER = "ts-member";
const MANAGER = "ts-manager"; // manages the team, still role "member"

function ctxFor(opts: {
  userId: string;
  role?: "admin" | "member";
  org?: string;
}) {
  const org = opts.org ?? orgId;
  return {
    env: {},
    db,
    session: { user: { id: opts.userId } },
    user: { id: opts.userId },
    org: { id: org, kind: "team" as const },
    role: opts.role ?? "admin",
    isPlatformAdmin: false,
    scope: forOrg(db, org),
  };
}

const jsonReq = (body?: unknown) =>
  new Request("http://localhost/api/teams/x/settings", {
    method: "PATCH",
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
    .values({ name: "ts-org", kind: "team" })
    .returning();
  orgId = org.id;
  const [org2] = await db
    .insert(schema.orgs)
    .values({ name: "ts-org-2", kind: "team" })
    .returning();
  otherOrgId = org2.id;
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Admin", email: "admin@ts.example" },
    { id: MEMBER, name: "Member", email: "member@ts.example" },
    { id: MANAGER, name: "Manager", email: "manager@ts.example" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId, userId: ADMIN, role: "admin" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: MANAGER, role: "member" },
  ]);
  teamId = (await forOrg(db, orgId).teams.create("Platform")).id;
  otherTeamId = (await forOrg(db, otherOrgId).teams.create("Foreign")).id;
  await forOrg(db, orgId).teamManagers.assign(teamId, MANAGER);
});

beforeEach(() => {
  h.ctx = ctxFor({ userId: ADMIN });
});

describe("PATCH /api/teams/:id/settings — cost-visibility toggle", () => {
  it("an admin turns the toggle on and an audit row is written", async () => {
    const res = await settingsPATCH(
      jsonReq({ managersSeeIndividualCost: true }),
      params(teamId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ managersSeeIndividualCost: true });
    const settings = await forOrg(db, orgId).teamSettings.get(teamId);
    expect(settings.managersSeeIndividualCost).toBe(true);
    const audit = await forOrg(db, orgId).auditLog.list();
    expect(audit.some((a) => a.action === "team.settings_update")).toBe(true);
  });

  it("an admin can turn it back off (idempotent write path)", async () => {
    await settingsPATCH(jsonReq({ managersSeeIndividualCost: true }), params(teamId));
    const res = await settingsPATCH(
      jsonReq({ managersSeeIndividualCost: false }),
      params(teamId),
    );
    expect(res.status).toBe(200);
    expect((await forOrg(db, orgId).teamSettings.get(teamId)).managersSeeIndividualCost).toBe(false);
  });

  it("a non-admin member gets 403 (no write)", async () => {
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    const res = await settingsPATCH(
      jsonReq({ managersSeeIndividualCost: true }),
      params(teamId),
    );
    expect(res.status).toBe(403);
  });

  it("a (non-admin) manager CANNOT change it — still 403", async () => {
    h.ctx = ctxFor({ userId: MANAGER, role: "member" });
    const res = await settingsPATCH(
      jsonReq({ managersSeeIndividualCost: true }),
      params(teamId),
    );
    expect(res.status).toBe(403);
  });

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await settingsPATCH(
      jsonReq({ managersSeeIndividualCost: true }),
      params(teamId),
    );
    expect(res.status).toBe(401);
  });

  it("404s on a team from another org (cross-org isolation)", async () => {
    // Admin of orgId tries to toggle a team that belongs to otherOrgId.
    const res = await settingsPATCH(
      jsonReq({ managersSeeIndividualCost: true }),
      params(otherTeamId),
    );
    expect(res.status).toBe(404);
  });

  it("400s on a malformed body (missing/!boolean field)", async () => {
    expect((await settingsPATCH(jsonReq({}), params(teamId))).status).toBe(400);
    expect(
      (await settingsPATCH(jsonReq({ managersSeeIndividualCost: "yes" }), params(teamId))).status,
    ).toBe(400);
  });
});
