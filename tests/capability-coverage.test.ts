import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "../src/lib/segments";

// W7-6: the aggregate capability-coverage rollup + the MIN_PEOPLE floor. This
// pins the manager surface as COUNT-ONLY and provably suppressed below the
// floor — no capability with fewer than the floor of people-with-state is ever
// countable, so no individual's mastery can be inferred.

let db: Db;
let orgId: string;
const MASTERED = 0.6;

/** Seed one person's FULL capability state in a single call — replaceForPerson
 * replaces the whole per-person set, so all of a person's rows go together. */
async function seedPerson(
  personId: string,
  states: { slug: string; mastery: number }[],
) {
  await forOrg(db, orgId).mastery.replaceForPerson(
    personId,
    states.map((s) => ({
      personId,
      capabilitySlug: s.slug,
      mastery: s.mastery,
      confidence: 0.4,
      confidenceTier: "directional" as const,
      evidenceCount: 3,
      lastEvidenceAt: "2026-06-15",
      staleness: 0,
      nextCapability: null,
      components: {},
    })),
  );
}

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
  orgId = (await createFixtureOrg(db, "cap-cov", "team")).id;
  const scoped = forOrg(db, orgId);
  // 5 people with state for capability X (≥ floor of 4): 3 mastered, 2 not.
  const people: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await scoped.people.create({
      displayName: `x${i}`,
      email: `x${i}@fixture.example`,
    });
    people.push(p.id);
  }
  // capability X (ai-coding-foundations): 5 people (3 mastered, 2 not).
  // capability Y (feature-breadth): only 2 people (< floor).
  await seedPerson(people[0], [
    { slug: "ai-coding-foundations", mastery: 0.8 },
    { slug: "feature-breadth", mastery: 0.9 },
  ]);
  await seedPerson(people[1], [
    { slug: "ai-coding-foundations", mastery: 0.7 },
    { slug: "feature-breadth", mastery: 0.9 },
  ]);
  await seedPerson(people[2], [{ slug: "ai-coding-foundations", mastery: 0.65 }]);
  await seedPerson(people[3], [{ slug: "ai-coding-foundations", mastery: 0.3 }]);
  await seedPerson(people[4], [{ slug: "ai-coding-foundations", mastery: 0.2 }]);
});

describe("capability coverage rollup + MIN_PEOPLE floor", () => {
  it("counts mastered vs with-state per capability (count-only)", async () => {
    const counts = await forOrg(db, orgId).mastery.coverageCounts(MASTERED);
    expect(counts.get("ai-coding-foundations")).toEqual({ mastered: 3, withState: 5 });
    expect(counts.get("feature-breadth")).toEqual({ mastered: 2, withState: 2 });
  });

  it("the MIN_PEOPLE floor suppresses a capability below the threshold entirely", async () => {
    const counts = await forOrg(db, orgId).mastery.coverageCounts(MASTERED);
    // The exact floor the dashboard applies (dashboard-view.ts).
    const visible = [...counts.entries()].filter(
      ([, c]) => c.withState >= SEGMENT_MIN_PEOPLE_TO_NAME,
    );
    const slugs = visible.map(([slug]) => slug);
    expect(slugs).toContain("ai-coding-foundations"); // 5 ≥ 4
    expect(slugs).not.toContain("feature-breadth"); // 2 < 4 → gone, not implied
  });

  it("stays inside the org", async () => {
    const other = (await createFixtureOrg(db, "cap-cov-b", "team")).id;
    const counts = await forOrg(db, other).mastery.coverageCounts(MASTERED);
    expect(counts.size).toBe(0); // no leakage from the seeded org
  });
});
