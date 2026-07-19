import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for POST /api/initiatives/:id/review (TMD P3, ADR 0062).
// Owner-OR-admin records the outcome or stops the initiative; a status guard
// forbids re-reviewing a closed one. Only appContext is mocked.

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { POST as reviewPOST } from "@/app/api/initiatives/[id]/review/route";

let db: Db;
let orgId: string;
const OWNER = "rev-owner"; // a manager who owns the initiative
const OTHER = "rev-other"; // another manager, NOT the owner
const MEMBER = "rev-member";
const ADMIN = "rev-admin";

function ctxFor(opts: {
  userId: string;
  role?: "admin" | "member";
  impersonatedBy?: string | null;
}) {
  return {
    env: {},
    db,
    session: {
      session: { impersonatedBy: opts.impersonatedBy ?? null },
      user: { id: opts.userId },
    },
    user: { id: opts.userId },
    org: { id: orgId, kind: "team" as const, visibilityMode: "private" as const },
    role: opts.role ?? "member",
    isPlatformAdmin: false,
    scope: forOrg(db, orgId),
  };
}

const jsonReq = (body?: unknown) =>
  new Request("http://localhost/api/initiatives/x/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function freshInitiative(): Promise<string> {
  const i = await forOrg(db, orgId).initiatives.create({
    teamId: null,
    ownerUserId: OWNER,
    title: "Review me",
    templateSlug: null,
    capabilitySlug: null,
    scoreSlug: "fluency",
    baseline: 40,
    target: 70,
    reviewDate: "2026-09-30",
  });
  return i.id;
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "rev-org", kind: "team" })
    .returning();
  orgId = org.id;
  await db.insert(schema.user).values([
    { id: OWNER, name: "Owner", email: "owner@rev.example" },
    { id: OTHER, name: "Other", email: "other@rev.example" },
    { id: MEMBER, name: "Member", email: "member@rev.example" },
    { id: ADMIN, name: "Admin", email: "admin@rev.example" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId, userId: OWNER, role: "member" },
    { orgId, userId: OTHER, role: "member" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: ADMIN, role: "admin" },
  ]);
  const team = await forOrg(db, orgId).teams.create("Platform");
  await forOrg(db, orgId).teamManagers.assign(team.id, OWNER);
  await forOrg(db, orgId).teamManagers.assign(team.id, OTHER);
});

beforeEach(() => {
  h.ctx = ctxFor({ userId: OWNER });
});

describe("POST /api/initiatives/:id/review — record outcome", () => {
  it("the owner records an outcome; the initiative completes", async () => {
    const id = await freshInitiative();
    const res = await reviewPOST(
      jsonReq({ action: "complete", outcome: "improved" }),
      params(id),
    );
    expect(res.status).toBe(200);
    const after = await forOrg(db, orgId).initiatives.get(id);
    expect(after?.status).toBe("completed");
    expect(after?.outcome).toBe("improved");
  });

  it("an admin may review an initiative they don't own", async () => {
    const id = await freshInitiative();
    h.ctx = ctxFor({ userId: ADMIN, role: "admin" });
    expect(
      (await reviewPOST(jsonReq({ action: "complete", outcome: "unchanged" }), params(id))).status,
    ).toBe(200);
  });

  it("a different (non-owner) manager gets 403", async () => {
    const id = await freshInitiative();
    h.ctx = ctxFor({ userId: OTHER, role: "member" });
    expect(
      (await reviewPOST(jsonReq({ action: "complete", outcome: "improved" }), params(id))).status,
    ).toBe(403);
  });

  it("a plain member gets 403", async () => {
    const id = await freshInitiative();
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    expect(
      (await reviewPOST(jsonReq({ action: "complete", outcome: "improved" }), params(id))).status,
    ).toBe(403);
  });

  it("409s re-reviewing an already-completed initiative (status guard)", async () => {
    const id = await freshInitiative();
    await reviewPOST(jsonReq({ action: "complete", outcome: "improved" }), params(id));
    const again = await reviewPOST(
      jsonReq({ action: "complete", outcome: "worsened" }),
      params(id),
    );
    expect(again.status).toBe(409);
  });

  it("400s an invalid outcome", async () => {
    const id = await freshInitiative();
    expect(
      (await reviewPOST(jsonReq({ action: "complete", outcome: "great" }), params(id))).status,
    ).toBe(400);
  });

  it("403s while impersonating", async () => {
    const id = await freshInitiative();
    h.ctx = ctxFor({ userId: OWNER, impersonatedBy: "platform-admin" });
    expect(
      (await reviewPOST(jsonReq({ action: "complete", outcome: "improved" }), params(id))).status,
    ).toBe(403);
  });

  it("404s an initiative from another org (cross-org owner check)", async () => {
    const [orgB] = await db
      .insert(schema.orgs)
      .values({ name: "rev-org-b", kind: "team" })
      .returning();
    const bInitiative = await forOrg(db, orgB.id).initiatives.create({
      teamId: null,
      ownerUserId: OWNER,
      title: "B's initiative",
      templateSlug: null,
      capabilitySlug: null,
      scoreSlug: "fluency",
      baseline: null,
      target: 70,
      reviewDate: "2026-09-30",
    });
    // OWNER (in org A's scope) reviewing org B's initiative id → 404, never a leak.
    expect(
      (await reviewPOST(jsonReq({ action: "complete", outcome: "improved" }), params(bInitiative.id))).status,
    ).toBe(404);
  });
});

describe("POST /api/initiatives/:id/review — stop", () => {
  it("the owner stops an open initiative", async () => {
    const id = await freshInitiative();
    const res = await reviewPOST(jsonReq({ action: "stop" }), params(id));
    expect(res.status).toBe(200);
    expect((await forOrg(db, orgId).initiatives.get(id))?.status).toBe("stopped");
  });

  it("409s stopping an already-completed initiative", async () => {
    const id = await freshInitiative();
    await reviewPOST(jsonReq({ action: "complete", outcome: "improved" }), params(id));
    expect((await reviewPOST(jsonReq({ action: "stop" }), params(id))).status).toBe(409);
  });

  it("a non-owner member cannot stop (403)", async () => {
    const id = await freshInitiative();
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    expect((await reviewPOST(jsonReq({ action: "stop" }), params(id))).status).toBe(403);
  });
});
