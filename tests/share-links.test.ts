import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { benchmarkConsentForOrg } from "../src/db/benchmark-consent";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { resolveShareToken, shareLinksForOrg } from "../src/db/share-links";
import { resolveShareCard } from "../src/lib/share-card";

// W2-H PR5 (ADR 0008): opt-in public share links + anonymized-benchmark
// consent — lifecycle, the capability-token public read, and org isolation.

let db: Db;
let orgA: string;
let orgB: string;
let personA: string;
let personB: string;
let userA: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgA = (await createFixtureOrg(db, "share-a", "personal")).id;
  orgB = (await createFixtureOrg(db, "share-b", "personal")).id;
  personA = (await forOrg(db, orgA).people.create({ displayName: "Ada" })).id;
  personB = (await forOrg(db, orgB).people.create({ displayName: "Bo" })).id;
  const [u] = await db
    .insert(schema.user)
    .values({ id: "share-user-a", name: "Ada", email: "ada@example.com" })
    .returning();
  userA = u.id;
});

describe("share links (opt-in public card)", () => {
  it("mints a link, resolves the token to a minimal projection, and lists it", async () => {
    const { link, token } = await shareLinksForOrg(db, orgA).create({
      personId: personA,
      scoreSlug: "fluency",
      publicLabel: "Ada F.",
      createdByUserId: userA,
    });
    expect(token).toBeTruthy();

    const resolved = await resolveShareToken(db, token);
    expect(resolved).toEqual({
      orgId: orgA,
      personId: personA,
      scoreSlug: "fluency",
      publicLabel: "Ada F.",
    });
    // Minimal projection: no token/hash/email leak.
    expect(JSON.stringify(resolved)).not.toContain(token);

    const listed = await shareLinksForOrg(db, orgA).list();
    expect(listed.some((l) => l.id === link.id)).toBe(true);
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveShareToken(db, "not-a-real-token")).toBeNull();
  });

  it("revokes: the URL 404s (null) and the link drops from the active list", async () => {
    const { link, token } = await shareLinksForOrg(db, orgA).create({
      personId: personA,
      scoreSlug: "adoption",
      publicLabel: "Ada A.",
    });
    expect(await resolveShareToken(db, token)).not.toBeNull();

    expect(await shareLinksForOrg(db, orgA).revoke(link.id)).toBe(true);
    expect(await resolveShareToken(db, token)).toBeNull();
    const listed = await shareLinksForOrg(db, orgA).list();
    expect(listed.some((l) => l.id === link.id)).toBe(false);
  });

  it("is org-scoped: org B cannot revoke org A's link, nor share A's person", async () => {
    const { link } = await shareLinksForOrg(db, orgA).create({
      personId: personA,
      scoreSlug: "fluency",
      publicLabel: "Ada",
    });
    // B's scope can't revoke A's link.
    expect(await shareLinksForOrg(db, orgB).revoke(link.id)).toBe(false);
    // Composite (org_id, person_id) FK rejects sharing a cross-org person.
    await expect(
      shareLinksForOrg(db, orgB).create({
        personId: personA,
        scoreSlug: "fluency",
        publicLabel: "smuggle",
      }),
    ).rejects.toThrow();
  });

  it("does not reference the smuggle attempt's person (isolation)", async () => {
    // personB never appears in org A's active list.
    const listed = await shareLinksForOrg(db, orgA).list();
    expect(JSON.stringify(listed)).not.toContain(personB);
  });

  it("listForPerson: only that person's ACTIVE links, org-scoped (W3-P revoke surface)", async () => {
    const links = shareLinksForOrg(db, orgA);
    const other = (await forOrg(db, orgA).people.create({ displayName: "Cy" }))
      .id;
    const mine = await links.create({
      personId: personA,
      scoreSlug: "efficiency",
      publicLabel: "Ada E.",
    });
    const theirs = await links.create({
      personId: other,
      scoreSlug: "fluency",
      publicLabel: "Cy F.",
    });

    const listed = await links.listForPerson(personA);
    expect(listed.some((l) => l.id === mine.link.id)).toBe(true);
    expect(listed.some((l) => l.id === theirs.link.id)).toBe(false);
    // Revoked links drop from the owner's list too.
    await links.revoke(mine.link.id);
    const after = await links.listForPerson(personA);
    expect(after.some((l) => l.id === mine.link.id)).toBe(false);
    // Cross-org: org B sees nothing for org A's person.
    expect(await shareLinksForOrg(db, orgB).listForPerson(personA)).toEqual([]);
  });

  it("get: org-scoped by id, includes revoked rows for ownership checks", async () => {
    const links = shareLinksForOrg(db, orgA);
    const { link } = await links.create({
      personId: personA,
      scoreSlug: "adoption",
      publicLabel: "Ada G.",
    });
    expect((await links.get(link.id))?.id).toBe(link.id);
    // Org B's scope cannot fetch it at all.
    expect(await shareLinksForOrg(db, orgB).get(link.id)).toBeUndefined();
    // Still fetchable after revocation (the DELETE route needs the row to
    // check ownership and answer idempotently).
    await links.revoke(link.id);
    expect((await links.get(link.id))?.revokedAt).not.toBeNull();
    // Second revoke is a no-op false — the route maps it to idempotent success.
    expect(await links.revoke(link.id)).toBe(false);
  });
});

describe("benchmark consent (anonymized opt-in)", () => {
  it("records and updates consent (upsert on org+user)", async () => {
    const consent = benchmarkConsentForOrg(db, orgA);
    expect(await consent.get(userA)).toBeUndefined();

    const granted = await consent.set(userA, true);
    expect(granted.granted).toBe(true);
    expect((await consent.get(userA))?.granted).toBe(true);

    // Re-set flips it in place — one row per (org, user).
    const revoked = await consent.set(userA, false);
    expect(revoked.id).toBe(granted.id);
    expect((await consent.get(userA))?.granted).toBe(false);
  });

  it("is org-scoped: another org sees no consent for the same user", async () => {
    await benchmarkConsentForOrg(db, orgA).set(userA, true);
    expect(await benchmarkConsentForOrg(db, orgB).get(userA)).toBeUndefined();
    // list() is org-filtered — org B's list never carries org A's row.
    const bList = await benchmarkConsentForOrg(db, orgB).list();
    expect(bList.every((r) => r.orgId === orgB)).toBe(true);
  });
});

describe("share card month boundary (W3 gate finding)", () => {
  it("falls back to the previous month's score until the new month's first recompute lands", async () => {
    const [def] = await db
      .insert(schema.scoreDefinitions)
      .values({
        orgId: orgA,
        slug: "fluency",
        version: 1,
        name: "Fluency",
        subjectLevel: "person",
        components: [],
        status: "active",
      })
      .returning();
    const base = {
      orgId: orgA,
      definitionId: def.id,
      subjectLevel: "person" as const,
      personId: personA,
      periodGrain: "month" as const,
      attribution: "person" as const,
      components: {},
    };
    // June is computed; July (the "current" month) is not yet.
    await db.insert(schema.scoreResults).values({
      ...base,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      value: 78,
    });
    const { token } = await shareLinksForOrg(db, orgA).create({
      personId: personA,
      scoreSlug: "fluency",
      publicLabel: "Ada F.",
      createdByUserId: userA,
    });

    // Early on July 1st, before the nightly recompute has written any July
    // row: the card must show June's number, not "not computed yet".
    const atBoundary = await resolveShareCard(
      db,
      token,
      new Date("2026-07-01T05:00:00Z"),
    );
    expect(atBoundary?.value).toBe(78);
    // §7.1 band-first: the card carries a qualitative band as its headline.
    expect(atBoundary?.band?.label).toBe("Fluent"); // 78 → ≥70

    // Once the current month IS computed, it wins over the previous one.
    await db.insert(schema.scoreResults).values({
      ...base,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      value: 82,
    });
    const midMonth = await resolveShareCard(
      db,
      token,
      new Date("2026-07-15T12:00:00Z"),
    );
    expect(midMonth?.value).toBe(82);
  });
});
