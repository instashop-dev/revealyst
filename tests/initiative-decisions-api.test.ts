import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Route-handler harness for the initiative DECISION LOG (TMD P3 tail, ADR 0063).
// Covers: lifecycle events auto-recorded on launch/complete/stop; owner-OR-admin
// authz on GET (read) + POST (add note); impersonation-blocked writes; author
// name resolution; append-only (chronological). Only appContext is mocked.

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/api-context", () => ({
  appContext: async () => h.ctx,
}));

import { POST as launchPOST } from "@/app/api/initiatives/route";
import { POST as reviewPOST } from "@/app/api/initiatives/[id]/review/route";
import {
  GET as decisionsGET,
  POST as decisionsPOST,
} from "@/app/api/initiatives/[id]/decisions/route";

let db: Db;
let orgId: string;
const OWNER = "dec-owner";
const OTHER = "dec-other"; // another manager, NOT the owner
const MEMBER = "dec-member";
const ADMIN = "dec-admin";

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

const req = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Launch through the real route so the `launched` decision is auto-recorded. */
async function launchViaRoute(): Promise<string> {
  const res = await launchPOST(
    req("http://localhost/api/initiatives", {
      title: "Ship it",
      scoreSlug: "fluency",
      target: 70,
      reviewDate: "2026-09-30",
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function readLog(id: string) {
  const res = await decisionsGET(new Request("http://localhost/x"), params(id));
  return { status: res.status, res };
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
  const [org] = await db
    .insert(schema.orgs)
    .values({ name: "dec-org", kind: "team" })
    .returning();
  orgId = org.id;
  await db.insert(schema.user).values([
    { id: OWNER, name: "Owner", email: "owner@dec.example" },
    { id: OTHER, name: "Other", email: "other@dec.example" },
    { id: MEMBER, name: "Member", email: "member@dec.example" },
    { id: ADMIN, name: "Admin", email: "admin@dec.example" },
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

describe("initiative decision log — lifecycle auto-recording", () => {
  it("launching opens the log with a `launched` entry, authored + named", async () => {
    const id = await launchViaRoute();
    const { status, res } = await readLog(id);
    expect(status).toBe(200);
    const body = (await res.json()) as {
      decisions: { event: string; note: string | null; authorName: string }[];
    };
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0].event).toBe("launched");
    expect(body.decisions[0].note).toBeNull();
    expect(body.decisions[0].authorName).toBe("Owner");
  });

  it("completing appends a `completed` entry after `launched` (chronological)", async () => {
    const id = await launchViaRoute();
    await reviewPOST(
      req("http://localhost/x", { action: "complete", outcome: "improved" }),
      params(id),
    );
    const { res } = await readLog(id);
    const body = (await res.json()) as { decisions: { event: string }[] };
    expect(body.decisions.map((d) => d.event)).toEqual([
      "launched",
      "completed",
    ]);
  });

  it("stopping appends a `stopped` entry", async () => {
    const id = await launchViaRoute();
    await reviewPOST(req("http://localhost/x", { action: "stop" }), params(id));
    const { res } = await readLog(id);
    const body = (await res.json()) as { decisions: { event: string }[] };
    expect(body.decisions.map((d) => d.event)).toEqual(["launched", "stopped"]);
  });
});

describe("initiative decision log — manager notes (POST)", () => {
  it("the owner adds a note; it appears after the launch entry", async () => {
    const id = await launchViaRoute();
    const post = await decisionsPOST(
      req("http://localhost/x", { note: "Kicked off with the team" }),
      params(id),
    );
    expect(post.status).toBe(200);
    const { res } = await readLog(id);
    const body = (await res.json()) as {
      decisions: { event: string; note: string | null }[];
    };
    expect(body.decisions.map((d) => d.event)).toEqual(["launched", "noted"]);
    expect(body.decisions[1].note).toBe("Kicked off with the team");
  });

  it("an admin may add a note to an initiative they don't own", async () => {
    const id = await launchViaRoute();
    h.ctx = ctxFor({ userId: ADMIN, role: "admin" });
    const post = await decisionsPOST(
      req("http://localhost/x", { note: "admin note" }),
      params(id),
    );
    expect(post.status).toBe(200);
  });

  it("a non-owner manager cannot add a note (403)", async () => {
    const id = await launchViaRoute();
    h.ctx = ctxFor({ userId: OTHER, role: "member" });
    const post = await decisionsPOST(
      req("http://localhost/x", { note: "nope" }),
      params(id),
    );
    expect(post.status).toBe(403);
  });

  it("a plain member cannot add a note (403)", async () => {
    const id = await launchViaRoute();
    h.ctx = ctxFor({ userId: MEMBER, role: "member" });
    expect(
      (
        await decisionsPOST(
          req("http://localhost/x", { note: "nope" }),
          params(id),
        )
      ).status,
    ).toBe(403);
  });

  it("403s adding a note while impersonating", async () => {
    const id = await launchViaRoute();
    h.ctx = ctxFor({ userId: OWNER, impersonatedBy: "platform-admin" });
    expect(
      (
        await decisionsPOST(
          req("http://localhost/x", { note: "impersonated" }),
          params(id),
        )
      ).status,
    ).toBe(403);
  });

  it("400s an empty note", async () => {
    const id = await launchViaRoute();
    expect(
      (await decisionsPOST(req("http://localhost/x", { note: "   " }), params(id)))
        .status,
    ).toBe(400);
  });
});

describe("initiative decision log — read authz", () => {
  it("a non-owner manager cannot read the log (403)", async () => {
    const id = await launchViaRoute();
    h.ctx = ctxFor({ userId: OTHER, role: "member" });
    expect((await readLog(id)).status).toBe(403);
  });

  it("an admin can read a log they don't own (200)", async () => {
    const id = await launchViaRoute();
    h.ctx = ctxFor({ userId: ADMIN, role: "admin" });
    expect((await readLog(id)).status).toBe(200);
  });

  it("404s an initiative from another org (never a cross-org leak)", async () => {
    const [orgB] = await db
      .insert(schema.orgs)
      .values({ name: "dec-org-b", kind: "team" })
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
    expect((await readLog(bInitiative.id)).status).toBe(404);
  });
});
