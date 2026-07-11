import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { createFixtureOrg, loadFixture } from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import { readMaturityView } from "../src/lib/maturity";
import { buildTeamFixtureGraph } from "./perf/fixture-graph";
import { instrumentPglite, measure } from "./perf/query-counter";

// Perf discipline (G10): readMaturityView must issue every read in ONE flat
// Promise.all — round-trip depth 1 on Workers→Hyperdrive→Neon, the same
// discipline as readDashboardView. This mirrors tests/perf/ measurement: it
// asserts the CALL-SITE concurrency (idle→busy transitions), not correctness.

const PEOPLE_COUNT = 12;

let db: Db;
let counter: ReturnType<typeof instrumentPglite>;
let scope: ReturnType<typeof forOrg>;

beforeAll(async () => {
  const pglite = new PGlite();
  counter = instrumentPglite(pglite);
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const org = await createFixtureOrg(db, "maturity-queries", "team");
  await loadFixture(db, org.id, buildTeamFixtureGraph(PEOPLE_COUNT));
  scope = forOrg(db, org.id);
}, 120_000);

describe("readMaturityView query shape (measurement, not correctness)", () => {
  it("reads at round-trip depth 1 (one flat Promise.all, G10)", async () => {
    const result = await measure(counter, "maturity", async () => {
      await readMaturityView(scope, "2026-07-01");
    });
    // One flat Promise.all — every read overlaps on the wire.
    expect(result.sequentialDepth).toBe(1);
    // Bounded total: the single Promise.all issues one query per reader
    // (people/identities/connections/5×metrics.records/allSignals/scores×2).
    expect(result.total).toBeLessThanOrEqual(15);
  });
});
