import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createTeamWorkspace } from "../src/db/admin";
import { leaveOrg, removeOrgMember } from "../src/db/membership";
import { orgContextForUser } from "../src/db/org-context";
import { ensureOrgOfOne, forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// P7 — the LEAVE (self-service) + admin REMOVE membership paths. Two layers:
// the pure src/db/membership.ts guard matrix + cascade over PGlite, and the real
// route handlers (impersonation / admin / free-band gates) with only appContext
// mocked (the workspaces-api.test.ts harness pattern).

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { POST as leavePOST } from "@/app/api/org/leave/route";
import { DELETE as removeDELETE } from "@/app/api/org/members/[userId]/route";

let db: Db;
let seq = 0;
/** Fresh user id + row — every test seeds its own so nothing cross-contaminates. */
async function mkUser(tag: string): Promise<string> {
  const id = `${tag}-${seq++}`;
  await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@mem.example` })
    .returning();
  return id;
}
async function addMember(orgId: string, userId: string, role: "admin" | "member") {
  await db.insert(schema.orgMembers).values({ orgId, userId, role });
}
async function membershipExists(orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: schema.orgMembers.userId })
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.orgId, orgId),
        eq(schema.orgMembers.userId, userId),
      ),
    );
  return rows.length > 0;
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("leaveOrg (self-service)", () => {
  it("refuses leaving a personal (bootstrap) org — the identity anchor", async () => {
    const u = await mkUser("leave-personal");
    const { orgId } = await ensureOrgOfOne(db, {
      id: u,
      name: u,
      email: `${u}@mem.example`,
    });
    const outcome = await leaveOrg(db, { userId: u, orgId });
    expect(outcome).toEqual({ ok: false, reason: "personal_org" });
    expect(await membershipExists(orgId, u)).toBe(true);
  });

  it("refuses the sole admin of a team org (would orphan it)", async () => {
    const admin = await mkUser("leave-sole");
    const { orgId } = await createTeamWorkspace(db, {
      name: "Sole",
      adminUserId: admin,
    });
    const outcome = await leaveOrg(db, { userId: admin, orgId });
    expect(outcome).toEqual({ ok: false, reason: "last_admin" });
    expect(await membershipExists(orgId, admin)).toBe(true);
  });

  it("refuses a non-member (route maps this to 404, no probe)", async () => {
    const admin = await mkUser("leave-nm-admin");
    const stranger = await mkUser("leave-nm-stranger");
    const { orgId } = await createTeamWorkspace(db, {
      name: "NM",
      adminUserId: admin,
    });
    expect(await leaveOrg(db, { userId: stranger, orgId })).toEqual({
      ok: false,
      reason: "not_member",
    });
  });

  it("an admin may leave when another admin remains", async () => {
    const a1 = await mkUser("leave-a1");
    const a2 = await mkUser("leave-a2");
    const { orgId } = await createTeamWorkspace(db, {
      name: "TwoAdmins",
      adminUserId: a1,
    });
    await addMember(orgId, a2, "admin");
    expect(await leaveOrg(db, { userId: a2, orgId })).toEqual({ ok: true });
    expect(await membershipExists(orgId, a2)).toBe(false);
    // a1 is still an admin — the org is not orphaned.
    expect(await membershipExists(orgId, a1)).toBe(true);
  });

  it("a member leaves: membership + manager grant + THEIR notes gone, others' kept, audit written, active org falls back", async () => {
    const admin = await mkUser("leave-cascade-admin");
    const member = await mkUser("leave-cascade-member");
    const { orgId, teamId } = await createTeamWorkspace(db, {
      name: "Cascade",
      adminUserId: admin,
    });
    // The member also has a personal org (their fallback landing spot).
    const personal = await ensureOrgOfOne(db, {
      id: member,
      name: member,
      email: `${member}@mem.example`,
    });
    await addMember(orgId, member, "member");
    // Grant the member a manager role on the team + author a note; the admin
    // authors a second note about the same person.
    await db.insert(schema.teamManagers).values({ orgId, teamId, userId: member });
    const person = await forOrg(db, orgId).people.create({ displayName: "Pat" });
    await db.insert(schema.managerNotes).values([
      { orgId, personId: person.id, authorUserId: member, body: "member note" },
      { orgId, personId: person.id, authorUserId: admin, body: "admin note" },
    ]);
    // The member was active in the team org (so we can prove the fallback moves).
    await db
      .update(schema.orgMembers)
      .set({ lastActiveAt: new Date() })
      .where(
        and(
          eq(schema.orgMembers.orgId, orgId),
          eq(schema.orgMembers.userId, member),
        ),
      );
    expect((await orgContextForUser(db, member))?.org.id).toBe(orgId);

    expect(await leaveOrg(db, { userId: member, orgId })).toEqual({ ok: true });

    // Membership gone.
    expect(await membershipExists(orgId, member)).toBe(false);
    // Manager grant gone.
    const grants = await db
      .select()
      .from(schema.teamManagers)
      .where(
        and(
          eq(schema.teamManagers.orgId, orgId),
          eq(schema.teamManagers.userId, member),
        ),
      );
    expect(grants).toHaveLength(0);
    // Their authored note gone; the admin's note about the same person kept.
    const notes = await db
      .select({ author: schema.managerNotes.authorUserId })
      .from(schema.managerNotes)
      .where(eq(schema.managerNotes.orgId, orgId));
    expect(notes.map((n) => n.author)).toEqual([admin]);
    // Audit row written for the leave, attributed to and targeting the leaver.
    const audit = await forOrg(db, orgId).auditLog.list();
    const leaveRow = audit.find((a) => a.action === "org.member_leave");
    expect(leaveRow?.actorUserId).toBe(member);
    expect(leaveRow?.targetId).toBe(member);
    // Active-org resolution falls back to the surviving personal membership.
    expect((await orgContextForUser(db, member))?.org.id).toBe(personal.orgId);
  });
});

describe("removeOrgMember (admin remove)", () => {
  it("refuses removing yourself (use leave instead)", async () => {
    const admin = await mkUser("rm-self");
    const { orgId } = await createTeamWorkspace(db, {
      name: "Self",
      adminUserId: admin,
    });
    expect(
      await removeOrgMember(db, {
        orgId,
        targetUserId: admin,
        actorUserId: admin,
      }),
    ).toEqual({ ok: false, reason: "self" });
    expect(await membershipExists(orgId, admin)).toBe(true);
  });

  it("refuses a target who is not a member of THIS org (cross-org guard → 404)", async () => {
    const adminA = await mkUser("rm-x-a");
    const memberB = await mkUser("rm-x-b");
    const { orgId: orgA } = await createTeamWorkspace(db, {
      name: "OrgA",
      adminUserId: adminA,
    });
    const { orgId: orgB } = await createTeamWorkspace(db, {
      name: "OrgB",
      adminUserId: memberB,
    });
    // memberB belongs only to org B; admin of org A cannot reach them.
    expect(
      await removeOrgMember(db, {
        orgId: orgA,
        targetUserId: memberB,
        actorUserId: adminA,
      }),
    ).toEqual({ ok: false, reason: "not_member" });
    // org B membership untouched.
    expect(await membershipExists(orgB, memberB)).toBe(true);
  });

  it("refuses removing the workspace owner (bootstrap identity anchor)", async () => {
    const owner = await mkUser("rm-owner");
    const coAdmin = await mkUser("rm-owner-co");
    const personal = await ensureOrgOfOne(db, {
      id: owner,
      name: owner,
      email: `${owner}@mem.example`,
    });
    // A second admin in the personal org, so last_admin doesn't mask the owner
    // guard — the owner is still unevictable.
    await addMember(personal.orgId, coAdmin, "admin");
    expect(
      await removeOrgMember(db, {
        orgId: personal.orgId,
        targetUserId: owner,
        actorUserId: coAdmin,
      }),
    ).toEqual({ ok: false, reason: "owner" });
    expect(await membershipExists(personal.orgId, owner)).toBe(true);
  });

  it("refuses removing the sole admin (would orphan the org)", async () => {
    const admin = await mkUser("rm-last-admin");
    const member = await mkUser("rm-last-member");
    const { orgId } = await createTeamWorkspace(db, {
      name: "LastAdmin",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    // The guard itself: target is the only admin, actor is someone else.
    expect(
      await removeOrgMember(db, {
        orgId,
        targetUserId: admin,
        actorUserId: member,
      }),
    ).toEqual({ ok: false, reason: "last_admin" });
    expect(await membershipExists(orgId, admin)).toBe(true);
  });

  it("an admin removes a member: membership + grant + THEIR notes gone, audit written", async () => {
    const admin = await mkUser("rm-happy-admin");
    const member = await mkUser("rm-happy-member");
    const { orgId, teamId } = await createTeamWorkspace(db, {
      name: "RemoveHappy",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    await db.insert(schema.teamManagers).values({ orgId, teamId, userId: member });
    const person = await forOrg(db, orgId).people.create({ displayName: "Q" });
    await db
      .insert(schema.managerNotes)
      .values({ orgId, personId: person.id, authorUserId: member, body: "n" });

    expect(
      await removeOrgMember(db, {
        orgId,
        targetUserId: member,
        actorUserId: admin,
      }),
    ).toEqual({ ok: true });

    expect(await membershipExists(orgId, member)).toBe(false);
    const grants = await db
      .select()
      .from(schema.teamManagers)
      .where(
        and(
          eq(schema.teamManagers.orgId, orgId),
          eq(schema.teamManagers.userId, member),
        ),
      );
    expect(grants).toHaveLength(0);
    const notes = await db
      .select()
      .from(schema.managerNotes)
      .where(eq(schema.managerNotes.orgId, orgId));
    expect(notes).toHaveLength(0);
    const audit = await forOrg(db, orgId).auditLog.list();
    const row = audit.find((a) => a.action === "org.member_remove");
    expect(row?.actorUserId).toBe(admin);
    expect(row?.targetId).toBe(member);
  });
});

// ── Route handlers (real handleApi gates; only appContext mocked) ──────────
function ctxFor(opts: {
  userId: string;
  orgId: string;
  role?: "admin" | "member";
  kind?: "personal" | "team";
  impersonating?: boolean;
}) {
  const { userId, orgId, role = "admin", kind = "team", impersonating } = opts;
  return {
    env: {},
    db,
    session: {
      session: { impersonatedBy: impersonating ? "some-admin" : null },
      user: { id: userId },
    },
    user: { id: userId },
    org: { id: orgId, name: "ctx-org", kind },
    role,
    scope: forOrg(db, orgId),
  };
}
const removeReq = (userId: string) => ({
  params: Promise.resolve({ userId }),
});

beforeEach(() => {
  h.ctx = null;
});

describe("POST /api/org/leave (route)", () => {
  it("401s when signed out", async () => {
    h.ctx = null;
    expect((await leavePOST()).status).toBe(401);
  });

  it("403s an impersonating session", async () => {
    const admin = await mkUser("route-leave-imp");
    const member = await mkUser("route-leave-imp-m");
    const { orgId } = await createTeamWorkspace(db, {
      name: "ImpLeave",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    h.ctx = ctxFor({ userId: member, orgId, role: "member", impersonating: true });
    expect((await leavePOST()).status).toBe(403);
    // Nothing removed.
    expect(await membershipExists(orgId, member)).toBe(true);
  });

  it("400s (plain message) when the active org is the personal one", async () => {
    const u = await mkUser("route-leave-personal");
    const { orgId } = await ensureOrgOfOne(db, {
      id: u,
      name: u,
      email: `${u}@mem.example`,
    });
    h.ctx = ctxFor({ userId: u, orgId, role: "admin", kind: "personal" });
    const res = await leavePOST();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /personal workspace/i,
    );
  });

  it("200s and removes the caller's membership from the active team org", async () => {
    const admin = await mkUser("route-leave-admin");
    const member = await mkUser("route-leave-member");
    const { orgId } = await createTeamWorkspace(db, {
      name: "LeaveOk",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    h.ctx = ctxFor({ userId: member, orgId, role: "member" });
    expect((await leavePOST()).status).toBe(200);
    expect(await membershipExists(orgId, member)).toBe(false);
  });
});

describe("DELETE /api/org/members/:userId (route)", () => {
  it("401s when signed out", async () => {
    h.ctx = null;
    expect((await removeDELETE({} as Request, removeReq("x"))).status).toBe(401);
  });

  it("403s a non-admin caller (adminOnly)", async () => {
    const admin = await mkUser("route-rm-nonadmin-a");
    const member = await mkUser("route-rm-nonadmin-m");
    const other = await mkUser("route-rm-nonadmin-o");
    const { orgId } = await createTeamWorkspace(db, {
      name: "NonAdmin",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    await addMember(orgId, other, "member");
    h.ctx = ctxFor({ userId: member, orgId, role: "member" });
    expect((await removeDELETE({} as Request, removeReq(other))).status).toBe(403);
    expect(await membershipExists(orgId, other)).toBe(true);
  });

  it("403s an impersonating admin", async () => {
    const admin = await mkUser("route-rm-imp-a");
    const member = await mkUser("route-rm-imp-m");
    const { orgId } = await createTeamWorkspace(db, {
      name: "ImpRemove",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    h.ctx = ctxFor({ userId: admin, orgId, role: "admin", impersonating: true });
    expect((await removeDELETE({} as Request, removeReq(member))).status).toBe(403);
    expect(await membershipExists(orgId, member)).toBe(true);
  });

  it("400s (plain message) when an admin targets themselves", async () => {
    const admin = await mkUser("route-rm-self");
    const { orgId } = await createTeamWorkspace(db, {
      name: "SelfRoute",
      adminUserId: admin,
    });
    // Add a second admin so this isn't refused as last_admin first.
    const admin2 = await mkUser("route-rm-self2");
    await addMember(orgId, admin2, "admin");
    h.ctx = ctxFor({ userId: admin, orgId, role: "admin" });
    const res = await removeDELETE({} as Request, removeReq(admin));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Leave/i);
  });

  it("404s when the target is not a member of the caller's org", async () => {
    const adminA = await mkUser("route-rm-x-a");
    const memberB = await mkUser("route-rm-x-b");
    const { orgId: orgA } = await createTeamWorkspace(db, {
      name: "RouteOrgA",
      adminUserId: adminA,
    });
    await createTeamWorkspace(db, { name: "RouteOrgB", adminUserId: memberB });
    h.ctx = ctxFor({ userId: adminA, orgId: orgA, role: "admin" });
    expect(
      (await removeDELETE({} as Request, removeReq(memberB))).status,
    ).toBe(404);
  });

  it("200s and removes the target member", async () => {
    const admin = await mkUser("route-rm-ok-a");
    const member = await mkUser("route-rm-ok-m");
    const { orgId } = await createTeamWorkspace(db, {
      name: "RemoveOk",
      adminUserId: admin,
    });
    await addMember(orgId, member, "member");
    h.ctx = ctxFor({ userId: admin, orgId, role: "admin" });
    expect((await removeDELETE({} as Request, removeReq(member))).status).toBe(200);
    expect(await membershipExists(orgId, member)).toBe(false);
  });
});
