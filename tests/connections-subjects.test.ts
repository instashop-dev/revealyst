import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// W0-C connections/subjects/identities contracts: the discover() upsert
// key, shared-account M:N shape, and composite tenant FKs. Real migrations
// against PGlite (rule 2).

let db: Db;
let orgA: string;
let orgB: string;
let connA: string;
let connB: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db
    .insert(schema.orgs)
    .values({ name: "cs-org-a", kind: "team" })
    .returning();
  const [b] = await db
    .insert(schema.orgs)
    .values({ name: "cs-org-b", kind: "team" })
    .returning();
  orgA = a.id;
  orgB = b.id;

  connA = (
    await forOrg(db, orgA).connections.create({
      vendor: "anthropic_console",
      displayName: "Anthropic (A)",
      authKind: "admin_key",
    })
  ).id;
  connB = (
    await forOrg(db, orgB).connections.create({
      vendor: "cursor",
      displayName: "Cursor (B)",
      authKind: "api_key",
    })
  ).id;
});

describe("connections", () => {
  it("defaults to pending and stays org-scoped", async () => {
    const conn = await forOrg(db, orgA).connections.get(connA);
    expect(conn.status).toBe("pending");
    expect(conn.config).toEqual({});

    expect(await forOrg(db, orgB).connections.get(connA)).toBeUndefined();
    const listB = await forOrg(db, orgB).connections.list();
    expect(listB.map((c) => c.id)).not.toContain(connA);
  });

  it("setStatus updates only own-org connections", async () => {
    const updated = await forOrg(db, orgA).connections.setStatus(
      connA,
      "active",
    );
    expect(updated.status).toBe("active");
    expect(
      await forOrg(db, orgB).connections.setStatus(connA, "error", "nope"),
    ).toBeUndefined();
  });
});

describe("subjects (discover upsert)", () => {
  it("upserts idempotently on (connection, kind, external_id)", async () => {
    const scoped = forOrg(db, orgA);
    const [first] = await scoped.subjects.upsertMany(connA, [
      { kind: "person", externalId: "u-1", email: "First@Example.com" },
    ]);
    const [second] = await scoped.subjects.upsertMany(connA, [
      {
        kind: "person",
        externalId: "u-1",
        email: "First@Example.com",
        displayName: "First User",
      },
    ]);

    expect(second.id).toBe(first.id); // same row, not a duplicate
    expect(second.displayName).toBe("First User"); // mutable fields refreshed
    expect(second.email).toBe("first@example.com"); // lowercased
    expect(second.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      first.lastSeenAt.getTime(),
    );

    const rows = await db
      .select()
      .from(schema.subjects)
      .where(eq(schema.subjects.externalId, "u-1"));
    expect(rows).toHaveLength(1);
  });

  it("same external_id under different kinds are distinct subjects", async () => {
    const scoped = forOrg(db, orgA);
    const created = await scoped.subjects.upsertMany(connA, [
      { kind: "api_key", externalId: "dual-1" },
      { kind: "account", externalId: "dual-1" },
    ]);
    expect(new Set(created.map((s) => s.id)).size).toBe(2);
  });

  it("rejects a cross-org connection id (insert and update paths)", async () => {
    // Insert path: the ownership pre-check refuses org B's connection.
    await expect(
      forOrg(db, orgA).subjects.upsertMany(connB, [
        { kind: "person", externalId: "smuggled" },
      ]),
    ).rejects.toThrow(/not found in org/);

    // Update path: a conflicting (connection, kind, external_id) triple
    // reached from the wrong org must not rewrite the row (the ON CONFLICT
    // path never re-checks the composite FK — the pre-check + setWhere do).
    const [victim] = await forOrg(db, orgB).subjects.upsertMany(connB, [
      { kind: "person", externalId: "poison-target", email: "real@b.example" },
    ]);
    await expect(
      forOrg(db, orgA).subjects.upsertMany(connB, [
        { kind: "person", externalId: "poison-target", email: "evil@a.example" },
      ]),
    ).rejects.toThrow(/not found in org/);
    const after = await forOrg(db, orgB).subjects.get(victim.id);
    expect(after.email).toBe("real@b.example");
  });

  it("list/get never cross orgs", async () => {
    const [subj] = await forOrg(db, orgA).subjects.upsertMany(connA, [
      { kind: "person", externalId: "scoped-1" },
    ]);
    expect(await forOrg(db, orgB).subjects.get(subj.id)).toBeUndefined();
    const bList = await forOrg(db, orgB).subjects.list();
    expect(bList.map((s) => s.id)).not.toContain(subj.id);
  });
});

describe("identities (shared-account M:N)", () => {
  it("models a shared account as one subject with N identity rows", async () => {
    const scoped = forOrg(db, orgA);
    const [shared] = await scoped.subjects.upsertMany(connA, [
      { kind: "account", externalId: "shared-login" },
    ]);
    const alice = await scoped.people.create({ displayName: "Alice" });
    const bob = await scoped.people.create({ displayName: "Bob" });

    await scoped.identities.link(shared.id, alice.id, "manual");
    await scoped.identities.link(shared.id, bob.id, "email_match");
    // Idempotent: re-linking the same pair is a no-op.
    await scoped.identities.link(shared.id, alice.id, "manual");

    const links = await scoped.identities.forSubject(shared.id);
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.personId))).toEqual(
      new Set([alice.id, bob.id]),
    );

    // And one person can span multiple subjects (multi-tool person).
    const [second] = await scoped.subjects.upsertMany(connA, [
      { kind: "person", externalId: "alice-direct" },
    ]);
    await scoped.identities.link(second.id, alice.id, "vendor_asserted");
    expect(await scoped.identities.forPerson(alice.id)).toHaveLength(2);
  });

  it("rejects cross-org links at the DB level", async () => {
    const [subjA] = await forOrg(db, orgA).subjects.upsertMany(connA, [
      { kind: "person", externalId: "xorg-subject" },
    ]);
    const personB = await forOrg(db, orgB).people.create();

    // Subject from A, person from B — no scope can express this link.
    await expect(
      forOrg(db, orgA).identities.link(subjA.id, personB.id, "manual"),
    ).rejects.toThrow();
    await expect(
      forOrg(db, orgB).identities.link(subjA.id, personB.id, "manual"),
    ).rejects.toThrow();
  });

  it("unlink is scoped and cascade-deletes with the subject", async () => {
    const scoped = forOrg(db, orgA);
    const [subj] = await scoped.subjects.upsertMany(connA, [
      { kind: "person", externalId: "cascade-1" },
    ]);
    const person = await scoped.people.create();
    await scoped.identities.link(subj.id, person.id, "manual");

    await scoped.identities.unlink(subj.id, person.id);
    expect(await scoped.identities.forSubject(subj.id)).toHaveLength(0);
  });
});
