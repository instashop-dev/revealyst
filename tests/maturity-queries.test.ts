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

  it("prefetched inputs produce IDENTICAL output to the direct reads", async () => {
    // The shared-read pass (perf: dashboard/growth <2s) hands readMaturityView
    // WIDER row sets than its own reads fetch — active_day without the dim=""
    // SQL filter, metric/score spans extending past fullSpan/current.to — and
    // relies on the reader slicing each back to the direct read's exact
    // predicate. This is the equivalence pin: same org, same anchor, direct vs
    // prefetched, deep-equal output. A future filter drift (a forgotten dim
    // slice, an off-by-one span) fails here, not on a dashboard.
    const anchor = "2026-07-01";
    const direct = await readMaturityView(scope, anchor);

    // Deliberately WIDER than the reader needs, mirroring the pages: metric
    // reads span [fullSpan.from − slack, anchor] with no dim filter; the score
    // read spans beyond current.to and carries every subject level.
    const prefetched = await readMaturityView(scope, anchor, {
      people: scope.people.list(),
      identities: scope.identities.all(),
      connections: scope.connections.list(),
      activeDayRows: scope.metrics.records({
        metricKey: "active_day",
        from: "2025-01-01",
        to: anchor,
      }),
      agentActiveRows: scope.metrics.records({
        metricKey: "agent_active",
        from: "2025-01-01",
        to: anchor,
      }),
      spendRows: scope.metrics.records({
        metricKey: "spend_cents",
        from: "2025-01-01",
        to: anchor,
      }),
      scoreRows: scope.scores.results({ from: "2025-01-01", to: "2026-12-31" }),
      definitions: scope.scores.definitions(),
    });

    expect(prefetched).toEqual(direct);
  });
});
