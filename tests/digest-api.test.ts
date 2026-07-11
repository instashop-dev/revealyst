import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for PATCH /api/settings/digest and the unauthenticated
// GET/POST /api/digest/unsubscribe (F2.2). Invokes the REAL handlers (role
// gate, body parse, token resolution, org-scoped writes); only the
// request-context module is mocked (it needs the Workers runtime).

const h = vi.hoisted(() => ({ ctx: null as unknown, db: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
  getApiContext: () => ({ db: h.db, env: {} }),
}));

import { PATCH } from "@/app/api/settings/digest/route";
import {
  GET as unsubGET,
  POST as unsubPOST,
} from "@/app/api/digest/unsubscribe/route";

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
  h.db = db; // the mocked getApiContext hands the routes this db
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

describe("GET/POST /api/digest/unsubscribe (RFC 8058 discipline)", () => {
  const UNSUB_USER = "digest-unsub-route-user";
  let token: string;

  const unsubReq = (t: string | null) =>
    new Request(
      t === null
        ? "https://app.example/api/digest/unsubscribe"
        : `https://app.example/api/digest/unsubscribe?token=${encodeURIComponent(t)}`,
    );

  beforeAll(async () => {
    await db.insert(schema.user).values({
      id: UNSUB_USER,
      name: "Unsub",
      email: "unsub@fixture.example",
    });
    const scope = forOrg(db, orgId);
    await scope.digestPreferences.setEnabled(UNSUB_USER, true);
    const claim = await scope.digestPreferences.claimWeekAndRotateToken(
      UNSUB_USER,
      "2026-W28",
    );
    token = claim!.token;
  });

  it("a bare GET (link scanner / prefetch) NEVER changes the preference", async () => {
    const res = await unsubGET(unsubReq(token));
    expect(res.status).toBe(200);
    // Read-only: the page offers a POST confirm form, the pref stays enabled.
    const html = await res.text();
    expect(html).toContain('method="post"');
    const row = await forOrg(db, orgId).digestPreferences.getForUser(UNSUB_USER);
    expect(row?.digestEnabled).toBe(true);
    // Even repeated scanner GETs stay read-only.
    await unsubGET(unsubReq(token));
    const again = await forOrg(db, orgId).digestPreferences.getForUser(UNSUB_USER);
    expect(again?.digestEnabled).toBe(true);
  });

  it("POST (one-click header or the confirm form) is the sole mutator", async () => {
    const res = await unsubPOST(
      new Request(
        `https://app.example/api/digest/unsubscribe?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      ),
    );
    expect(res.status).toBe(200);
    const row = await forOrg(db, orgId).digestPreferences.getForUser(UNSUB_USER);
    expect(row?.digestEnabled).toBe(false);
    // Idempotent re-POST still succeeds (desired end state holds).
    const res2 = await unsubPOST(
      new Request(
        `https://app.example/api/digest/unsubscribe?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      ),
    );
    expect(res2.status).toBe(200);
  });

  it("unknown token: GET 404s read-only, POST 404s without effect; missing token 400s", async () => {
    expect((await unsubGET(unsubReq("not-a-token"))).status).toBe(404);
    expect(
      (
        await unsubPOST(
          new Request(
            "https://app.example/api/digest/unsubscribe?token=not-a-token",
            { method: "POST" },
          ),
        )
      ).status,
    ).toBe(404);
    expect((await unsubGET(unsubReq(null))).status).toBe(400);
  });
});
