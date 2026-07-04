import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { ensureOrgOfOne, membershipForUser } from "../src/db/org-scope";
import { createAuth, type Auth } from "../src/lib/auth";
import * as schema from "../src/db/schema";

let db: Db;
let auth: Auth;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  auth = createAuth(db, {
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    BETTER_AUTH_URL: "http://localhost:3000",
  });
});

describe("email + password auth", () => {
  it("signs up a user and creates their org of one", async () => {
    const result = await auth.api.signUpEmail({
      body: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "correct-horse-battery",
      },
    });
    expect(result.user.email).toBe("ada@example.com");

    // Personal mode = an org of one: signup must have created an org and
    // an admin membership.
    const membership = await membershipForUser(db, result.user.id);
    expect(membership).toBeDefined();
    expect(membership.orgName).toBe("Ada Lovelace");
    expect(membership.role).toBe("admin");
  });

  it("signs in with the same credentials and gets a session token", async () => {
    const result = await auth.api.signInEmail({
      body: {
        email: "ada@example.com",
        password: "correct-horse-battery",
      },
    });
    expect(result.user.email).toBe("ada@example.com");
    expect(result.token).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: "ada@example.com", password: "wrong-password" },
      }),
    ).rejects.toThrow();
  });

  it("each signup gets its own org (no shared default org)", async () => {
    const second = await auth.api.signUpEmail({
      body: {
        name: "Grace Hopper",
        email: "grace@example.com",
        password: "correct-horse-battery",
      },
    });
    const ada = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "ada@example.com"));
    const adaMembership = await membershipForUser(db, ada[0].id);
    const graceMembership = await membershipForUser(db, second.user.id);
    expect(graceMembership.orgId).not.toBe(adaMembership.orgId);
  });
});

describe("org bootstrap resilience", () => {
  it("ensureOrgOfOne is idempotent (retried hook can't duplicate)", async () => {
    const [ada] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "ada@example.com"));
    const first = await ensureOrgOfOne(db, ada);
    const second = await ensureOrgOfOne(db, ada);
    expect(second.orgId).toBe(first.orgId);

    const rows = await db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.userId, ada.id));
    expect(rows).toHaveLength(1);
  });

  it("self-heals a user whose signup hook failed (user without org)", async () => {
    // Simulate the post-commit-hook failure mode: a committed user row
    // with no org/membership.
    const [orphan] = await db
      .insert(schema.user)
      .values({
        id: "orphan-user-id",
        name: "Orphan User",
        email: "orphan@example.com",
      })
      .returning();
    expect(await membershipForUser(db, orphan.id)).toBeUndefined();

    const healed = await ensureOrgOfOne(db, orphan);
    expect(healed.orgName).toBe("Orphan User");
    expect(healed.role).toBe("admin");
    expect((await membershipForUser(db, orphan.id))?.orgId).toBe(
      healed.orgId,
    );
  });

  it("rejects duplicate org membership at the schema level", async () => {
    const [ada] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "ada@example.com"));
    const membership = await membershipForUser(db, ada.id);
    await expect(
      db.insert(schema.orgMembers).values({
        orgId: membership.orgId,
        userId: ada.id,
        role: "member",
      }),
    ).rejects.toThrow();
  });
});
