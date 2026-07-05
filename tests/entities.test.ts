import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { ensureOrgOfOne, forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  generatePseudonym,
  generateSuffixedPseudonym,
} from "../src/lib/pseudonym";
import { ensureSystemOrg } from "../src/poller/process";
import { SYSTEM_ORG_ID } from "../src/poller/messages";

// W0-C entity contracts: orgs kind/visibility/bootstrap, tracked people
// (pseudonymous by default), teams with composite tenant FKs, and the
// ensureOrgOfOne race fix. Real migrations against PGlite (rule 2).

let db: Db;
let userSeq = 0;

async function createAuthUser() {
  const id = `auth-user-${++userSeq}`;
  await db.insert(schema.user).values({
    id,
    name: `User ${userSeq}`,
    email: `user-${userSeq}@example.com`,
  });
  return { id, name: `User ${userSeq}`, email: `user-${userSeq}@example.com` };
}

async function orgsForUser(userId: string) {
  return db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.bootstrapUserId, userId));
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("ensureOrgOfOne (race fix)", () => {
  it("bootstraps a personal org of one with admin membership", async () => {
    const user = await createAuthUser();
    const membership = await ensureOrgOfOne(db, user);
    expect(membership.role).toBe("admin");

    const [org] = await orgsForUser(user.id);
    expect(org.id).toBe(membership.orgId);
    expect(org.kind).toBe("personal");
    expect(org.visibilityMode).toBe("private");
  });

  it("is idempotent — a second call returns the same org", async () => {
    const user = await createAuthUser();
    const first = await ensureOrgOfOne(db, user);
    const second = await ensureOrgOfOne(db, user);
    expect(second.orgId).toBe(first.orgId);
    expect(await orgsForUser(user.id)).toHaveLength(1);
  });

  it("converges to one org under concurrent invocation", async () => {
    const user = await createAuthUser();
    const results = await Promise.all([
      ensureOrgOfOne(db, user),
      ensureOrgOfOne(db, user),
      ensureOrgOfOne(db, user),
    ]);
    const orgIds = new Set(results.map((r) => r.orgId));
    expect(orgIds.size).toBe(1);
    expect(await orgsForUser(user.id)).toHaveLength(1);
  });

  it("makes a second bootstrap org unrepresentable (unique constraint)", async () => {
    const user = await createAuthUser();
    await ensureOrgOfOne(db, user);
    await expect(
      db
        .insert(schema.orgs)
        .values({ name: "dup", kind: "personal", bootstrapUserId: user.id }),
    ).rejects.toThrow();
  });
});

describe("system org", () => {
  it("is created with kind 'system'", async () => {
    await ensureSystemOrg(db);
    const [org] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, SYSTEM_ORG_ID));
    expect(org.kind).toBe("system");
  });
});

describe("people", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const [a] = await db
      .insert(schema.orgs)
      .values({ name: "people-org-a", kind: "team" })
      .returning();
    const [b] = await db
      .insert(schema.orgs)
      .values({ name: "people-org-b", kind: "team" })
      .returning();
    orgA = a.id;
    orgB = b.id;
  });

  it("auto-generates a pseudonym and stays org-scoped", async () => {
    const person = await forOrg(db, orgA).people.create();
    expect(person.orgId).toBe(orgA);
    expect(person.pseudonym).toMatch(/^[a-z]+-[a-z]+(-[0-9a-f]{4})?$/);
    expect(person.displayName).toBeNull();

    const bList = await forOrg(db, orgB).people.list();
    expect(bList.every((p) => p.orgId === orgB)).toBe(true);
    expect(bList.map((p) => p.id)).not.toContain(person.id);
  });

  it("lowercases emails and enforces per-org email uniqueness", async () => {
    const created = await forOrg(db, orgA).people.create({
      email: "Mixed.Case@Example.COM",
    });
    expect(created.email).toBe("mixed.case@example.com");

    await expect(
      forOrg(db, orgA).people.create({ email: "mixed.case@example.com" }),
    ).rejects.toThrow();
    // Same email in another org is fine — uniqueness is per org.
    const other = await forOrg(db, orgB).people.create({
      email: "mixed.case@example.com",
    });
    expect(other.orgId).toBe(orgB);
    // Multiple people without email are fine (partial unique index).
    await forOrg(db, orgA).people.create();
    await forOrg(db, orgA).people.create();
  });

  it("enforces per-org pseudonym uniqueness, not global", async () => {
    await forOrg(db, orgA).people.create({ pseudonym: "fixed-name" });
    await expect(
      forOrg(db, orgA).people.create({ pseudonym: "fixed-name" }),
    ).rejects.toThrow();
    const other = await forOrg(db, orgB).people.create({
      pseudonym: "fixed-name",
    });
    expect(other.pseudonym).toBe("fixed-name");
  });

  it("get() never crosses orgs", async () => {
    const person = await forOrg(db, orgA).people.create();
    expect(await forOrg(db, orgB).people.get(person.id)).toBeUndefined();
    expect((await forOrg(db, orgA).people.get(person.id))?.id).toBe(person.id);
  });
});

describe("teams (composite tenant FKs)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const [a] = await db
      .insert(schema.orgs)
      .values({ name: "teams-org-a", kind: "team" })
      .returning();
    const [b] = await db
      .insert(schema.orgs)
      .values({ name: "teams-org-b", kind: "team" })
      .returning();
    orgA = a.id;
    orgB = b.id;
  });

  it("adds same-org members and lists them", async () => {
    const scoped = forOrg(db, orgA);
    const team = await scoped.teams.create("platform");
    const person = await scoped.people.create({ displayName: "Ada" });
    await scoped.teams.addMember(team.id, person.id);

    const members = await scoped.teams.members(team.id);
    expect(members).toHaveLength(1);
    expect(members[0].personId).toBe(person.id);
    expect(members[0].displayName).toBe("Ada");
  });

  it("rejects cross-org membership at the DB level", async () => {
    const teamA = await forOrg(db, orgA).teams.create("cross-a");
    const personB = await forOrg(db, orgB).people.create();

    // Org A's scope naming org B's person: (org_a, person_b) has no anchor
    // row in people(org_id, id) — the composite FK rejects it.
    await expect(
      forOrg(db, orgA).teams.addMember(teamA.id, personB.id),
    ).rejects.toThrow();

    // Org B's scope naming org A's team fails the team-side composite FK.
    const personB2 = await forOrg(db, orgB).people.create();
    await expect(
      forOrg(db, orgB).teams.addMember(teamA.id, personB2.id),
    ).rejects.toThrow();
  });

  it("enforces per-org team-name uniqueness", async () => {
    await forOrg(db, orgA).teams.create("unique-name");
    await expect(forOrg(db, orgA).teams.create("unique-name")).rejects.toThrow();
    await forOrg(db, orgB).teams.create("unique-name");
  });
});

describe("pseudonym generator", () => {
  it("produces adjective-animal pairs", () => {
    expect(generatePseudonym()).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("is deterministic under a fixed rng", () => {
    expect(generatePseudonym(() => 0)).toBe(generatePseudonym(() => 0));
    expect(generatePseudonym(() => 0)).not.toBe(
      generatePseudonym(() => 0.999),
    );
  });

  it("suffixed variant appends 4 hex chars", () => {
    expect(generateSuffixedPseudonym()).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  });
});
