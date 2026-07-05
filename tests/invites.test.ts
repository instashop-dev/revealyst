import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  acceptInvite,
  InviteError,
  invitesForOrg,
  orgMembersList,
  previewInvite,
} from "../src/db/invites";
import { orgContextForUser } from "../src/db/org-context";
import { ensureOrgOfOne, membershipForUser } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

let db: Db;
let teamOrgId: string;
let adminUserId: string;

async function makeUser(id: string, name: string, email: string) {
  const [row] = await db
    .insert(schema.user)
    .values({ id, name, email })
    .returning();
  return row;
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const admin = await makeUser("admin-1", "Founder", "founder@example.com");
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "Acme", kind: "team" })
    .returning();
  teamOrgId = org.id;
  adminUserId = admin.id;
  await db
    .insert(schema.orgMembers)
    .values({ orgId: teamOrgId, userId: adminUserId, role: "admin" });
});

describe("invite lifecycle (ADR 0004)", () => {
  it("creates a pending invite; plaintext token never stored", async () => {
    const { invite, token } = await invitesForOrg(db, teamOrgId).create(
      "Dev.One@Example.com",
      "member",
      adminUserId,
    );
    expect(token.length).toBeGreaterThan(30);
    expect(invite.email).toBe("dev.one@example.com"); // lowercased
    expect(invite.tokenHash).not.toContain(token);

    const pending = await invitesForOrg(db, teamOrgId).listPending();
    expect(pending.map((i) => i.email)).toContain("dev.one@example.com");
  });

  it("rejects a second pending invite for the same email", async () => {
    await expect(
      invitesForOrg(db, teamOrgId).create(
        "dev.one@example.com",
        "admin",
        adminUserId,
      ),
    ).rejects.toMatchObject({ reason: "duplicate_pending" });
  });

  it("accept creates the membership with the invite's role and settles it", async () => {
    const dev = await makeUser("dev-1", "Dev One", "dev.one@example.com");
    await ensureOrgOfOne(db, dev); // signup bootstrap: personal org first

    const { token } = await invitesForOrg(db, teamOrgId).create(
      "dev.two@example.com",
      "member",
      adminUserId,
    );
    const joined = await acceptInvite(db, token, dev.id);
    expect(joined).toEqual({ orgId: teamOrgId, role: "member" });

    // Idempotent for the redeemer…
    expect(await acceptInvite(db, token, dev.id)).toEqual(joined);
    // …but burned for anyone else.
    const rival = await makeUser("rival-1", "Rival", "rival@example.com");
    await expect(acceptInvite(db, token, rival.id)).rejects.toMatchObject({
      reason: "already_used",
    });
  });

  it("org resolution: most-recent membership wins, personal org stays intact", async () => {
    const [dev] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, "dev-1"));

    // The app resolves to the team org joined via invite…
    const ctx = await orgContextForUser(db, dev.id);
    expect(ctx?.org.id).toBe(teamOrgId);
    expect(ctx?.role).toBe("member");
    // …while the frozen earliest-first bootstrap check still sees the
    // personal org, so ensureOrgOfOne never re-bootstraps.
    const earliest = await membershipForUser(db, dev.id);
    expect(earliest.orgId).not.toBe(teamOrgId);
    expect(earliest.role).toBe("admin");
  });

  it("revoke tombstones the invite and frees the (org,email) slot", async () => {
    const scope = invitesForOrg(db, teamOrgId);
    const { invite, token } = await scope.create(
      "dev.three@example.com",
      "member",
      adminUserId,
    );
    expect(await scope.revoke(invite.id)).toBe(true);
    expect(await scope.revoke(invite.id)).toBe(false); // already settled

    await expect(acceptInvite(db, token, adminUserId)).rejects.toMatchObject({
      reason: "revoked",
    });
    // Partial unique index only covers live invites — re-inviting works.
    const again = await scope.create(
      "dev.three@example.com",
      "member",
      adminUserId,
    );
    expect(again.invite.email).toBe("dev.three@example.com");
  });

  it("expired invites are rejected", async () => {
    const { invite, token } = await invitesForOrg(db, teamOrgId).create(
      "late@example.com",
      "member",
      adminUserId,
    );
    await db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invites.id, invite.id));
    await expect(acceptInvite(db, token, adminUserId)).rejects.toMatchObject({
      reason: "expired",
    });
    expect((await previewInvite(db, token)).status).toBe("expired");
  });

  it("garbage tokens are invalid, and revocation is org-scoped", async () => {
    await expect(acceptInvite(db, "not-a-token", adminUserId)).rejects.toThrow(
      InviteError,
    );
    // Another org cannot revoke this org's invite (tenant isolation).
    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: "Rival Corp", kind: "team" })
      .returning();
    const { invite } = await invitesForOrg(db, teamOrgId).create(
      "target@example.com",
      "member",
      adminUserId,
    );
    expect(await invitesForOrg(db, otherOrg.id).revoke(invite.id)).toBe(false);
  });

  it("orgMembersList surfaces members with roles", async () => {
    const members = await orgMembersList(db, teamOrgId);
    const byId = Object.fromEntries(members.map((m) => [m.userId, m.role]));
    expect(byId["admin-1"]).toBe("admin");
    expect(byId["dev-1"]).toBe("member");
  });
});
