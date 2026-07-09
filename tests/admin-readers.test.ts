import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  listUsersForAdmin,
  platformAuditList,
  userDetailForAdmin,
} from "../src/db/admin";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import * as schema from "../src/db/schema";

// Platform-admin cross-org data-layer readers (ADR 0016, Features 4/5/7).
// Seeds two ordinary orgs + one system org (to prove system-org exclusion),
// several users with varying platform-admin/ban/plan/org-kind combinations,
// connections, and audit rows spanning both orgs.

let db: Db;

// Orgs
let orgTeam: { id: string; name: string };
let orgPersonal: { id: string; name: string };

// Users
let alice: { id: string }; // platform admin, orgTeam admin
let bob: { id: string }; // orgTeam member
let carol: { id: string }; // banned, orgPersonal admin
let dave: { id: string }; // no org membership at all
let multi: { id: string }; // member of orgPersonal THEN (later) orgTeam

// Connections
let conn1: { id: string }; // orgTeam, active
let conn2: { id: string }; // orgTeam, error
let conn3: { id: string }; // orgPersonal, pending

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;

  orgTeam = await createFixtureOrg(db, "Team Org", "team");
  orgPersonal = await createFixtureOrg(db, "Personal Org", "personal");
  // The internal system org (audit-log home) must never surface as a user's
  // "current org" in the admin list/detail views.
  await db.insert(schema.orgs).values({ name: "System", kind: "system" });

  [alice] = await db
    .insert(schema.user)
    .values({
      id: "u-alice",
      name: "Alice Admin",
      email: "alice@example.com",
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  [bob] = await db
    .insert(schema.user)
    .values({
      id: "u-bob",
      name: "Bob Member",
      email: "bob@example.com",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    })
    .returning();
  [carol] = await db
    .insert(schema.user)
    .values({
      id: "u-carol",
      name: "Carol Owner",
      email: "carol@example.com",
      banned: true,
      banReason: "abuse",
      banExpires: new Date("2099-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-03T00:00:00Z"),
    })
    .returning();
  [dave] = await db
    .insert(schema.user)
    .values({
      id: "u-dave",
      name: "Dave Orphan",
      email: "dave@example.com",
      createdAt: new Date("2026-01-04T00:00:00Z"),
    })
    .returning();
  [multi] = await db
    .insert(schema.user)
    .values({
      id: "u-multi",
      name: "Multi Org",
      email: "multi@example.com",
      createdAt: new Date("2026-01-05T00:00:00Z"),
    })
    .returning();

  await db.insert(schema.orgMembers).values([
    { orgId: orgTeam.id, userId: alice.id, role: "admin" },
    { orgId: orgTeam.id, userId: bob.id, role: "member" },
    { orgId: orgPersonal.id, userId: carol.id, role: "admin" },
  ]);
  // multi: personal membership first, team membership strictly later — the
  // "most recent membership wins" rule (ADR 0004) must show orgTeam.
  await db.insert(schema.orgMembers).values({
    orgId: orgPersonal.id,
    userId: multi.id,
    role: "member",
    createdAt: new Date("2026-02-01T00:00:00Z"),
  });
  await db.insert(schema.orgMembers).values({
    orgId: orgTeam.id,
    userId: multi.id,
    role: "member",
    createdAt: new Date("2026-02-02T00:00:00Z"),
  });

  // orgTeam is entitled (Team plan); orgPersonal has no subscription row at
  // all (free).
  await db.insert(schema.subscriptions).values({
    orgId: orgTeam.id,
    paddleSubscriptionId: "sub_team_1",
    paddleCustomerId: "cus_1",
    status: "active",
    priceId: "pri_team",
    quantity: 3,
    paddleOccurredAt: new Date("2026-01-10T00:00:00Z"),
  });

  [conn1] = await db
    .insert(schema.connections)
    .values({
      orgId: orgTeam.id,
      vendor: "github_copilot",
      displayName: "GH Copilot",
      status: "active",
      authKind: "github_app",
      lastSuccessAt: new Date("2026-07-01T00:00:00Z"),
    })
    .returning();
  [conn2] = await db
    .insert(schema.connections)
    .values({
      orgId: orgTeam.id,
      vendor: "openai",
      displayName: "OpenAI Admin",
      status: "error",
      authKind: "admin_key",
      lastError: "401 unauthorized",
    })
    .returning();
  [conn3] = await db
    .insert(schema.connections)
    .values({
      orgId: orgPersonal.id,
      vendor: "cursor",
      displayName: "Cursor",
      status: "pending",
      authKind: "api_key",
    })
    .returning();

  // Tracked-user fixture for orgTeam: one identity-resolved person active
  // today, via conn1.
  const [person] = await db
    .insert(schema.people)
    .values({ orgId: orgTeam.id, pseudonym: "person-1" })
    .returning();
  const [subject] = await db
    .insert(schema.subjects)
    .values({
      orgId: orgTeam.id,
      connectionId: conn1.id,
      kind: "person",
      externalId: "ext-1",
    })
    .returning();
  await db.insert(schema.identities).values({
    orgId: orgTeam.id,
    subjectId: subject.id,
    personId: person.id,
    method: "manual",
  });
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(schema.metricRecords).values({
    orgId: orgTeam.id,
    subjectId: subject.id,
    metricKey: "active_day",
    day: today,
    connectionId: conn1.id,
    value: 1,
    attribution: "person",
    sourceConnector: "test@1",
  });

  // Audit rows spanning both orgs, for the platform audit viewer.
  const auditSeed: Array<{
    orgId: string;
    actorUserId: string | null;
    action: string;
    targetKind: string;
    targetId?: string;
    createdAt: Date;
  }> = [
    {
      orgId: orgTeam.id,
      actorUserId: alice.id,
      action: "connection.create",
      targetKind: "connection",
      targetId: conn1.id,
      createdAt: new Date("2026-07-01T10:00:00Z"),
    },
    {
      orgId: orgTeam.id,
      actorUserId: bob.id,
      action: "identity.unlink",
      targetKind: "identity",
      targetId: subject.id,
      createdAt: new Date("2026-07-02T10:00:00Z"),
    },
    {
      orgId: orgPersonal.id,
      actorUserId: carol.id,
      action: "team.create",
      targetKind: "team",
      targetId: "t-1",
      createdAt: new Date("2026-07-03T10:00:00Z"),
    },
    {
      orgId: orgTeam.id,
      actorUserId: alice.id,
      action: "identity.link",
      targetKind: "identity",
      targetId: subject.id,
      createdAt: new Date("2026-07-04T10:00:00Z"),
    },
    {
      orgId: orgPersonal.id,
      actorUserId: null,
      action: "connection.pause",
      targetKind: "connection",
      targetId: conn3.id,
      createdAt: new Date("2026-07-05T10:00:00Z"),
    },
    // Same-timestamp tie, to exercise the compound cursor.
    {
      orgId: orgTeam.id,
      actorUserId: alice.id,
      action: "connection.pause",
      targetKind: "connection",
      targetId: conn2.id,
      createdAt: new Date("2026-07-06T10:00:00Z"),
    },
    {
      orgId: orgTeam.id,
      actorUserId: bob.id,
      action: "connection.resume",
      targetKind: "connection",
      targetId: conn2.id,
      createdAt: new Date("2026-07-06T10:00:00Z"),
    },
  ];
  for (const row of auditSeed) {
    await db.insert(schema.auditLog).values(row);
  }

  // Extra users (all orgTeam members) for pagination/limit-clamp coverage.
  for (let i = 0; i < 4; i++) {
    const [u] = await db
      .insert(schema.user)
      .values({
        id: `u-extra-${i}`,
        name: `Extra User ${i}`,
        email: `extra${i}@example.com`,
        createdAt: new Date(`2026-01-1${i}T00:00:00Z`),
      })
      .returning();
    await db.insert(schema.orgMembers).values({
      orgId: orgTeam.id,
      userId: u.id,
      role: "member",
    });
  }
});

describe("listUsersForAdmin", () => {
  it("search matches email and name (case-insensitive)", async () => {
    const byEmail = await listUsersForAdmin(db, { search: "ALICE@example" });
    expect(byEmail.rows.map((r) => r.id)).toEqual([alice.id]);

    const byName = await listUsersForAdmin(db, { search: "carol owner" });
    expect(byName.rows.map((r) => r.id)).toEqual([carol.id]);
  });

  it("joins the MOST RECENT non-system membership (ADR 0004 rule)", async () => {
    const { rows } = await listUsersForAdmin(db, { search: "multi@example" });
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(orgTeam.id);
    expect(rows[0].orgKind).toBe("team");
  });

  it("returns 'none' plan and null org fields for a user with no org", async () => {
    const { rows } = await listUsersForAdmin(db, { search: "dave@example" });
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBeNull();
    expect(rows[0].orgName).toBeNull();
    expect(rows[0].orgKind).toBeNull();
    expect(rows[0].orgRole).toBeNull();
    expect(rows[0].plan).toBe("none");
  });

  it("derives platformAdmin from user.role and plan from the entitlement", async () => {
    const { rows: aliceRows } = await listUsersForAdmin(db, {
      search: "alice@example",
    });
    expect(aliceRows[0].platformAdmin).toBe(true);
    expect(aliceRows[0].plan).toBe("active");

    const { rows: carolRows } = await listUsersForAdmin(db, {
      search: "carol@example",
    });
    expect(carolRows[0].platformAdmin).toBe(false);
    expect(carolRows[0].plan).toBe("free");
  });

  it("filters by banned", async () => {
    const banned = await listUsersForAdmin(db, { filter: { banned: true } });
    expect(banned.rows.map((r) => r.id)).toEqual([carol.id]);

    const notBanned = await listUsersForAdmin(db, {
      filter: { banned: false },
      limit: 100,
    });
    expect(notBanned.rows.some((r) => r.id === carol.id)).toBe(false);
    expect(notBanned.rows.some((r) => r.id === alice.id)).toBe(true);
  });

  it("filters by platformAdmin", async () => {
    const admins = await listUsersForAdmin(db, {
      filter: { platformAdmin: true },
    });
    expect(admins.rows.map((r) => r.id)).toEqual([alice.id]);
  });

  it("filters by orgKind", async () => {
    const team = await listUsersForAdmin(db, {
      filter: { orgKind: "team" },
      limit: 100,
    });
    expect(team.rows.every((r) => r.orgKind === "team")).toBe(true);
    expect(team.rows.some((r) => r.id === carol.id)).toBe(false);

    const personal = await listUsersForAdmin(db, {
      filter: { orgKind: "personal" },
      limit: 100,
    });
    expect(personal.rows.map((r) => r.id)).toEqual([carol.id]);
  });

  it("filters by plan (active / free / none)", async () => {
    const active = await listUsersForAdmin(db, {
      filter: { plan: "active" },
      limit: 100,
    });
    expect(active.rows.some((r) => r.id === alice.id)).toBe(true);
    expect(active.rows.some((r) => r.id === carol.id)).toBe(false);
    expect(active.rows.some((r) => r.id === dave.id)).toBe(false);

    const free = await listUsersForAdmin(db, { filter: { plan: "free" } });
    expect(free.rows.map((r) => r.id)).toEqual([carol.id]);

    const none = await listUsersForAdmin(db, { filter: { plan: "none" } });
    expect(none.rows.map((r) => r.id)).toEqual([dave.id]);
  });

  it("sorts by the allowlisted column + direction, with a stable tiebreak", async () => {
    const first = await listUsersForAdmin(db, {
      sort: "name",
      sortDir: "asc",
      limit: 100,
    });
    const second = await listUsersForAdmin(db, {
      sort: "name",
      sortDir: "asc",
      limit: 100,
    });
    // Same query twice must yield the exact same order (stable tiebreak).
    expect(first.rows.map((r) => r.id)).toEqual(second.rows.map((r) => r.id));
    const names = first.rows.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("paginates: total counts all matches, page respects limit/offset", async () => {
    const all = await listUsersForAdmin(db, { limit: 100 });
    expect(all.total).toBe(all.rows.length);
    expect(all.total).toBeGreaterThanOrEqual(9); // alice/bob/carol/dave/multi + 4 extras

    const page1 = await listUsersForAdmin(db, {
      sort: "email",
      sortDir: "asc",
      limit: 3,
      offset: 0,
    });
    const page2 = await listUsersForAdmin(db, {
      sort: "email",
      sortDir: "asc",
      limit: 3,
      offset: 3,
    });
    expect(page1.total).toBe(all.total);
    expect(page2.total).toBe(all.total);
    expect(page1.rows).toHaveLength(3);
    expect(page2.rows).toHaveLength(3);
    // No overlap between consecutive pages.
    const ids1 = new Set(page1.rows.map((r) => r.id));
    for (const row of page2.rows) {
      expect(ids1.has(row.id)).toBe(false);
    }
  });

  it("clamps limit to <= 100 and defaults to 25", async () => {
    const clamped = await listUsersForAdmin(db, { limit: 500 });
    expect(clamped.rows.length).toBeLessThanOrEqual(100);

    const defaulted = await listUsersForAdmin(db, {});
    expect(defaulted.rows.length).toBeLessThanOrEqual(25);
  });
});

describe("userDetailForAdmin", () => {
  it("returns null for an unknown id", async () => {
    expect(await userDetailForAdmin(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("assembles memberships, entitlement, tracked users, connections, and actor audit", async () => {
    const detail = await userDetailForAdmin(db, alice.id);
    expect(detail).not.toBeNull();
    expect(detail?.platformAdmin).toBe(true);
    expect(detail?.banned).toBe(false);

    expect(detail?.memberships).toHaveLength(1);
    const membership = detail?.memberships[0];
    expect(membership?.orgId).toBe(orgTeam.id);
    expect(membership?.orgKind).toBe("team");
    expect(membership?.role).toBe("admin");
    expect(membership?.plan).toBe("active");
    expect(membership?.trackedUsers).toBe(1);

    const vendors = detail?.connections.map((c) => c.vendor).sort();
    expect(vendors).toEqual(["github_copilot", "openai"]);
    const errored = detail?.connections.find((c) => c.vendor === "openai");
    expect(errored?.status).toBe("error");
    expect(errored?.lastError).toBe("401 unauthorized");
    // No credential material anywhere on the connection rows.
    for (const conn of detail?.connections ?? []) {
      expect(conn).not.toHaveProperty("ciphertextB64");
      expect(conn).not.toHaveProperty("config");
    }

    // Alice authored 3 audit rows (connection.create, identity.link,
    // connection.pause), all in orgTeam, newest-first.
    expect(detail?.recentAudit.length).toBeGreaterThanOrEqual(3);
    expect(detail?.recentAudit.every((a) => a.orgId === orgTeam.id)).toBe(
      true,
    );
    const actions = detail?.recentAudit.map((a) => a.action);
    expect(actions?.[0]).toBe("connection.pause"); // newest
    for (let i = 1; i < (actions?.length ?? 0); i++) {
      expect(
        detail!.recentAudit[i - 1].createdAt.getTime(),
      ).toBeGreaterThanOrEqual(detail!.recentAudit[i].createdAt.getTime());
    }
  });

  it("reflects the free entitlement and zero tracked users for a personal org", async () => {
    const detail = await userDetailForAdmin(db, carol.id);
    expect(detail?.memberships).toHaveLength(1);
    expect(detail?.memberships[0].plan).toBe("free");
    expect(detail?.memberships[0].trackedUsers).toBe(0);
    expect(detail?.banned).toBe(true);
    expect(detail?.banReason).toBe("abuse");
  });

  it("returns an empty memberships/connections shape for an orphaned user", async () => {
    const detail = await userDetailForAdmin(db, dave.id);
    expect(detail?.memberships).toEqual([]);
    expect(detail?.connections).toEqual([]);
  });
});

describe("platformAuditList", () => {
  it("is a cross-org read, newest-first", async () => {
    const rows = await platformAuditList(db, { limit: 200 });
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(new Set(rows.map((r) => r.orgId)).size).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        rows[i].createdAt.getTime(),
      );
    }
  });

  it("filters by orgId, actorUserId, and action prefix", async () => {
    const byOrg = await platformAuditList(db, { orgId: orgPersonal.id });
    expect(byOrg.every((r) => r.orgId === orgPersonal.id)).toBe(true);
    expect(byOrg.length).toBe(2);

    const byActor = await platformAuditList(db, { actorUserId: bob.id });
    expect(byActor.every((r) => r.actorUserId === bob.id)).toBe(true);
    expect(byActor.length).toBe(2);

    const byAction = await platformAuditList(db, { action: "identity." });
    expect(
      byAction.every((r) => r.action.startsWith("identity.")),
    ).toBe(true);
    expect(byAction.length).toBe(2);
  });

  it("joins actor email and org name", async () => {
    const rows = await platformAuditList(db, {
      actorUserId: alice.id,
      limit: 1,
    });
    expect(rows[0].actorEmail).toBe("alice@example.com");
    expect(rows[0].orgName).toBe(orgTeam.name);
  });

  it("null actor (machine/deleted-user row) carries a null actorEmail", async () => {
    const rows = await platformAuditList(db, { action: "connection.pause" });
    const machineRow = rows.find((r) => r.actorUserId === null);
    expect(machineRow).toBeDefined();
    expect(machineRow?.actorEmail).toBeNull();
  });

  it("compound-cursor paging returns every row exactly once, incl. timestamp ties", async () => {
    const all = await platformAuditList(db, { limit: 200 });

    const seen: string[] = [];
    let cursor: { before?: Date; beforeId?: string } = {};
    for (let hops = 0; hops < 20; hops++) {
      const page = await platformAuditList(db, { limit: 2, ...cursor });
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.id));
      const last = page[page.length - 1];
      cursor = { before: last.createdAt, beforeId: last.id };
    }
    expect(seen).toEqual(all.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("clamps limit to <= 200 and defaults to 50", async () => {
    const clamped = await platformAuditList(db, { limit: 5000 });
    expect(clamped.length).toBeLessThanOrEqual(200);
  });
});
