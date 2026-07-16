import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// TCI Phase 2-E (ADR 0045): the org-scoped per-team settings layer, run against
// the real generated migrations on PGlite (rule 2: fixtures over coupling, no
// live DB). One row per team, created lazily by set(); an absent row IS the
// default state and get() must never insert one. The composite tenant FK to
// teams makes a cross-org write unrepresentable at the DB level.

let db: Db;
let orgA: string;
let orgB: string;
let teamA1: string;
let teamA2: string;
let teamB1: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const [a] = await db.insert(schema.orgs).values({ name: "org-a" }).returning();
  const [b] = await db.insert(schema.orgs).values({ name: "org-b" }).returning();
  orgA = a.id;
  orgB = b.id;

  teamA1 = (await forOrg(db, orgA).teams.create("Platform")).id;
  teamA2 = (await forOrg(db, orgA).teams.create("Product")).id;
  teamB1 = (await forOrg(db, orgB).teams.create("B Team")).id;
});

/** Rows physically present for a team (bypasses the org scope on purpose). */
async function rawRowsFor(teamId: string) {
  return db
    .select()
    .from(schema.teamSettings)
    .where(eq(schema.teamSettings.teamId, teamId));
}

describe("teamSettings.get — absent row means defaults", () => {
  it("returns the defaults object when the team has no row", async () => {
    const settings = await forOrg(db, orgA).teamSettings.get(teamA1);
    expect(settings).toEqual({ managersSeeIndividualCost: false });
  });

  it("does NOT insert a row on read (get is side-effect-free)", async () => {
    // teamA2 has never been set(); reading it must not materialize a row.
    await forOrg(db, orgA).teamSettings.get(teamA2);
    await forOrg(db, orgA).teamSettings.get(teamA2);
    expect(await rawRowsFor(teamA2)).toHaveLength(0);
  });
});

describe("teamSettings.set — upsert roundtrip + idempotency", () => {
  it("set-then-get roundtrips the stored value", async () => {
    const scope = forOrg(db, orgA);
    const written = await scope.teamSettings.set(teamA1, {
      managersSeeIndividualCost: true,
    });
    expect(written).toEqual({ managersSeeIndividualCost: true });
    expect(await scope.teamSettings.get(teamA1)).toEqual({
      managersSeeIndividualCost: true,
    });
    // Exactly one row — the first set created it.
    expect(await rawRowsFor(teamA1)).toHaveLength(1);
  });

  it("a repeat set() upserts in place — one row per team, never a duplicate", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamSettings.set(teamA1, { managersSeeIndividualCost: true });
    await scope.teamSettings.set(teamA1, { managersSeeIndividualCost: false });
    await scope.teamSettings.set(teamA1, { managersSeeIndividualCost: true });
    expect(await rawRowsFor(teamA1)).toHaveLength(1);
    expect(await scope.teamSettings.get(teamA1)).toEqual({
      managersSeeIndividualCost: true,
    });
  });

  it("an empty patch leaves stored values unchanged (still one row)", async () => {
    const scope = forOrg(db, orgA);
    await scope.teamSettings.set(teamA1, { managersSeeIndividualCost: true });
    const after = await scope.teamSettings.set(teamA1, {});
    expect(after).toEqual({ managersSeeIndividualCost: true });
    expect(await rawRowsFor(teamA1)).toHaveLength(1);
  });
});

describe("teamSettings — cross-org isolation", () => {
  it("set() on another org's team is rejected by the composite tenant FK", async () => {
    // org A's scope cannot write settings for a team owned by org B — the
    // (org_id, team_id) FK has no matching (orgA, teamB1) parent row.
    await expect(
      forOrg(db, orgA).teamSettings.set(teamB1, {
        managersSeeIndividualCost: true,
      }),
    ).rejects.toThrow();
  });

  it("get() on another org's team returns defaults, never the other org's row", async () => {
    // B stores true on its own team; A's scope reads through the org filter to
    // the default false (and cannot see B's stored value).
    await forOrg(db, orgB).teamSettings.set(teamB1, {
      managersSeeIndividualCost: true,
    });
    expect(await forOrg(db, orgA).teamSettings.get(teamB1)).toEqual({
      managersSeeIndividualCost: false,
    });
    expect(await forOrg(db, orgB).teamSettings.get(teamB1)).toEqual({
      managersSeeIndividualCost: true,
    });
  });
});
