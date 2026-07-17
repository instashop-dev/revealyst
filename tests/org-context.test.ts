import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import {
  membershipsForUser,
  orgContextForSessionToken,
  orgContextForUser,
  switchActiveOrg,
} from "../src/db/org-context";
import { createTeamWorkspace } from "../src/db/admin";
import { ensureOrgOfOne, membershipForUser } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { sessionTokenFromCookieHeader } from "../src/lib/session-cookie";

let db: Db;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("orgContextForUser (the /api/me data source)", () => {
  it("returns undefined for a user with no membership", async () => {
    expect(await orgContextForUser(db, "nobody")).toBeUndefined();
  });

  it("serves the frozen /api/me response shape", async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ id: "me-user", name: "Mel", email: "mel@example.com" })
      .returning();
    await ensureOrgOfOne(db, user);

    const ctx = await orgContextForUser(db, user.id);
    expect(ctx).toBeDefined();

    // The whole point of this helper: its output + userId must satisfy the
    // frozen contract, including org kind and visibility mode.
    const body = apiRoutes.me.response.parse({
      userId: user.id,
      org: ctx!.org,
      role: ctx!.role,
    });
    expect(body.org.kind).toBe("personal");
    expect(body.org.visibilityMode).toBe("private"); // §7 default
    expect(body.role).toBe("admin");
  });

  it("resolves the same org as membershipForUser (same ordering rule)", async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ id: "same-org", name: "Sam", email: "sam@example.com" })
      .returning();
    await ensureOrgOfOne(db, user);

    const membership = await membershipForUser(db, user.id);
    const ctx = await orgContextForUser(db, user.id);
    expect(ctx!.org.id).toBe(membership.orgId);
    expect(ctx!.role).toBe(membership.role);
  });
});

describe("orgContextForSessionToken (appContext's speculative prefetch)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function seedUserWithSession(id: string, expiresAt: Date) {
    const [user] = await db
      .insert(schema.user)
      .values({ id, name: id, email: `${id}@example.com` })
      .returning();
    await ensureOrgOfOne(db, user);
    const token = `tok-${id}`;
    await db.insert(schema.session).values({
      id: `sess-${id}`,
      token,
      userId: user.id,
      expiresAt,
    });
    return { user, token };
  }

  it("resolves the SAME context as orgContextForUser, plus the owning userId", async () => {
    const { user, token } = await seedUserWithSession(
      "spec-user",
      new Date(Date.now() + DAY_MS),
    );
    const byToken = await orgContextForSessionToken(db, token);
    const byUser = await orgContextForUser(db, user.id);
    expect(byToken).toBeDefined();
    // The userId is what appContext verifies against the AUTHENTICATED
    // session before using this result — the whole safety contract.
    expect(byToken!.userId).toBe(user.id);
    expect(byToken!.org).toEqual(byUser!.org);
    expect(byToken!.role).toBe(byUser!.role);
  });

  it("returns undefined for an expired session token", async () => {
    const { token } = await seedUserWithSession(
      "spec-expired",
      new Date(Date.now() - DAY_MS),
    );
    expect(await orgContextForSessionToken(db, token)).toBeUndefined();
  });

  it("returns undefined for an unknown token", async () => {
    expect(await orgContextForSessionToken(db, "no-such-token")).toBeUndefined();
  });
});

describe("membershipsForUser + switchActiveOrg (workspace switcher)", () => {
  it("lists every workspace newest-first, excluding the system org", async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ id: "multi-ws", name: "Mo", email: "mo@example.com" })
      .returning();
    await ensureOrgOfOne(db, user); // personal org
    const { orgId: teamOrgId } = await createTeamWorkspace(db, {
      name: "Mo's Team",
      adminUserId: user.id,
    });
    // A system-org membership must never surface as a switchable workspace.
    // (Seeded with an OLD createdAt — real users never hold one, and this keeps
    // it from perturbing the most-recent-membership resolution below.)
    const [sys] = await db
      .insert(schema.orgs)
      .values({ name: "System", kind: "system" })
      .returning();
    await db.insert(schema.orgMembers).values({
      orgId: sys.id,
      userId: user.id,
      role: "member",
      createdAt: new Date("2000-01-01T00:00:00Z"),
    });

    const workspaces = await membershipsForUser(db, user.id);
    const ids = workspaces.map((w) => w.orgId);
    expect(ids).not.toContain(sys.id);
    expect(ids).toContain(teamOrgId);
    // The team workspace was created last → its membership is most-recent →
    // it is the active org and sorts first (ADR 0004).
    expect(workspaces[0].orgId).toBe(teamOrgId);
    expect(workspaces[0].orgKind).toBe("team");
    // And it is exactly what orgContextForUser resolves as active.
    const active = await orgContextForUser(db, user.id);
    expect(active!.org.id).toBe(teamOrgId);
  });

  it("switches the active org by bumping the chosen membership to most-recent", async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ id: "switcher", name: "Switch", email: "sw@example.com" })
      .returning();
    const personal = await ensureOrgOfOne(db, user);
    const { orgId: teamOrgId } = await createTeamWorkspace(db, {
      name: "Switch Team",
      adminUserId: user.id,
    });
    // After creation the team org is active (most-recent).
    expect((await orgContextForUser(db, user.id))!.org.id).toBe(teamOrgId);

    // Switch back to personal.
    const ok = await switchActiveOrg(db, user.id, personal.orgId);
    expect(ok).toBe(true);
    expect((await orgContextForUser(db, user.id))!.org.id).toBe(personal.orgId);

    // Switch forward again to the team org.
    expect(await switchActiveOrg(db, user.id, teamOrgId)).toBe(true);
    expect((await orgContextForUser(db, user.id))!.org.id).toBe(teamOrgId);
  });

  it("never rewrites created_at — the rendered 'Joined' date stays truthful (ADR 0051)", async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ id: "join-date", name: "JD", email: "jd@example.com" })
      .returning();
    const personal = await ensureOrgOfOne(db, user);
    const { orgId: teamOrgId } = await createTeamWorkspace(db, {
      name: "JD Team",
      adminUserId: user.id,
    });

    const joinDates = async () =>
      db
        .select({
          orgId: schema.orgMembers.orgId,
          createdAt: schema.orgMembers.createdAt,
          lastActiveAt: schema.orgMembers.lastActiveAt,
        })
        .from(schema.orgMembers)
        .where(eq(schema.orgMembers.userId, user.id))
        .orderBy(schema.orgMembers.orgId);

    const before = await joinDates();
    // Switch twice (back to personal, forward to team) — the exact sequence
    // that under the old createdAt-bump design rewrote both join dates.
    expect(await switchActiveOrg(db, user.id, personal.orgId)).toBe(true);
    expect(await switchActiveOrg(db, user.id, teamOrgId)).toBe(true);
    const after = await joinDates();

    // created_at byte-identical on every membership; only last_active_at moved.
    expect(after.map((r) => [r.orgId, r.createdAt.toISOString()])).toEqual(
      before.map((r) => [r.orgId, r.createdAt.toISOString()]),
    );
    const teamRow = after.find((r) => r.orgId === teamOrgId);
    expect(teamRow?.lastActiveAt).not.toBeNull();
    // And the team org is active via the coalesce rank, not a createdAt edit.
    expect((await orgContextForUser(db, user.id))!.org.id).toBe(teamOrgId);
  });

  it("fails closed for an org the user is not a member of (no probe)", async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ id: "no-member", name: "NM", email: "nm@example.com" })
      .returning();
    await ensureOrgOfOne(db, user);
    // A real org the user does NOT belong to.
    const [foreign] = await db
      .insert(schema.orgs)
      .values({ name: "Foreign", kind: "team" })
      .returning();
    expect(await switchActiveOrg(db, user.id, foreign.id)).toBe(false);
    // A totally unknown org id — same false, so existence isn't leaked.
    expect(
      await switchActiveOrg(db, user.id, "00000000-0000-0000-0000-000000000000"),
    ).toBe(false);
  });
});

describe("sessionTokenFromCookieHeader", () => {
  it("extracts the raw token (first dot segment) from either cookie name", () => {
    expect(
      sessionTokenFromCookieHeader("better-auth.session_token=abc123.sigpart"),
    ).toBe("abc123");
    expect(
      sessionTokenFromCookieHeader(
        "theme=dark; __Secure-better-auth.session_token=xyz.%2Bsig%3D; other=1",
      ),
    ).toBe("xyz");
  });

  it("returns null when absent, empty, or undecodable", () => {
    expect(sessionTokenFromCookieHeader(null)).toBeNull();
    expect(sessionTokenFromCookieHeader("theme=dark")).toBeNull();
    expect(sessionTokenFromCookieHeader("better-auth.session_token=")).toBeNull();
    expect(
      sessionTokenFromCookieHeader("better-auth.session_token=%E0%A4%A"),
    ).toBeNull();
  });
});
