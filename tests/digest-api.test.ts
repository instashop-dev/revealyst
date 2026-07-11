import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for PATCH /api/settings/digest (F2.2). Invokes the REAL
// handler (role gate, body parse, org-scoped write); only appContext is mocked
// (it needs the Workers runtime).

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({ appContext: async () => h.ctx }));

import { PATCH } from "@/app/api/settings/digest/route";

let db: Db;
let orgId: string;
const USER_ID = "digest-api-user";

function ctxFor(opts: { role?: "admin" | "member" }) {
  return {
    env: {},
    db,
    session: { user: { id: USER_ID } },
    user: { id: USER_ID },
    org: { id: orgId, kind: "personal" as const },
    role: opts.role ?? "admin",
    isPlatformAdmin: false,
    scope: forOrg(db, orgId),
  };
}

const patchReq = (body?: unknown) =>
  new Request("https://app.example/api/settings/digest", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  orgId = (await createFixtureOrg(db, "digest-api-org", "personal")).id;
  await db
    .insert(schema.user)
    .values({ id: USER_ID, name: "Admin", email: "admin@fixture.example" });
});

describe("PATCH /api/settings/digest", () => {
  it("401 when signed out", async () => {
    h.ctx = null;
    const res = await PATCH(patchReq({ enabled: true }));
    expect(res.status).toBe(401);
  });

  it("403 for a non-admin member", async () => {
    h.ctx = ctxFor({ role: "member" });
    const res = await PATCH(patchReq({ enabled: true }));
    expect(res.status).toBe(403);
  });

  it("400 on a malformed body", async () => {
    h.ctx = ctxFor({ role: "admin" });
    const res = await PATCH(patchReq({ enabled: "yes" }));
    expect(res.status).toBe(400);
  });

  it("admin opt-in persists the preference row", async () => {
    h.ctx = ctxFor({ role: "admin" });
    const res = await PATCH(patchReq({ enabled: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    const row = await forOrg(db, orgId).digestPreferences.getForUser(USER_ID);
    expect(row?.digestEnabled).toBe(true);
  });

  it("admin opt-out flips the same row", async () => {
    h.ctx = ctxFor({ role: "admin" });
    const res = await PATCH(patchReq({ enabled: false }));
    expect(res.status).toBe(200);
    const row = await forOrg(db, orgId).digestPreferences.getForUser(USER_ID);
    expect(row?.digestEnabled).toBe(false);
  });
});
