import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { ensureOrgOfOne, forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for the USER-FACING team-workspace creation flow
// (D-ONB-1, POST /api/workspaces). Invokes the REAL route handler (session/
// free-band gate, impersonation guard, body parse, per-user cap, and the shared
// provisioning transaction) against a PGlite db. Only appContext is mocked (it
// needs the Workers runtime). Also pins provisioning PARITY between the admin
// seam (createTeamWorkspace) and the user path (provisionTeamWorkspace), and the
// create → invite → join reachability of the invite flow on a fresh workspace.

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { POST as createWorkspacePOST } from "@/app/api/workspaces/route";
import { createTeamWorkspace } from "@/db/admin";
import { acceptInvite, invitesForOrg, orgMembersList } from "@/db/invites";
import { orgContextForUser } from "@/db/org-context";
import {
  countCreatedTeamWorkspaces,
  MAX_TEAM_WORKSPACES_PER_USER,
  provisionTeamWorkspace,
} from "@/db/org-provisioning";
import { teamWorkspaceCapMessage } from "@/lib/team-onboarding-copy";

let db: Db;
const USER = "wsapi-user";
let userPersonalOrgId: string;

function userCtx(
  opts: { impersonating?: boolean; userId?: string; orgId?: string } = {},
) {
  const userId = opts.userId ?? USER;
  const orgId = opts.orgId ?? userPersonalOrgId;
  return {
    env: {},
    db,
    session: {
      session: { impersonatedBy: opts.impersonating ? "some-admin" : null },
      user: { id: userId },
    },
    user: { id: userId },
    org: { id: orgId, name: "ctx-org", kind: "personal" as const },
    role: "admin" as const,
    scope: forOrg(db, orgId),
  };
}

const jsonReq = (method: string, body?: unknown) =>
  new Request("http://localhost/api/workspaces", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [u] = await db
    .insert(schema.user)
    .values({ id: USER, name: "User", email: "user@ws.example" })
    .returning();
  userPersonalOrgId = (await ensureOrgOfOne(db, u)).orgId;
});

beforeEach(() => {
  h.ctx = userCtx();
});

describe("POST /api/workspaces (user-facing create)", () => {
  it("401s when signed out", async () => {
    h.ctx = null;
    const res = await createWorkspacePOST(jsonReq("POST", { name: "Nope" }));
    expect(res.status).toBe(401);
  });

  it("403s an impersonating session (no persistent org created for the victim)", async () => {
    h.ctx = userCtx({ impersonating: true });
    const res = await createWorkspacePOST(jsonReq("POST", { name: "Nope" }));
    expect(res.status).toBe(403);
  });

  it("400s on a blank name", async () => {
    const res = await createWorkspacePOST(jsonReq("POST", { name: "   " }));
    expect(res.status).toBe(400);
  });

  it("a plain signed-in user creates a team workspace and becomes its admin", async () => {
    const res = await createWorkspacePOST(
      jsonReq("POST", { name: "My New Team" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgId: string; teamId: string };

    // A kind='team' org (nothing else sets this) with the creator as ORG ADMIN.
    const [org] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, body.orgId));
    expect(org.kind).toBe("team");
    expect(org.name).toBe("My New Team");
    expect(org.bootstrapUserId).toBeNull();

    const members = await db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, body.orgId));
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(USER);
    expect(members[0].role).toBe("admin");

    // A default team named after the workspace, and the genesis audit row.
    const teamsList = await forOrg(db, body.orgId).teams.list();
    expect(teamsList).toHaveLength(1);
    expect(teamsList[0].id).toBe(body.teamId);
    const audit = await forOrg(db, body.orgId).auditLog.list();
    const created = audit.find((a) => a.action === "org.create");
    expect(created?.actorUserId).toBe(USER);

    // The creator is derived from the session, NOT the body — a body-supplied
    // creator can't enroll someone else as admin.
    const res2 = await createWorkspacePOST(
      jsonReq("POST", { name: "Mass Assign", creatorUserId: "someone-else" }),
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { orgId: string };
    const m2 = await db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, body2.orgId));
    expect(m2[0].userId).toBe(USER);
  });

  it("enforces the per-user CREATION cap with a plain-English 403 at the limit", async () => {
    const capUser = "wsapi-cap";
    const [u] = await db
      .insert(schema.user)
      .values({ id: capUser, name: "Cap", email: "cap@ws.example" })
      .returning();
    await ensureOrgOfOne(db, u);

    // Create (MAX - 1) team workspaces via the shared provisioning helper
    // directly (it stamps orgs.created_by_user_id, ADR 0052).
    for (let i = 0; i < MAX_TEAM_WORKSPACES_PER_USER - 1; i++) {
      await provisionTeamWorkspace(db, {
        name: `Cap ${i}`,
        creatorUserId: capUser,
      });
    }
    expect(await countCreatedTeamWorkspaces(db, capUser)).toBe(
      MAX_TEAM_WORKSPACES_PER_USER - 1,
    );

    // At (MAX - 1) created, one more is still allowed — reaching MAX.
    h.ctx = userCtx({ userId: capUser });
    const okRes = await createWorkspacePOST(
      jsonReq("POST", { name: "At Limit" }),
    );
    expect(okRes.status).toBe(200);
    expect(await countCreatedTeamWorkspaces(db, capUser)).toBe(
      MAX_TEAM_WORKSPACES_PER_USER,
    );

    // At MAX created, the next create is refused with the exact plain-English
    // cap message (server-owned so UI copy can't drift from the enforced
    // limit), and — being checked inside the provisioning transaction — no
    // partial org row leaked from the refused attempt.
    const capRes = await createWorkspacePOST(
      jsonReq("POST", { name: "Over Limit" }),
    );
    expect(capRes.status).toBe(403);
    const capBody = (await capRes.json()) as { error: string };
    expect(capBody.error).toBe(
      teamWorkspaceCapMessage(MAX_TEAM_WORKSPACES_PER_USER),
    );
    expect(await countCreatedTeamWorkspaces(db, capUser)).toBe(
      MAX_TEAM_WORKSPACES_PER_USER,
    );
    const leaked = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.name, "Over Limit"));
    expect(leaked).toHaveLength(0);
  });

  it("invited-admin memberships do NOT consume the creation cap", async () => {
    const invitedAdmin = "wsapi-invited-admin";
    const owner = "wsapi-owner";
    await db.insert(schema.user).values([
      { id: invitedAdmin, name: "Invited", email: "invited@ws.example" },
      { id: owner, name: "Owner", email: "owner@ws.example" },
    ]);

    // Someone ELSE creates MAX team workspaces and enrolls our user as an
    // ADMIN member of every one of them.
    for (let i = 0; i < MAX_TEAM_WORKSPACES_PER_USER; i++) {
      const { orgId } = await provisionTeamWorkspace(db, {
        name: `Owner Org ${i}`,
        creatorUserId: owner,
      });
      await db
        .insert(schema.orgMembers)
        .values({ orgId, userId: invitedAdmin, role: "admin" });
    }

    // The cap counts CREATION provenance, not admin memberships — the invited
    // admin has created nothing, so their own create still succeeds.
    expect(await countCreatedTeamWorkspaces(db, invitedAdmin)).toBe(0);
    h.ctx = userCtx({ userId: invitedAdmin });
    const res = await createWorkspacePOST(
      jsonReq("POST", { name: "My Own Team" }),
    );
    expect(res.status).toBe(200);
    expect(await countCreatedTeamWorkspaces(db, invitedAdmin)).toBe(1);
  });
});

describe("provisioning parity (admin seam vs user path)", () => {
  it("createTeamWorkspace and provisionTeamWorkspace produce an identical org shape", async () => {
    const a = "parity-admin";
    const b = "parity-user";
    await db.insert(schema.user).values([
      { id: a, name: "A", email: "a@parity.example" },
      { id: b, name: "B", email: "b@parity.example" },
    ]);

    const viaAdmin = await createTeamWorkspace(db, {
      name: "Parity",
      adminUserId: a,
    });
    const viaUser = await provisionTeamWorkspace(db, {
      name: "Parity",
      creatorUserId: b,
    });

    async function shape(orgId: string, creatorId: string) {
      const [org] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, orgId));
      const members = await db
        .select()
        .from(schema.orgMembers)
        .where(eq(schema.orgMembers.orgId, orgId));
      const teamsList = await forOrg(db, orgId).teams.list();
      const audit = await forOrg(db, orgId).auditLog.list();
      const created = audit.find((x) => x.action === "org.create");
      return {
        kind: org.kind,
        name: org.name,
        bootstrapUserIsNull: org.bootstrapUserId === null,
        // Creation provenance (ADR 0052) is stamped on BOTH paths.
        createdByIsCreator: org.createdByUserId === creatorId,
        memberCount: members.length,
        memberIsAdminCreator:
          members[0]?.userId === creatorId && members[0]?.role === "admin",
        teamCount: teamsList.length,
        teamNamedAfterOrg: teamsList[0]?.name === org.name,
        auditActorIsCreator: created?.actorUserId === creatorId,
        auditMetaKind: (created?.metadata as { kind?: string })?.kind,
      };
    }

    const adminShape = await shape(viaAdmin.orgId, a);
    const userShape = await shape(viaUser.orgId, b);
    // Everything except the (deliberately different) creator ids matches.
    expect(userShape).toEqual(adminShape);
    expect(userShape.kind).toBe("team");
    expect(userShape.memberIsAdminCreator).toBe(true);
  });
});

describe("invite flow reachability on a fresh team workspace (create → invite → join)", () => {
  it("the creator can invite someone who then joins and lands in the new workspace", async () => {
    const creator = "reach-creator";
    const invitee = "reach-invitee";
    await db.insert(schema.user).values([
      { id: creator, name: "Creator", email: "creator@reach.example" },
      { id: invitee, name: "Invitee", email: "invitee@reach.example" },
    ]);
    const inviteePersonal = (
      await ensureOrgOfOne(db, {
        id: invitee,
        name: "Invitee",
        email: "invitee@reach.example",
      })
    ).orgId;

    // Creator provisions the team workspace (as the route does).
    const { orgId } = await provisionTeamWorkspace(db, {
      name: "Reachable Team",
      creatorUserId: creator,
    });

    // Admin creates an invite (the same invitesForOrg().create the Settings →
    // People "Invite member" dialog calls). Invites reach people as a copyable
    // link carrying this token — there is no email send.
    const { token } = await invitesForOrg(db, orgId).create(
      "invitee@reach.example",
      "member",
      creator,
    );
    expect(token).toBeTruthy();

    // The invitee redeems the token → becomes a member of the new workspace.
    const result = await acceptInvite(db, token, invitee);
    expect(result.orgId).toBe(orgId);
    expect(result.role).toBe("member");

    const roster = await orgMembersList(db, orgId);
    expect(roster.map((m) => m.userId).sort()).toEqual(
      [creator, invitee].sort(),
    );

    // The fresh membership (newest createdAt) resolves the invitee INTO the team
    // workspace on their next load — reachable without any manual switch.
    const resolved = await orgContextForUser(db, invitee);
    expect(resolved?.org.id).toBe(orgId);
    expect(resolved?.org.id).not.toBe(inviteePersonal);
  });
});
