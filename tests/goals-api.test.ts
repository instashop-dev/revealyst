import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { todayUtc } from "../src/lib/spend-governance";

// Route-handler harness for POST /api/goals (TMD P1b, ADR 0061). Invokes the
// REAL route (impersonation guard, body parse, manager-OR-admin gate, the
// server-computed baseline, and the org-scoped archive-then-insert write)
// against a PGlite-backed db. Only appContext is mocked. This is the
// manager-vs-member authorization matrix: an admin OR a team manager succeeds; a
// plain member 403s (a manager holds Better Auth role "member").

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { POST as goalsPOST } from "@/app/api/goals/route";

let db: Db;
let orgId: string;
let teamId: string;
const ADMIN = "goal-admin";
const MEMBER = "goal-member";
const MANAGER = "goal-manager"; // manages a team — still Better Auth role "member"

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
  new Request("http://localhost/api/goals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const validBody = {
  metricSlug: "adoption",
  target: 75,
  reviewDate: "2026-08-31",
};

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "goal-org", kind: "team" })
    .returning();
  orgId = org.id;
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Admin", email: "admin@goal.example" },
    { id: MEMBER, name: "Member", email: "member@goal.example" },
    { id: MANAGER, name: "Manager", email: "manager@goal.example" },
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

describe("POST /api/goals — authorization", () => {
  it("401s when signed out", async () => {
    h.ctx = null;
    expect((await goalsPOST(jsonReq(validBody))).status).toBe(401);
  });

  it("a plain member (not a manager) gets 403 — no goal written", async () => {
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    const res = await goalsPOST(jsonReq(validBody));
    expect(res.status).toBe(403);
    expect(await forOrg(db, orgId).goals.getActive(null)).toBeUndefined();
  });

  it("a non-admin manager succeeds (a manager may set a goal)", async () => {
    h.ctx = ctxFor({ userId: MANAGER, role: "member" });
    const res = await goalsPOST(jsonReq(validBody));
    expect(res.status).toBe(200);
    const goal = (await res.json()) as {
      metricSlug: string;
      ownerUserId: string;
      status: string;
      baseline: number | null;
    };
    expect(goal.metricSlug).toBe("adoption");
    // Owner is the caller's own id, never a body field.
    expect(goal.ownerUserId).toBe(MANAGER);
    expect(goal.status).toBe("active");
  });

  it("403s while impersonating (a goal must be attributed to the real user)", async () => {
    h.ctx = ctxFor({ userId: ADMIN, impersonatedBy: "platform-admin" });
    expect((await goalsPOST(jsonReq(validBody))).status).toBe(403);
  });
});

describe("POST /api/goals — validation & honesty", () => {
  it("400s a metric outside the closed set (no free-form goal)", async () => {
    expect(
      (await goalsPOST(jsonReq({ ...validBody, metricSlug: "productivity" }))).status,
    ).toBe(400);
  });

  it("400s a non-real review date the regex would admit", async () => {
    // Month out of range (regex-shaped) …
    expect(
      (await goalsPOST(jsonReq({ ...validBody, reviewDate: "2026-13-40" }))).status,
    ).toBe(400);
    // … and an impossible DAY that Date.parse would silently roll over (V8
    // turns 2026-02-30 into Mar 2). Must 400, not 500 on the DB date column.
    expect(
      (await goalsPOST(jsonReq({ ...validBody, reviewDate: "2026-02-30" }))).status,
    ).toBe(400);
  });

  it("baseline is null when the metric is unmeasured (never fabricated)", async () => {
    // No scores seeded for this org yet → honest null, not 0.
    const res = await goalsPOST(jsonReq(validBody));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { baseline: number | null }).baseline).toBeNull();
  });

  it("baseline uses the SAME window-bounded selection as the dashboard (not the future month row)", async () => {
    const adoption = (await forOrg(db, orgId).scores.definitions()).find(
      (d) => d.slug === "adoption" && d.status === "active",
    )!;
    await forOrg(db, orgId).scores.upsertResults([
      // The trailing-28-day row the dashboard's KPI cards + goal "now" resolve
      // to. Anchored at today so it's included by the `to <= today` bound
      // regardless of the runner's clock (the setter reads `todayUtc()`).
      {
        definitionId: adoption.id,
        subjectLevel: "team",
        teamId,
        periodStart: todayUtc(),
        periodEnd: todayUtc(),
        periodGrain: "rolling_28d",
        value: 54.4,
        attribution: "account",
        components: {},
      },
      // The in-progress MONTH row carries a FUTURE periodEnd. A naive "max
      // periodEnd over all rows" would wrongly pick this (61) and contradict the
      // dashboard; the window bound must exclude it.
      {
        definitionId: adoption.id,
        subjectLevel: "team",
        teamId,
        periodStart: "2099-12-01",
        periodEnd: "2099-12-31",
        periodGrain: "month",
        value: 61,
        attribution: "account",
        components: {},
      },
    ]);
    const res = await goalsPOST(jsonReq(validBody));
    expect(res.status).toBe(200);
    // 54.4 (rolling_28d) rounds to 54 — NOT 61 (the excluded future month row).
    // The client never supplies baseline, so it can't be anchored to a
    // fabricated number either (invariant b).
    expect(((await res.json()) as { baseline: number | null }).baseline).toBe(54);
  });
});

describe("POST /api/goals — one active goal per scope", () => {
  it("setting a second goal archives the first (exactly one active)", async () => {
    h.ctx = ctxFor({ userId: MANAGER, role: "member" });
    await goalsPOST(jsonReq({ ...validBody, metricSlug: "adoption" }));
    await goalsPOST(jsonReq({ ...validBody, metricSlug: "fluency", target: 60 }));
    const all = await forOrg(db, orgId).goals.list();
    const active = all.filter((g) => g.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].metricSlug).toBe("fluency");
  });
});
