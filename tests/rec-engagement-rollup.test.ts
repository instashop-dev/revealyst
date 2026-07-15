import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { recEngagementRollup } from "../src/db/system";

// Rec-engagement rollup (MET-005): shown/tried/dismissed/snoozed counts per
// (org, rec, period), across ALL orgs — a founder-only, script-only aggregate
// (never wired to a route). See src/db/system.ts's recEngagementRollup header
// for the period-derivation and join-approximation notes.

let db: Db;

async function migratedDb(): Promise<Db> {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  return pglite as unknown as Db;
}

beforeEach(async () => {
  db = await migratedDb();
});

describe("recEngagementRollup", () => {
  it("aggregates shown/tried/dismissed/snoozed per (org, rec, period), including shown-only rows, isolated per org", async () => {
    const orgA = (await createFixtureOrg(db, "org-a", "team")).id;
    const orgB = (await createFixtureOrg(db, "org-b", "team")).id;
    const a = forOrg(db, orgA);
    const b = forOrg(db, orgB);

    const p1 = (await a.people.create()).id;
    const p2 = (await a.people.create()).id;
    const p3 = (await b.people.create()).id;

    // Org A, rec r1, period 2026-07-01: two exposures, one interaction
    // ("tried") — the other person is shown with no interaction at all.
    await a.exposures.log([
      {
        personId: p1,
        recId: "r1",
        surface: "dashboard",
        shownAt: "2026-07-01",
        experimentKey: null,
        variant: null,
      },
      {
        personId: p2,
        recId: "r1",
        surface: "dashboard",
        shownAt: "2026-07-01",
        experimentKey: null,
        variant: null,
      },
    ]);
    await a.recInteractions.set({ personId: p1, recId: "r1", state: "tried" });

    // Org A, rec r1, a DIFFERENT period (2026-07-02): p1 shown again. p1's
    // interaction state is a current snapshot (not per-day), so it still
    // joins as "tried" here too.
    await a.exposures.log([
      {
        personId: p1,
        recId: "r1",
        surface: "digest",
        shownAt: "2026-07-02",
        experimentKey: null,
        variant: null,
      },
    ]);

    // Org A, rec r2, period 2026-07-01: shown + dismissed.
    await a.exposures.log([
      {
        personId: p2,
        recId: "r2",
        surface: "dashboard",
        shownAt: "2026-07-01",
        experimentKey: null,
        variant: null,
      },
    ]);
    await a.recInteractions.set({
      personId: p2,
      recId: "r2",
      state: "dismissed",
    });

    // Org A, rec r3, period 2026-07-01: shown + snoozed.
    await a.exposures.log([
      {
        personId: p1,
        recId: "r3",
        surface: "dashboard",
        shownAt: "2026-07-01",
        experimentKey: null,
        variant: null,
      },
    ]);
    await a.recInteractions.set({ personId: p1, recId: "r3", state: "snoozed" });

    // Org B, rec r1, period 2026-07-01: shown only, no interaction — must
    // stay isolated from org A's r1/2026-07-01 row.
    await b.exposures.log([
      {
        personId: p3,
        recId: "r1",
        surface: "dashboard",
        shownAt: "2026-07-01",
        experimentKey: null,
        variant: null,
      },
    ]);

    const rows = await recEngagementRollup(db);
    expect(rows).toHaveLength(5);

    const find = (orgId: string, recId: string, period: string) => {
      const row = rows.find(
        (r) => r.orgId === orgId && r.recId === recId && r.period === period,
      );
      if (!row) {
        throw new Error(`missing row for ${orgId}/${recId}/${period}`);
      }
      return row;
    };

    expect(find(orgA, "r1", "2026-07-01")).toMatchObject({
      shown: 2,
      tried: 1,
      dismissed: 0,
      snoozed: 0,
    });
    expect(find(orgA, "r1", "2026-07-02")).toMatchObject({
      shown: 1,
      tried: 1,
      dismissed: 0,
      snoozed: 0,
    });
    expect(find(orgA, "r2", "2026-07-01")).toMatchObject({
      shown: 1,
      tried: 0,
      dismissed: 1,
      snoozed: 0,
    });
    expect(find(orgA, "r3", "2026-07-01")).toMatchObject({
      shown: 1,
      tried: 0,
      dismissed: 0,
      snoozed: 1,
    });
    expect(find(orgB, "r1", "2026-07-01")).toMatchObject({
      shown: 1,
      tried: 0,
      dismissed: 0,
      snoozed: 0,
    });
  });

  it("carries no person identifier in the rollup shape (founder-aggregate privacy invariant)", async () => {
    const orgId = (await createFixtureOrg(db, "org-priv", "personal")).id;
    const scoped = forOrg(db, orgId);
    const personId = (await scoped.people.create()).id;
    await scoped.exposures.log([
      {
        personId,
        recId: "r1",
        surface: "dashboard",
        shownAt: "2026-07-01",
        experimentKey: null,
        variant: null,
      },
    ]);

    const rows = await recEngagementRollup(db);
    expect(rows).toHaveLength(1);
    const keys = Object.keys(rows[0]);
    expect(keys).toEqual(
      expect.arrayContaining(["orgId", "recId", "period", "shown", "tried", "dismissed", "snoozed"]),
    );
    for (const forbidden of ["personId", "userId", "authUserId", "displayName", "email", "pseudonym"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("returns an empty array when there are no exposures", async () => {
    await createFixtureOrg(db, "org-empty", "team");
    const rows = await recEngagementRollup(db);
    expect(rows).toEqual([]);
  });
});
