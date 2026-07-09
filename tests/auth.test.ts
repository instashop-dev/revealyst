import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fullSchema } from "../src/db/client";
import type { Db } from "../src/db/client";
import { ensureOrgOfOne, membershipForUser } from "../src/db/org-scope";
import { createAuth, type Auth } from "../src/lib/auth";
import * as schema from "../src/db/schema";

// Email verification + password reset are required flows now, but tests must
// not send real mail. Mock the SES sender and read the token out of the
// captured verification/reset email instead.
vi.mock("../src/lib/email", () => ({ sendEmail: vi.fn() }));
import { sendEmail } from "../src/lib/email";

const sendEmailMock = vi.mocked(sendEmail);

/**
 * Pull the most recent verification/reset token emailed to `address`. Better
 * Auth carries the token differently per flow: verification is
 * `/verify-email?token=…`, password reset is `/reset-password/<token>?…`.
 */
function lastEmailedToken(address: string): string {
  for (let i = sendEmailMock.mock.calls.length - 1; i >= 0; i--) {
    const [, msg] = sendEmailMock.mock.calls[i];
    if (msg.to !== address) continue;
    const query = msg.html.match(/[?&]token=([^"&]+)/);
    if (query) return decodeURIComponent(query[1]);
    const path = msg.html.match(/\/reset-password\/([^"?]+)/);
    if (path) return decodeURIComponent(path[1]);
  }
  throw new Error(`no email with a token captured for ${address}`);
}

let db: Db;
let auth: Auth;

beforeAll(async () => {
  // fullSchema (src/db/client.ts) = tables + auth relations, so
  // db.query.session/user exist for the drizzleAdapter's experimental.joins
  // session lookup to join instead of falling back to two queries.
  const pgliteDb = drizzle(new PGlite(), { schema: fullSchema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  auth = createAuth(db, {
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    BETTER_AUTH_URL: "http://localhost:3000",
  });
});

describe("email + password auth", () => {
  it("signs up a user, creates their org of one, and sends a verification email", async () => {
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

    // sendOnSignUp fired the verification email.
    expect(
      sendEmailMock.mock.calls.some(([, msg]) => msg.to === "ada@example.com"),
    ).toBe(true);
  });

  it("rejects sign-in until the email is verified", async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: "ada@example.com", password: "correct-horse-battery" },
      }),
    ).rejects.toThrow();
  });

  it("verifies the email, then signs in and gets a session token", async () => {
    const token = lastEmailedToken("ada@example.com");
    await auth.api.verifyEmail({ query: { token } });

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

  it("resets the password via the emailed token", async () => {
    await auth.api.requestPasswordReset({
      body: { email: "ada@example.com", redirectTo: "/reset-password" },
    });
    const token = lastEmailedToken("ada@example.com");
    await auth.api.resetPassword({
      body: { newPassword: "new-correct-horse-battery", token },
    });

    // New password works; old one no longer does.
    const ok = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: "new-correct-horse-battery" },
    });
    expect(ok.token).toBeTruthy();
    await expect(
      auth.api.signInEmail({
        body: { email: "ada@example.com", password: "correct-horse-battery" },
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
    expect((await membershipForUser(db, orphan.id))?.orgId).toBe(healed.orgId);
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
