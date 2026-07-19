import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { todayUtc } from "../src/lib/spend-governance";

// Route-handler harness for POST /api/initiatives (TMD P2b, ADR 0062). Invokes
// the REAL route (impersonation guard, body parse, manager-OR-admin gate,
// closed-union metric validation, server-computed baseline) against a
// PGlite-backed db. Only appContext is mocked.

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { POST as initiativesPOST } from "@/app/api/initiatives/route";

let db: Db;
let orgId: string;
let teamId: string;
const ADMIN = "init-admin";
const MEMBER = "init-member";
const MANAGER = "init-manager"; // manages a team — still Better Auth role "member"

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
    role: opts.role ?? "admin",
    isPlatformAdmin: false,
    scope: forOrg(db, orgId),
  };
}

const jsonReq = (body?: unknown) =>
  new Request("http://localhost/api/initiatives", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const validBody = {
  templateSlug: "build-one-repeatable-workflow",
  title: "Standardize our test-writing flow",
  target: 70,
  reviewDate: "2026-09-30",
};

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "init-org", kind: "team" })
    .returning();
  orgId = org.id;
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Admin", email: "admin@init.example" },
    { id: MEMBER, name: "Member", email: "member@init.example" },
    { id: MANAGER, name: "Manager", email: "manager@init.example" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId, userId: ADMIN, role: "admin" },
    { orgId, userId: MEMBER, role: "member" },
    { orgId, userId: MANAGER, role: "member" },
  ]);
  teamId = (await forOrg(db, orgId).teams.create("Platform")).id;
  await forOrg(db, orgId).teamManagers.assign(teamId, MANAGER);
});

beforeEach(() => {
  h.ctx = ctxFor({ userId: ADMIN });
});

describe("POST /api/initiatives — authorization", () => {
  it("401s when signed out", async () => {
    h.ctx = null;
    expect((await initiativesPOST(jsonReq(validBody))).status).toBe(401);
  });

  it("a plain member (not a manager) gets 403 — no initiative written", async () => {
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    const res = await initiativesPOST(jsonReq(validBody));
    expect(res.status).toBe(403);
    expect(await forOrg(db, orgId).initiatives.list()).toHaveLength(0);
  });

  it("a non-admin manager succeeds and owns the initiative", async () => {
    h.ctx = ctxFor({ userId: MANAGER, role: "member" });
    const res = await initiativesPOST(jsonReq(validBody));
    expect(res.status).toBe(200);
    const created = (await res.json()) as {
      ownerUserId: string;
      status: string;
      scoreSlug: string | null;
      capabilitySlug: string | null;
    };
    expect(created.ownerUserId).toBe(MANAGER);
    expect(created.status).toBe("active");
    // Metric bindings come from the template.
    expect(created.scoreSlug).toBe("fluency");
    expect(created.capabilitySlug).toBe("consistent-daily-use");
  });

  it("403s while impersonating", async () => {
    h.ctx = ctxFor({ userId: ADMIN, impersonatedBy: "platform-admin" });
    expect((await initiativesPOST(jsonReq(validBody))).status).toBe(403);
  });
});

describe("POST /api/initiatives — validation & honesty", () => {
  it("400s an unknown template", async () => {
    expect(
      (await initiativesPOST(jsonReq({ ...validBody, templateSlug: "nope" }))).status,
    ).toBe(400);
  });

  it("400s an impossible review date", async () => {
    expect(
      (await initiativesPOST(jsonReq({ ...validBody, reviewDate: "2026-02-30" }))).status,
    ).toBe(400);
  });

  it("400s when the initiative targets nothing (no template, no slug)", async () => {
    const res = await initiativesPOST(
      jsonReq({
        title: "Aimless",
        target: 70,
        reviewDate: "2026-09-30",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a free-form capability/score slug (closed union enforced)", async () => {
    // No template, an invalid explicit capability slug → rejected.
    expect(
      (
        await initiativesPOST(
          jsonReq({
            title: "Bad capability",
            capabilitySlug: "totally-made-up",
            target: 70,
            reviewDate: "2026-09-30",
          }),
        )
      ).status,
    ).toBe(400);
    // …and an invalid explicit score slug → rejected.
    expect(
      (
        await initiativesPOST(
          jsonReq({
            title: "Bad score",
            scoreSlug: "productivity",
            target: 70,
            reviewDate: "2026-09-30",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("baseline is null when the target score is unmeasured (never fabricated)", async () => {
    const res = await initiativesPOST(jsonReq(validBody));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { baseline: number | null }).baseline).toBeNull();
  });

  it("baseline is the current MEASURED team value for a score target (rounded)", async () => {
    const fluency = (await forOrg(db, orgId).scores.definitions()).find(
      (d) => d.slug === "fluency" && d.status === "active",
    )!;
    await forOrg(db, orgId).scores.upsertResults([
      {
        definitionId: fluency.id,
        subjectLevel: "team",
        teamId,
        periodStart: todayUtc(),
        periodEnd: todayUtc(),
        periodGrain: "rolling_28d",
        value: 48.6,
        attribution: "account",
        components: {},
      },
    ]);
    const res = await initiativesPOST(jsonReq(validBody));
    expect(res.status).toBe(200);
    // 48.6 (fluency, the template's score) rounds to 49.
    expect(((await res.json()) as { baseline: number | null }).baseline).toBe(49);
  });
});
