import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { ensureOrgOfOne, forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for the platform-admin team-workspace unblock. Invokes
// the REAL route handlers (admin/free-band gate, body parse, error mapping, and
// the cross-org write) against a PGlite db. Only the request-context resolvers
// (appContext/getApiContext) and getAuth are mocked — they need the Workers
// runtime. Covers: the admin route's authz matrix (platform admin succeeds;
// non-admin, impersonating, and signed-out all rejected), the switch route's
// membership check + impersonation write-block, and the agent-token route's
// active-org agreement (it must follow the SWITCHED workspace, ADR 0051).

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  session: null as unknown,
  apiCtx: null as unknown,
}));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
  getApiContext: () => h.apiCtx,
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => h.session } }),
}));

import { POST as createWorkspacePOST } from "@/app/api/admin/team-workspaces/route";
import { POST as agentTokenPOST } from "@/app/api/connections/[id]/agent-token/route";
import {
  GET as workspacesGET,
  POST as switchPOST,
} from "@/app/api/org/workspaces/route";
import { switchActiveOrg } from "@/db/org-context";
import { parseAgentToken } from "@/lib/agent-token";
import type { CredentialEnv } from "@/lib/credentials";

let db: Db;
const ADMIN = "twapi-admin";
const PLAIN = "twapi-plain";
let adminPersonalOrgId: string;

function adminCtx(opts: {
  isPlatformAdmin?: boolean;
  impersonating?: boolean;
  userId?: string;
  orgId?: string;
} = {}) {
  const userId = opts.userId ?? ADMIN;
  const orgId = opts.orgId ?? adminPersonalOrgId;
  return {
    env: {},
    db,
    session: {
      session: { impersonatedBy: opts.impersonating ? ADMIN : null },
      user: { id: userId },
    },
    user: { id: userId },
    org: { id: orgId, name: "ctx-org", kind: "personal" as const },
    role: "admin" as const,
    isPlatformAdmin: opts.isPlatformAdmin ?? true,
    scope: forOrg(db, orgId),
  };
}

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [admin] = await db
    .insert(schema.user)
    .values({ id: ADMIN, name: "Admin", email: "admin@tw.example" })
    .returning();
  await db
    .insert(schema.user)
    .values({ id: PLAIN, name: "Plain", email: "plain@tw.example" });
  adminPersonalOrgId = (await ensureOrgOfOne(db, admin)).orgId;
});

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const CRED_ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };

beforeEach(() => {
  h.ctx = adminCtx();
  h.session = null;
  h.apiCtx = { db, env: CRED_ENV };
});

describe("POST /api/admin/team-workspaces", () => {
  it("a platform admin creates a team workspace (kind=team, admin member, default team)", async () => {
    const res = await createWorkspacePOST(
      jsonReq("http://localhost/api/admin/team-workspaces", "POST", {
        name: "Route Team",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgId: string; teamId: string };
    const [org] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, body.orgId));
    expect(org.kind).toBe("team");
    expect(org.bootstrapUserId).toBeNull();
    const [member] = await db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, body.orgId));
    expect(member.userId).toBe(ADMIN);
    expect(member.role).toBe("admin");
    const created = await forOrg(db, body.orgId).teams.list();
    expect(created).toHaveLength(1);
    expect(created[0].id).toBe(body.teamId);
  });

  it("403s a non-platform-admin", async () => {
    h.ctx = adminCtx({ isPlatformAdmin: false });
    const res = await createWorkspacePOST(
      jsonReq("http://localhost/api/admin/team-workspaces", "POST", {
        name: "Nope",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s an impersonating platform-admin session", async () => {
    h.ctx = adminCtx({ impersonating: true });
    const res = await createWorkspacePOST(
      jsonReq("http://localhost/api/admin/team-workspaces", "POST", {
        name: "Nope",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await createWorkspacePOST(
      jsonReq("http://localhost/api/admin/team-workspaces", "POST", {
        name: "Nope",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400s on a blank name", async () => {
    const res = await createWorkspacePOST(
      jsonReq("http://localhost/api/admin/team-workspaces", "POST", {
        name: "   ",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET/POST /api/org/workspaces (switcher)", () => {
  it("lists the caller's workspaces with the active one flagged", async () => {
    h.ctx = adminCtx();
    const res = await workspacesGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activeOrgId: string;
      workspaces: { id: string; name: string; kind: string }[];
    };
    expect(body.activeOrgId).toBe(adminPersonalOrgId);
    expect(body.workspaces.some((w) => w.id === adminPersonalOrgId)).toBe(true);
  });

  it("switches the active workspace for a member", async () => {
    // Give the admin a second (team) workspace to switch into.
    const [teamOrg] = await db
      .insert(schema.orgs)
      .values({ name: "Switch Target", kind: "team" })
      .returning();
    await db
      .insert(schema.orgMembers)
      .values({ orgId: teamOrg.id, userId: ADMIN, role: "admin" });

    h.ctx = adminCtx();
    const res = await switchPOST(
      jsonReq("http://localhost/api/org/workspaces", "POST", {
        orgId: teamOrg.id,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; activeOrgId: string };
    expect(body.ok).toBe(true);
    expect(body.activeOrgId).toBe(teamOrg.id);
  });

  it("404s a switch to an org the caller does not belong to", async () => {
    const [foreign] = await db
      .insert(schema.orgs)
      .values({ name: "Foreign", kind: "team" })
      .returning();
    h.ctx = adminCtx();
    const res = await switchPOST(
      jsonReq("http://localhost/api/org/workspaces", "POST", {
        orgId: foreign.id,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await switchPOST(
      jsonReq("http://localhost/api/org/workspaces", "POST", {
        orgId: adminPersonalOrgId,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403s a switch from an impersonating session (no state persisted for the victim)", async () => {
    h.ctx = adminCtx({ impersonating: true });
    const res = await switchPOST(
      jsonReq("http://localhost/api/org/workspaces", "POST", {
        orgId: adminPersonalOrgId,
      }),
    );
    expect(res.status).toBe(403);
    // The victim's membership was not stamped by the blocked write.
    const [row] = await db
      .select({ lastActiveAt: schema.orgMembers.lastActiveAt })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, adminPersonalOrgId));
    expect(row.lastActiveAt).toBeNull();
  });
});

describe("POST /api/connections/:id/agent-token — active-org agreement (ADR 0051)", () => {
  const PAIR_USER = "twapi-pair";
  let personalOrgId: string;
  let teamOrgId: string;
  let personalConnId: string;
  let teamConnId: string;

  beforeAll(async () => {
    const [pairUser] = await db
      .insert(schema.user)
      .values({ id: PAIR_USER, name: "Pair", email: "pair@tw.example" })
      .returning();
    personalOrgId = (await ensureOrgOfOne(db, pairUser)).orgId;
    const [teamOrg] = await db
      .insert(schema.orgs)
      .values({ name: "Pair Team", kind: "team" })
      .returning();
    teamOrgId = teamOrg.id;
    await db
      .insert(schema.orgMembers)
      .values({ orgId: teamOrgId, userId: PAIR_USER, role: "admin" });
    personalConnId = (
      await forOrg(db, personalOrgId).connections.create({
        vendor: "revealyst_agent",
        displayName: "Personal device",
        authKind: "device_token",
      })
    ).id;
    teamConnId = (
      await forOrg(db, teamOrgId).connections.create({
        vendor: "revealyst_agent",
        displayName: "Team device",
        authKind: "device_token",
      })
    ).id;
  });

  function pair(connectionId: string) {
    return agentTokenPOST(
      jsonReq(
        `http://localhost/api/connections/${connectionId}/agent-token`,
        "POST",
      ),
      { params: Promise.resolve({ id: connectionId }) },
    );
  }

  it("mints tokens against the SWITCHED workspace and 404s the other org's connection", async () => {
    h.session = { user: { id: PAIR_USER } };

    // Active org right now: the team org (newest membership). Its connection
    // pairs, and the token carries the TEAM org id.
    const teamRes = await pair(teamConnId);
    expect(teamRes.status).toBe(200);
    const teamToken = (await teamRes.json()) as { token: string };
    expect(parseAgentToken(teamToken.token)?.orgId).toBe(teamOrgId);
    // The personal org's connection is invisible from the team workspace —
    // fails closed exactly as before.
    expect((await pair(personalConnId)).status).toBe(404);

    // Switch to the personal workspace: the route follows the switch.
    expect(await switchActiveOrg(db, PAIR_USER, personalOrgId)).toBe(true);
    const personalRes = await pair(personalConnId);
    expect(personalRes.status).toBe(200);
    const personalToken = (await personalRes.json()) as { token: string };
    expect(parseAgentToken(personalToken.token)?.orgId).toBe(personalOrgId);
    // And the team connection is now the invisible one.
    expect((await pair(teamConnId)).status).toBe(404);
  });

  it("401s when signed out", async () => {
    h.session = null;
    expect((await pair(teamConnId)).status).toBe(401);
  });
});
