import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertDeletableAndPurgeOrg,
  hasCredentialAccount,
  missingFromPurgeTables,
} from "../src/db/account-deletion";
import type { Db } from "../src/db/client";
import { ensureOrgOfOne } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

let db: Db;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

let seq = 0;
/** Create a user + their bootstrap org-of-one; returns { userId, orgId }. */
async function makeUserWithOrg(name: string) {
  seq += 1;
  const id = `user-${seq}`;
  const email = `user-${seq}@example.com`;
  await db.insert(schema.user).values({ id, name, email });
  const membership = await ensureOrgOfOne(db, { id, name, email });
  return { userId: id, orgId: membership.orgId };
}

async function seedConnection(orgId: string) {
  const [conn] = await db
    .insert(schema.connections)
    .values({
      orgId,
      vendor: "openai",
      displayName: "Test connection",
      authKind: "api_key",
    })
    .returning();
  return conn;
}

describe("assertDeletableAndPurgeOrg — gates", () => {
  it("blocks deletion when the org has an active subscription", async () => {
    const { userId, orgId } = await makeUserWithOrg("Paid User");
    await db.insert(schema.subscriptions).values({
      orgId,
      paddleSubscriptionId: `sub-${orgId}`,
      status: "active",
      priceId: "pri_test",
      quantity: 3,
      paddleOccurredAt: new Date(),
    });

    await expect(assertDeletableAndPurgeOrg(db, userId)).rejects.toThrow(
      /subscription/i,
    );
    // Org still exists — nothing was purged.
    const [org] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId));
    expect(org).toBeDefined();
  });

  it("blocks deletion when the org has a PAUSED (resumable, not canceled) subscription", async () => {
    // ADR 0011: a paused subscription is resumable via Paddle's customer
    // portal, unlike a canceled one — deleting the org here would orphan a
    // billing relationship that can still come back to life with no org left.
    const { userId, orgId } = await makeUserWithOrg("Paused User");
    await db.insert(schema.subscriptions).values({
      orgId,
      paddleSubscriptionId: `sub-paused-${orgId}`,
      status: "paused",
      priceId: "pri_test",
      quantity: 1,
      paddleOccurredAt: new Date(),
    });

    await expect(assertDeletableAndPurgeOrg(db, userId)).rejects.toThrow(
      /subscription/i,
    );
    const [org] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId));
    expect(org).toBeDefined();
  });

  it("allows deletion when the org's only subscription is fully canceled", async () => {
    const { userId, orgId } = await makeUserWithOrg("Canceled User");
    await db.insert(schema.subscriptions).values({
      orgId,
      paddleSubscriptionId: `sub-canceled-${orgId}`,
      status: "canceled",
      priceId: "pri_test",
      quantity: 1,
      paddleOccurredAt: new Date(),
    });

    await assertDeletableAndPurgeOrg(db, userId);
    const [org] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId));
    expect(org).toBeUndefined();
  });

  it("blocks deletion when the org has other members", async () => {
    const { userId, orgId } = await makeUserWithOrg("Owner User");
    // A second auth user joins the workspace.
    await db
      .insert(schema.user)
      .values({ id: "second-member", name: "Second", email: "second@example.com" });
    await db
      .insert(schema.orgMembers)
      .values({ orgId, userId: "second-member", role: "member" });

    await expect(assertDeletableAndPurgeOrg(db, userId)).rejects.toThrow(
      /member|transfer/i,
    );
    const [org] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId));
    expect(org).toBeDefined();
  });

  it("no-ops when the user has no bootstrap org", async () => {
    await db
      .insert(schema.user)
      .values({ id: "no-org-user", name: "No Org", email: "noorg@example.com" });
    await expect(
      assertDeletableAndPurgeOrg(db, "no-org-user"),
    ).resolves.toBeUndefined();
  });
});

describe("assertDeletableAndPurgeOrg — purge", () => {
  it("removes the org and all its child rows, leaving other orgs untouched", async () => {
    const victim = await makeUserWithOrg("Victim User");
    const bystander = await makeUserWithOrg("Bystander User");

    // Seed org-scoped data on both orgs.
    const victimConn = await seedConnection(victim.orgId);
    const bystanderConn = await seedConnection(bystander.orgId);

    const [victimPerson] = await db
      .insert(schema.people)
      .values({ orgId: victim.orgId, pseudonym: "person-a" })
      .returning();
    const [victimSubject] = await db
      .insert(schema.subjects)
      .values({
        orgId: victim.orgId,
        connectionId: victimConn.id,
        kind: "person",
        externalId: "ext-1",
      })
      .returning();
    const [catalog] = await db
      .select({ key: schema.metricCatalog.key })
      .from(schema.metricCatalog)
      .limit(1);
    await db.insert(schema.metricRecords).values({
      orgId: victim.orgId,
      subjectId: victimSubject.id,
      metricKey: catalog.key,
      day: "2026-07-01",
      connectionId: victimConn.id,
      value: 5,
      attribution: "person",
      sourceConnector: "test@1",
    });

    await assertDeletableAndPurgeOrg(db, victim.userId);

    // Victim org + every child row is gone.
    const orgRows = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, victim.orgId));
    expect(orgRows).toHaveLength(0);
    for (const [label, rows] of [
      [
        "connections",
        await db
          .select()
          .from(schema.connections)
          .where(eq(schema.connections.orgId, victim.orgId)),
      ],
      [
        "people",
        await db
          .select()
          .from(schema.people)
          .where(eq(schema.people.orgId, victim.orgId)),
      ],
      [
        "metric_records",
        await db
          .select()
          .from(schema.metricRecords)
          .where(eq(schema.metricRecords.orgId, victim.orgId)),
      ],
      [
        "org_members",
        await db
          .select()
          .from(schema.orgMembers)
          .where(eq(schema.orgMembers.orgId, victim.orgId)),
      ],
    ] as const) {
      expect(rows, `${label} should be empty`).toHaveLength(0);
    }

    // Bystander org is fully intact — isolation.
    const [byOrg] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, bystander.orgId));
    expect(byOrg).toBeDefined();
    const byConn = await db
      .select()
      .from(schema.connections)
      .where(
        and(
          eq(schema.connections.orgId, bystander.orgId),
          eq(schema.connections.id, bystanderConn.id),
        ),
      );
    expect(byConn).toHaveLength(1);
    // Global reference data survives (never org-scoped).
    const catalogAfter = await db.select().from(schema.metricCatalog).limit(1);
    expect(catalogAfter.length).toBeGreaterThan(0);
  });
});

describe("hasCredentialAccount", () => {
  it("is true for a user with an email+password credential", async () => {
    const { userId } = await makeUserWithOrg("Credential User");
    await db.insert(schema.account).values({
      id: `account-${userId}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: "hashed-password",
    });
    expect(await hasCredentialAccount(db, userId)).toBe(true);
  });

  it("is false for a GitHub-OAuth-only user (no password credential)", async () => {
    const { userId } = await makeUserWithOrg("OAuth User");
    await db.insert(schema.account).values({
      id: `account-${userId}`,
      accountId: "gh-12345",
      providerId: "github",
      userId,
    });
    expect(await hasCredentialAccount(db, userId)).toBe(false);
  });

  it("is false for a user with no linked accounts at all", async () => {
    const { userId } = await makeUserWithOrg("No Account User");
    expect(await hasCredentialAccount(db, userId)).toBe(false);
  });
});

describe("purge-table completeness (tripwire)", () => {
  it("PURGE_TABLES covers every org-scoped table in schema.ts", () => {
    // Mirrors tests/tenant-isolation.test.ts's completeness sweep: a table
    // added to schema.ts later without a matching account-deletion.ts entry
    // would otherwise either dangle an FK on delete or silently survive
    // account deletion.
    const missing = missingFromPurgeTables(schema);
    expect(missing, `org-scoped tables missing from PURGE_TABLES: ${missing.join(", ")}`).toEqual([]);
  });
});
