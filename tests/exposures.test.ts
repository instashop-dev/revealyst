import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { assignVariant, hash32, type Experiment } from "../src/lib/experiments";

// W7-7: the exposure log + deterministic experimentation. Holdout determinism,
// idempotent (CAS) logging, and self-view / org isolation.

describe("experiment assignment (deterministic, no per-request random)", () => {
  const exp: Experiment = {
    key: "ranker-weights-v2",
    variants: ["control", "treatment"],
    holdoutPct: 0.2,
  };

  it("is stable: the same person always gets the same arm", () => {
    for (const id of ["p1", "p2", "p3", "abc-123"]) {
      const a = assignVariant(id, exp);
      const b = assignVariant(id, exp);
      expect(a).toEqual(b);
    }
  });

  it("respects the holdout fraction across many people (±5%)", () => {
    let held = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (assignVariant(`person-${i}`, exp).holdout) held += 1;
    }
    expect(held / N).toBeGreaterThan(0.15);
    expect(held / N).toBeLessThan(0.25);
  });

  it("spreads non-holdout people across the variants", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = assignVariant(`u-${i}`, exp);
      if (!a.holdout && a.variant) seen.add(a.variant);
    }
    expect(seen).toEqual(new Set(["control", "treatment"]));
  });

  it("hash32 is deterministic and unsigned", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(hash32("abc")).toBeGreaterThanOrEqual(0);
  });
});

describe("recommendation_exposure log", () => {
  let db: Db;
  let orgId: string;
  let aliceId: string;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgId = (await createFixtureOrg(db, "exp-a", "team")).id;
    // people.auth_user_id FKs the auth `user` table — seed a user first.
    await db.insert(schema.user).values({
      id: "user-alice",
      name: "Alice",
      email: "alice@fixture.example",
      emailVerified: true,
    });
    const alice = await forOrg(db, orgId).people.create({
      displayName: "Alice",
      email: "alice@fixture.example",
      authUserId: "user-alice",
    });
    aliceId = alice.id;
  });

  it("is idempotent per (person, rec, surface, day) — redelivery writes one row", async () => {
    const scoped = forOrg(db, orgId);
    const row = {
      personId: aliceId,
      recId: "adoption-active-days",
      surface: "digest" as const,
      shownAt: "2026-06-15",
      experimentKey: null,
      variant: null,
    };
    await scoped.exposures.log([row]);
    await scoped.exposures.log([row]); // redelivery
    const rows = await scoped.exposures.list();
    expect(rows.filter((r) => r.recId === "adoption-active-days")).toHaveLength(1);
  });

  it("a different surface or day is a distinct exposure", async () => {
    const scoped = forOrg(db, orgId);
    await scoped.exposures.log([
      { personId: aliceId, recId: "fluency-depth", surface: "digest", shownAt: "2026-06-15", experimentKey: null, variant: null },
      { personId: aliceId, recId: "fluency-depth", surface: "dashboard", shownAt: "2026-06-15", experimentKey: null, variant: null },
      { personId: aliceId, recId: "fluency-depth", surface: "digest", shownAt: "2026-06-22", experimentKey: null, variant: null },
    ]);
    const rows = (await scoped.exposures.list()).filter((r) => r.recId === "fluency-depth");
    expect(rows).toHaveLength(3);
  });

  it("forUser is self-view: only the caller's rows return", async () => {
    const scoped = forOrg(db, orgId);
    const mine = await scoped.exposures.forUser("user-alice");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.personId === aliceId)).toBe(true);
    // A different user sees nothing of alice's.
    expect(await scoped.exposures.forUser("user-someone-else")).toEqual([]);
  });

  it("stays inside the org", async () => {
    const other = (await createFixtureOrg(db, "exp-b", "team")).id;
    expect(await forOrg(db, other).exposures.list()).toEqual([]);
  });
});
