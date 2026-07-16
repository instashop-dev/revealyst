import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Rec-interaction `clear` (ADR 0043): the honest undo behind the coaching
// card's toast — deletes the person's row for one rec so their state is
// literal absence again, never a fabricated "tried".

let db: Db;

async function migratedDb(): Promise<Db> {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: "./drizzle" });
  return pglite as unknown as Db;
}

beforeEach(async () => {
  db = await migratedDb();
});

describe("recInteractions.clear (ADR 0043)", () => {
  it("deletes the person's row for that rec and leaves other rows alone", async () => {
    const orgA = (await createFixtureOrg(db, "org-a", "team")).id;
    const a = forOrg(db, orgA);
    const p1 = (await a.people.create()).id;

    await a.recInteractions.set({ personId: p1, recId: "r1", state: "dismissed" });
    await a.recInteractions.set({ personId: p1, recId: "r2", state: "tried" });

    await a.recInteractions.clear({ personId: p1, recId: "r1" });

    const rows = await a.recInteractions.list(p1);
    expect(rows.map((r) => r.recId)).toEqual(["r2"]);
    expect(rows[0].state).toBe("tried");
  });

  it("is idempotent — clearing an absent row is a no-op success", async () => {
    const orgA = (await createFixtureOrg(db, "org-a", "team")).id;
    const a = forOrg(db, orgA);
    const p1 = (await a.people.create()).id;

    await expect(
      a.recInteractions.clear({ personId: p1, recId: "never-set" }),
    ).resolves.toBeUndefined();
    expect(await a.recInteractions.list(p1)).toEqual([]);
  });

  it("is org-scoped — an A-scoped clear never touches B's identically-keyed row", async () => {
    const orgA = (await createFixtureOrg(db, "org-a", "team")).id;
    const orgB = (await createFixtureOrg(db, "org-b", "team")).id;
    const a = forOrg(db, orgA);
    const b = forOrg(db, orgB);
    const pB = (await b.people.create()).id;

    await b.recInteractions.set({ personId: pB, recId: "r1", state: "dismissed" });

    // Same personId/recId key, wrong org scope: deletes nothing.
    await a.recInteractions.clear({ personId: pB, recId: "r1" });

    const rows = await b.recInteractions.list(pB);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("dismissed");
  });
});
