import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";

// Runs the real generated migrations against in-memory Postgres (PGlite),
// then exercises the org-scoped layer. No live database or credentials —
// rule 2's fixtures-over-coupling applied to the schema itself.

let db: Db;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  // Same drizzle API surface; the driver difference doesn't matter to the
  // org-scope layer under test.
  db = pgliteDb as unknown as Db;

  const [a] = await db
    .insert(schema.orgs)
    .values({ name: "org-a" })
    .returning();
  const [b] = await db
    .insert(schema.orgs)
    .values({ name: "org-b" })
    .returning();
  orgA = a.id;
  orgB = b.id;
});

describe("migrations", () => {
  it("apply cleanly to an empty database", async () => {
    const rows = await db.select().from(schema.orgs);
    expect(rows).toHaveLength(2);
  });
});

describe("org-scoped repository", () => {
  it("records a heartbeat carrying the caller's org_id", async () => {
    const row = await forOrg(db, orgA).heartbeats.record();
    expect(row.orgId).toBe(orgA);
    expect(row.source).toBe("noop-poller");
    expect(row.observedAt).toBeInstanceOf(Date);
  });

  it("never returns another org's rows", async () => {
    await forOrg(db, orgB).heartbeats.record("other-org-source");

    const aRows = await forOrg(db, orgA).heartbeats.list();
    const bRows = await forOrg(db, orgB).heartbeats.list();

    expect(aRows.length).toBeGreaterThan(0);
    expect(bRows.length).toBeGreaterThan(0);
    expect(aRows.every((r) => r.orgId === orgA)).toBe(true);
    expect(bRows.every((r) => r.orgId === orgB)).toBe(true);
  });

  it("rejects heartbeats for a nonexistent org (FK enforced)", async () => {
    await expect(
      forOrg(db, "00000000-0000-0000-0000-000000000000").heartbeats.record(),
    ).rejects.toThrow();
  });
});
