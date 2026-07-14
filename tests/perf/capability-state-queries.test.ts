import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { createFixtureOrg } from "../../src/db/fixtures";
import { forOrg } from "../../src/db/org-scope";
import * as schema from "../../src/db/schema";
import { recomputeCapabilityState } from "../../src/scoring/recompute-capability-state";
import { instrumentPglite, measure } from "./query-counter";

// W7-2 perf guard: the capability-state reducer's READ cost must be independent
// of person count (no per-person / per-subject query fan-out) — the top
// regression the plan flags. Two orgs with different people counts but NO
// evidence (so no per-person WRITES) must issue the SAME number of queries: the
// reads are all batched once for the whole org (identities/people/subjects/
// connections/scores/prior-state + one query per bound metric key), independent
// of person count AND of history depth (the metric window is watermark-bounded).

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

describe("capability-state reducer query count", () => {
  it("read cost is independent of person count (no per-person query)", async () => {
    // Neither org has metric/score evidence → every person is skipped (no
    // write), isolating the pure READ cost of the reducer.
    const small = await orgWithPeople("cap-perf-small", 2);
    const large = await orgWithPeople("cap-perf-large", 40);

    const rSmall = await measure(counter, "small", () =>
      recomputeCapabilityState(db, small, { asOfDay: AS_OF }),
    );
    const rLarge = await measure(counter, "large", () =>
      recomputeCapabilityState(db, large, { asOfDay: AS_OF }),
    );

    // 20× the people, identical query count → the reads do not fan out per
    // person or per subject.
    expect(rLarge.total).toBe(rSmall.total);
    // And it's a small, bounded number (batched reads + one per bound metric
    // key), not an N+1 explosion.
    expect(rSmall.total).toBeLessThan(40);
  });
});
