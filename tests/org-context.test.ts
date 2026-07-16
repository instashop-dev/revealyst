import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import {
  orgContextForSessionToken,
  orgContextForUser,
} from "../src/db/org-context";
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
