import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/contracts/api";
import type { Db } from "../src/db/client";
import { orgContextForUser } from "../src/db/org-context";
import { ensureOrgOfOne, membershipForUser } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

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
