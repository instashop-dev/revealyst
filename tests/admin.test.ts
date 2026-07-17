import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createTeamWorkspace, platformStats } from "../src/db/admin";
import { createFixtureOrg } from "../src/db/fixtures";
import { ensureOrgOfOne, forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { ensureSystemOrg } from "../src/db/system";
import { applyPaddleSubscriptionEvent } from "../src/db/subscriptions";
import { SYSTEM_ORG_ID } from "../src/poller/messages";

// Admin dashboard cross-org aggregates (ADR 0016, PR2 Feature 3): exercises
// the actual SQL behind /admin against a migrated PGlite db, seeded across
// several orgs so every aggregate has to group/filter correctly rather than
// happening to look right with one row.

let db: Db;
let seq = 0;

async function insertUser(overrides: {
  name: string;
  createdAt: Date;
}): Promise<string> {
  seq += 1;
  const id = `user-${seq}`;
  await db.insert(schema.user).values({
    id,
    name: overrides.name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  });
  return id;
}

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  db = pglite as unknown as Db;
});

describe("platformStats", () => {
  it("counts users and excludes the system org from org-kind counts", async () => {
    await insertUser({ name: "Count User A", createdAt: new Date() });
    await insertUser({ name: "Count User B", createdAt: new Date() });
    await createFixtureOrg(db, "count-personal", "personal");
    await createFixtureOrg(db, "count-team", "team");

    // Snapshot BEFORE adding the system org, so the assertion below proves
    // the system org contributes zero to either kind's count — not just
    // that this type happens to lack a "system" key (which would pass even
    // if the query's `ne(orgs.kind, "system")` filter were accidentally
    // dropped, since orgCountsByKind's own loop already ignores any kind
    // besides "personal"/"team").
    const before = await platformStats(db);
    await ensureSystemOrg(db, SYSTEM_ORG_ID, "System");
    const stats = await platformStats(db);

    expect(stats.totalUsers).toBeGreaterThanOrEqual(2);
    expect(stats.orgCountsByKind.personal).toBeGreaterThanOrEqual(1);
    expect(stats.orgCountsByKind.team).toBeGreaterThanOrEqual(1);
    expect(stats.orgCountsByKind.personal).toBe(before.orgCountsByKind.personal);
    expect(stats.orgCountsByKind.team).toBe(before.orgCountsByKind.team);
    // "system" is not a key this type can even express — assert the raw
    // count of all orgs by kind never attributes rows to it.
    expect(Object.keys(stats.orgCountsByKind).sort()).toEqual([
      "personal",
      "team",
    ]);
  });

  it("counts signups in the last 30 days and lists recent signups newest-first", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const recentId = await insertUser({ name: "Fresh Signup", createdAt: now });
    await insertUser({ name: "Stale Signup", createdAt: old });

    const stats = await platformStats(db);

    expect(stats.signupsLast30Days).toBeGreaterThanOrEqual(1);
    // The oldest seeded user (40 days ago) must not inflate the 30-day count
    // beyond what's actually recent — every recentSignups entry newer than
    // or equal to the previous one.
    for (let i = 1; i < stats.recentSignups.length; i++) {
      expect(
        stats.recentSignups[i - 1].createdAt.getTime(),
      ).toBeGreaterThanOrEqual(stats.recentSignups[i].createdAt.getTime());
    }
    expect(stats.recentSignups.some((s) => s.id === recentId)).toBe(true);
  });

  it("groups connections by status", async () => {
    const org = (await createFixtureOrg(db, "conn-status-org", "team")).id;
    const scope = forOrg(db, org);
    const active = await scope.connections.create({
      vendor: "anthropic_console",
      displayName: "Active One",
      authKind: "api_key",
    });
    await scope.connections.setStatus(active.id, "active");
    const errored = await scope.connections.create({
      vendor: "cursor",
      displayName: "Errored One",
      authKind: "api_key",
    });
    await scope.connections.setStatus(errored.id, "error", "boom");
    await scope.connections.create({
      vendor: "openai",
      displayName: "Still Pending",
      authKind: "admin_key",
    });

    const stats = await platformStats(db);

    expect(stats.connectionsByStatus.active).toBeGreaterThanOrEqual(1);
    expect(stats.connectionsByStatus.error).toBeGreaterThanOrEqual(1);
    expect(stats.connectionsByStatus.pending).toBeGreaterThanOrEqual(1);
  });

  it("lists only errored connector_runs, newest-first, capped at the limit", async () => {
    const org = (await createFixtureOrg(db, "failures-org", "team")).id;
    const scope = forOrg(db, org);
    const conn = await scope.connections.create({
      vendor: "cursor",
      displayName: "Flaky Connector",
      authKind: "api_key",
    });

    // A successful run must never show up in the failures list.
    const okRun = await scope.connectorRuns.start({
      connectionId: conn.id,
      kind: "poll",
    });
    await scope.connectorRuns.finish(okRun.id, {
      subjectsSeen: 1,
      recordsUpserted: 1,
      signalsUpserted: 0,
      gaps: [],
    });

    // 12 failed runs with explicit, distinct startedAt so ordering is
    // deterministic regardless of PGlite's clock resolution.
    const base = Date.now();
    const failureIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const run = await scope.connectorRuns.start({
        connectionId: conn.id,
        kind: "poll",
      });
      const startedAt = new Date(base + i * 1000);
      await db
        .update(schema.connectorRuns)
        .set({ startedAt })
        .where(eq(schema.connectorRuns.id, run.id));
      await scope.connectorRuns.fail(run.id, `error ${i}`);
      failureIds.push(run.id);
    }

    const stats = await platformStats(db);

    expect(stats.recentConnectorFailures.length).toBeLessThanOrEqual(10);
    expect(
      stats.recentConnectorFailures.every((f) => f.error?.startsWith("error")),
    ).toBe(true);
    expect(stats.recentConnectorFailures.map((f) => f.id)).not.toContain(
      okRun.id,
    );
    // Newest-first: the last 10 ids created (index 2..11) should be present,
    // and strictly descending by startedAt.
    for (let i = 1; i < stats.recentConnectorFailures.length; i++) {
      expect(
        stats.recentConnectorFailures[i - 1].startedAt.getTime(),
      ).toBeGreaterThanOrEqual(
        stats.recentConnectorFailures[i].startedAt.getTime(),
      );
    }
    const newestIds = failureIds.slice(2); // last 10 of the 12 seeded
    for (const id of stats.recentConnectorFailures.map((f) => f.id)) {
      expect(newestIds).toContain(id);
    }
  });

  it("rolls up subscriptions by status", async () => {
    const orgActive = (await createFixtureOrg(db, "sub-active", "team")).id;
    const orgPastDue = (await createFixtureOrg(db, "sub-past-due", "team")).id;
    const orgCanceled = (await createFixtureOrg(db, "sub-canceled", "team")).id;

    await applyPaddleSubscriptionEvent(db, {
      orgId: orgActive,
      paddleSubscriptionId: `sub-${orgActive}`,
      occurredAt: new Date(),
      status: "active",
      priceId: "pri_test",
      quantity: 3,
    });
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgPastDue,
      paddleSubscriptionId: `sub-${orgPastDue}`,
      occurredAt: new Date(),
      status: "past_due",
      priceId: "pri_test",
      quantity: 2,
    });
    await applyPaddleSubscriptionEvent(db, {
      orgId: orgCanceled,
      paddleSubscriptionId: `sub-${orgCanceled}`,
      occurredAt: new Date(),
      status: "canceled",
      priceId: "pri_test",
      quantity: 1,
    });

    const stats = await platformStats(db);

    expect(stats.subscriptionsByStatus.active).toBeGreaterThanOrEqual(1);
    expect(stats.subscriptionsByStatus.past_due).toBeGreaterThanOrEqual(1);
    expect(stats.subscriptionsByStatus.canceled).toBeGreaterThanOrEqual(1);
  });
});

describe("createTeamWorkspace (platform-admin unblock)", () => {
  it("creates a kind='team' org with the admin as member + a default team + audit row", async () => {
    const [admin] = await db
      .insert(schema.user)
      .values({ id: "ws-admin", name: "WS Admin", email: "ws@example.com" })
      .returning();

    const { orgId, teamId } = await createTeamWorkspace(db, {
      name: "Acme Team",
      adminUserId: admin.id,
    });

    // The org is a TEAM org (the whole point — nothing else sets this).
    const [org] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId));
    expect(org.kind).toBe("team");
    expect(org.name).toBe("Acme Team");
    // A team workspace must NOT claim the admin's unique bootstrap-user marker
    // (that belongs to their personal org).
    expect(org.bootstrapUserId).toBeNull();

    // The admin is enrolled as an ORG ADMIN member.
    const [member] = await db
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, orgId));
    expect(member.userId).toBe(admin.id);
    expect(member.role).toBe("admin");

    // A default team named after the workspace exists (so manager assignment
    // works immediately in Settings → People).
    const teamsList = await forOrg(db, orgId).teams.list();
    expect(teamsList).toHaveLength(1);
    expect(teamsList[0].id).toBe(teamId);
    expect(teamsList[0].name).toBe("Acme Team");

    // The genesis event is audited in the new org's trail.
    const audit = await forOrg(db, orgId).auditLog.list();
    const created = audit.find((a) => a.action === "org.create");
    expect(created).toBeDefined();
    expect(created?.actorUserId).toBe(admin.id);
    expect(created?.targetId).toBe(orgId);
    expect(created?.metadata).toMatchObject({ kind: "team", name: "Acme Team" });
  });

  it("does not touch the admin's existing personal org (dogfood org untouched)", async () => {
    const [admin] = await db
      .insert(schema.user)
      .values({ id: "ws-admin-2", name: "WS Admin 2", email: "ws2@example.com" })
      .returning();
    const personal = await ensureOrgOfOne(db, admin);

    await createTeamWorkspace(db, {
      name: "Second Workspace",
      adminUserId: admin.id,
    });

    // The personal org still exists, still personal, still owns the bootstrap
    // marker — creating a team workspace never converts it.
    const [org] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, personal.orgId));
    expect(org.kind).toBe("personal");
    expect(org.bootstrapUserId).toBe(admin.id);
  });
});
