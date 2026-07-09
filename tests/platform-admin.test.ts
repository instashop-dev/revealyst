import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { fullSchema } from "../src/db/client";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  isPlatformAdmin,
  parseAdminUserIds,
} from "../src/lib/admin-access";
import { createAuth, type Auth, type AuthEnv } from "../src/lib/auth";
import { SYSTEM_ORG_ID } from "../src/poller/messages";

// Platform-admin foundation (ADR 0016): the Better Auth admin plugin plus the
// guard/audit hooks in src/lib/auth.ts, exercised end-to-end against PGlite
// through auth.api.* — the same dispatch pipeline (before hooks → endpoint →
// after hooks) the HTTP routes go through.

const BASE_ENV: AuthEnv = {
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
};

let db: Db;
let auth: Auth;

beforeAll(async () => {
  // fullSchema (src/db/client.ts) = tables + auth relations, so
  // db.query.session/user exist for the drizzleAdapter's experimental.joins
  // session lookup to join instead of falling back to two queries.
  const pgliteDb = drizzle(new PGlite(), { schema: fullSchema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  auth = createAuth(db, BASE_ENV);
});

/** Session cookies (name=value pairs) from a response's Set-Cookie headers. */
function sessionCookies(headers: Headers | undefined): string[] {
  return (headers?.getSetCookie() ?? [])
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="));
}

/** Merge cookie pairs (later wins per name) into one Cookie header. */
function cookieHeader(...pairs: string[]): Headers {
  const byName = new Map<string, string>();
  for (const pair of pairs) {
    const name = pair.slice(0, pair.indexOf("="));
    byName.set(name, pair);
  }
  return new Headers({ cookie: [...byName.values()].join("; ") });
}

let seq = 0;
/** Sign up + verify + sign in a user; returns id and an authed Cookie header. */
async function makeUser(name: string) {
  seq += 1;
  const email = `admin-test-${seq}@example.com`;
  const password = "correct-horse-battery";
  const signedUp = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  // Skip the email round-trip (covered by tests/auth.test.ts): verify directly.
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, signedUp.user.id));
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  return {
    id: signedUp.user.id,
    email,
    headers: cookieHeader(...sessionCookies(headers)),
  };
}

/** Promote a user to platform admin via the role column (DB fixture). */
async function promote(userId: string) {
  await db
    .update(schema.user)
    .set({ role: "admin" })
    .where(eq(schema.user.id, userId));
}

async function systemAuditRows(action?: string) {
  const rows = await forOrg(db, SYSTEM_ORG_ID).auditLog.list({ limit: 200 });
  return action ? rows.filter((r) => r.action === action) : rows;
}

/** Await a rejection and assert the APIError status code (and message). */
async function expectApiStatus(
  p: Promise<unknown>,
  statusCode: number,
  message?: RegExp,
) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected a rejection with status ${statusCode}`).not.toBeNull();
  expect((err as { statusCode?: number }).statusCode).toBe(statusCode);
  if (message) {
    expect(String((err as Error).message)).toMatch(message);
  }
}

describe("isPlatformAdmin (pure)", () => {
  it("treats a NULL/undefined role as 'user'", () => {
    expect(isPlatformAdmin({ id: "u1", role: null }, {})).toBe(false);
    expect(isPlatformAdmin({ id: "u1" }, {})).toBe(false);
    expect(isPlatformAdmin({ id: "u1", role: "user" }, {})).toBe(false);
  });

  it("grants via the role column", () => {
    expect(isPlatformAdmin({ id: "u1", role: "admin" }, {})).toBe(true);
    // Exact match only — compound roles are rejected at set-role time.
    expect(isPlatformAdmin({ id: "u1", role: "admin,user" }, {})).toBe(false);
  });

  it("grants via ADMIN_USER_IDS without the column being set", () => {
    const env = { ADMIN_USER_IDS: " u1 , u2 " };
    expect(isPlatformAdmin({ id: "u1", role: null }, env)).toBe(true);
    expect(isPlatformAdmin({ id: "u3", role: null }, env)).toBe(false);
    expect(parseAdminUserIds({ ADMIN_USER_IDS: "a, ,b ," })).toEqual([
      "a",
      "b",
    ]);
    expect(parseAdminUserIds({})).toEqual([]);
  });
});

describe("admin endpoint access", () => {
  it("403s a non-admin on admin endpoints", async () => {
    const plain = await makeUser("Plain User");
    await expectApiStatus(
      auth.api.listUsers({ query: {}, headers: plain.headers }),
      403,
    );
    const other = await makeUser("Other User");
    await expectApiStatus(
      auth.api.banUser({
        body: { userId: other.id },
        headers: plain.headers,
      }),
      403,
    );
  });

  it("lets a bootstrapped ADMIN_USER_IDS id call list-users (role column NULL)", async () => {
    const boot = await makeUser("Bootstrap Admin");
    const bootAuth = createAuth(db, {
      ...BASE_ENV,
      ADMIN_USER_IDS: ` ${boot.id} , `,
    });
    const result = await bootAuth.api.listUsers({
      query: {},
      headers: boot.headers,
    });
    expect(result.users.length).toBeGreaterThan(0);
    // The same session against an env WITHOUT the bootstrap id stays a user.
    await expectApiStatus(
      auth.api.listUsers({ query: {}, headers: boot.headers }),
      403,
    );
  });
});

describe("admin mutations: guarded + audited", () => {
  it("set-role succeeds and lands a system-org audit row", async () => {
    const admin = await makeUser("Role Setter");
    await promote(admin.id);
    const target = await makeUser("Promoted User");

    const result = await auth.api.setRole({
      body: { userId: target.id, role: "admin" },
      headers: admin.headers,
    });
    expect(result.user.role).toBe("admin");

    const rows = await systemAuditRows("admin.role.set");
    const row = rows.find((r) => r.targetId === target.id);
    expect(row).toBeDefined();
    expect(row?.actorUserId).toBe(admin.id);
    expect(row?.targetKind).toBe("user");
    expect(row?.metadata).toMatchObject({ role: "admin" });
  });

  it("rejects non-binary role values (no hidden compound admins)", async () => {
    const admin = await makeUser("Strict Roles");
    await promote(admin.id);
    const target = await makeUser("Role Victim");
    // The plugin's types already restrict role to "user" | "admin"; the
    // before-hook enforces it at runtime for raw HTTP callers too.
    await expectApiStatus(
      auth.api.setRole({
        body: { userId: target.id, role: "admin,user" as "admin" },
        headers: admin.headers,
      }),
      400,
      /binary/i,
    );
    await expectApiStatus(
      auth.api.setRole({
        body: { userId: target.id, role: "superuser" as "admin" },
        headers: admin.headers,
      }),
      400,
    );
  });

  it("ban revokes the target's sessions and audits ban + unban", async () => {
    const admin = await makeUser("Banhammer");
    await promote(admin.id);
    const target = await makeUser("Banned User");

    // Target has a live session before the ban…
    const before = await auth.api.getSession({ headers: target.headers });
    expect(before?.user.id).toBe(target.id);

    await auth.api.banUser({
      body: { userId: target.id, banReason: "abuse" },
      headers: admin.headers,
    });
    // …and none after.
    const after = await auth.api.getSession({ headers: target.headers });
    expect(after).toBeNull();

    const banRow = (await systemAuditRows("admin.user.ban")).find(
      (r) => r.targetId === target.id,
    );
    expect(banRow?.actorUserId).toBe(admin.id);
    expect(banRow?.metadata).toMatchObject({ reason: "abuse" });

    await auth.api.unbanUser({
      body: { userId: target.id },
      headers: admin.headers,
    });
    const unbanRow = (await systemAuditRows("admin.user.unban")).find(
      (r) => r.targetId === target.id,
    );
    expect(unbanRow?.actorUserId).toBe(admin.id);
  });

  it("impersonate start/stop round-trips and audits both events", async () => {
    const admin = await makeUser("Support Admin");
    await promote(admin.id);
    const target = await makeUser("Impersonated User");

    const { headers, response } = await auth.api.impersonateUser({
      body: { userId: target.id },
      headers: admin.headers,
      returnHeaders: true,
    });
    expect(response.user.id).toBe(target.id);
    expect(
      (response.session as { impersonatedBy?: string | null }).impersonatedBy,
    ).toBe(admin.id);

    // The minted cookie IS the target's session, flagged as impersonated.
    const impersonationCookies = sessionCookies(headers);
    const asTarget = cookieHeader(...impersonationCookies);
    const seen = await auth.api.getSession({ headers: asTarget });
    expect(seen?.user.id).toBe(target.id);
    expect(seen?.session.impersonatedBy).toBe(admin.id);

    const startRow = (await systemAuditRows("admin.impersonate.start")).find(
      (r) => r.targetId === target.id,
    );
    expect(startRow?.actorUserId).toBe(admin.id);

    // Stop needs both the impersonated session cookie and the stashed
    // admin_session cookie from the impersonate response.
    const restored = await auth.api.stopImpersonating({ headers: asTarget });
    expect(restored.user.id).toBe(admin.id);

    const stopRow = (await systemAuditRows("admin.impersonate.stop")).find(
      (r) => r.targetId === target.id,
    );
    expect(stopRow?.actorUserId).toBe(admin.id);
  });

  it("does not audit failed attempts", async () => {
    const plain = await makeUser("No Power");
    const target = await makeUser("Untouched");
    const countBefore = (await systemAuditRows()).length;
    await expectApiStatus(
      auth.api.banUser({
        body: { userId: target.id },
        headers: plain.headers,
      }),
      403,
    );
    expect((await systemAuditRows()).length).toBe(countBefore);
  });
});

describe("guard hooks: admin-on-admin, self, and cut endpoints", () => {
  it("gives non-admin callers no admin-enumeration oracle", async () => {
    // The target-guard 403s are distinctive ("cannot target a platform
    // admin"). They must fire only for callers the endpoint would let
    // through — a plain user probing an admin id gets the endpoint's own
    // generic 403, indistinguishable from probing a non-admin id.
    const plain = await makeUser("Prober");
    const adminTarget = await makeUser("Hidden Admin");
    await promote(adminTarget.id);
    const plainTarget = await makeUser("Hidden User");

    for (const target of [adminTarget, plainTarget]) {
      const err = await auth.api
        .banUser({ body: { userId: target.id }, headers: plain.headers })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect((err as { statusCode?: number }).statusCode).toBe(403);
      expect(String((err as Error).message)).not.toMatch(/platform admin/i);
    }
  });

  it("blocks impersonating a platform admin (role column)", async () => {
    const admin = await makeUser("Admin A");
    const admin2 = await makeUser("Admin B");
    await promote(admin.id);
    await promote(admin2.id);
    await expectApiStatus(
      auth.api.impersonateUser({
        body: { userId: admin2.id },
        headers: admin.headers,
      }),
      403,
      /platform admin/i,
    );
  });

  it("blocks impersonate/ban/set-role on an ADMIN_USER_IDS bootstrap admin", async () => {
    const admin = await makeUser("Admin C");
    await promote(admin.id);
    const bootTarget = await makeUser("Boot Target");
    const bootAuth = createAuth(db, {
      ...BASE_ENV,
      ADMIN_USER_IDS: bootTarget.id,
    });
    await expectApiStatus(
      bootAuth.api.impersonateUser({
        body: { userId: bootTarget.id },
        headers: admin.headers,
      }),
      403,
    );
    await expectApiStatus(
      bootAuth.api.banUser({
        body: { userId: bootTarget.id },
        headers: admin.headers,
      }),
      403,
    );
    await expectApiStatus(
      bootAuth.api.setRole({
        body: { userId: bootTarget.id, role: "user" },
        headers: admin.headers,
      }),
      403,
    );
  });

  it("blocks self-ban and self set-role (lockout protection)", async () => {
    const admin = await makeUser("Self Harm");
    await promote(admin.id);
    await expectApiStatus(
      auth.api.banUser({
        body: { userId: admin.id },
        headers: admin.headers,
      }),
      403,
      /yourself|own/i,
    );
    await expectApiStatus(
      auth.api.setRole({
        body: { userId: admin.id, role: "user" },
        headers: admin.headers,
      }),
      403,
    );
  });

  it("blocks remove-user outright (ADR 0015 purge invariant)", async () => {
    const admin = await makeUser("Deleter");
    await promote(admin.id);
    const target = await makeUser("Survivor");
    await expectApiStatus(
      auth.api.removeUser({
        body: { userId: target.id },
        headers: admin.headers,
      }),
      403,
      /disabled/i,
    );
    const [still] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, target.id));
    expect(still).toBeDefined();
  });

  it("blocks the unaudited mutation endpoints (create/update-user, set-password, revoke-sessions)", async () => {
    const admin = await makeUser("Curious Admin");
    await promote(admin.id);
    const target = await makeUser("Stable User");
    await expectApiStatus(
      auth.api.createUser({
        body: { email: "new@example.com", name: "New", role: "admin" },
        headers: admin.headers,
      }),
      403,
    );
    await expectApiStatus(
      // update-user's generic data payload could set role/banned — the
      // bypass the before-hook exists to close.
      auth.api.adminUpdateUser({
        body: { userId: target.id, data: { role: "admin" } },
        headers: admin.headers,
      }),
      403,
    );
    await expectApiStatus(
      auth.api.setUserPassword({
        body: { userId: target.id, newPassword: "hijacked-password-123" },
        headers: admin.headers,
      }),
      403,
    );
    await expectApiStatus(
      auth.api.revokeUserSessions({
        body: { userId: target.id },
        headers: admin.headers,
      }),
      403,
    );
    // Target's role never moved. (New signups get defaultRole "user" from
    // the plugin; only PRE-plugin rows have NULL — both read as non-admin.)
    const [row] = await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, target.id));
    expect(row.role).not.toBe("admin");
  });
});
