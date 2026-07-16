import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { createFixtureOrg } from "../../src/db/fixtures";
import { forOrg } from "../../src/db/org-scope";
import * as schema from "../../src/db/schema";
import { recomputeCapabilityHistory } from "../../src/scoring/recompute-capability-history";
import { instrumentPglite, measure } from "./query-counter";

// TCI Phase 2-D perf guard (ADR 0046): the history rollup writer's READ cost must
// be INDEPENDENT of person count — all reads batched once for the whole org
// (coverageCounts + coverageTierCounts + people count). Two orgs with different
// people counts but NO capability state (so no per-capability WRITES) must issue
// the SAME number of queries. Mirrors capability-state-queries.test.ts.

const AS_OF = "2026-06-15";

let db: Db;
let counter: ReturnType<typeof instrumentPglite>;

async function orgWithPeople(name: string, n: number): Promise<string> {
  const org = await createFixtureOrg(db, name, "team");
  const scoped = forOrg(db, org.id);
  for (let i = 0; i < n; i++) {
    await scoped.people.create({
      displayName: `${name}-p${i}`,
      email: `${name}-p${i}@fixture.example`,
    });
  }
  return org.id;
}

beforeAll(async () => {
  const pglite = new PGlite();
  counter = instrumentPglite(pglite);
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;
});

describe("capability-history rollup query count", () => {
  it("read cost is independent of person count (no per-person query)", async () => {
    // Neither org has capability state → no upsert fans out; this isolates the
    // pure READ cost of the writer.
    const small = await orgWithPeople("hist-perf-small", 2);
    const large = await orgWithPeople("hist-perf-large", 40);

    const rSmall = await measure(counter, "small", () =>
      recomputeCapabilityHistory(db, small, { asOfDay: AS_OF }),
    );
    const rLarge = await measure(counter, "large", () =>
      recomputeCapabilityHistory(db, large, { asOfDay: AS_OF }),
    );

    // 20× the people, identical query count → the reads do not fan out per
    // person, and no upsert runs for a stateless org.
    expect(rLarge.total).toBe(rSmall.total);
    // A small, bounded number (the batched reads), not an N+1 explosion.
    expect(rSmall.total).toBeLessThan(10);
  });
});
