import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { createFixtureOrg, loadFixture } from "../../src/db/fixtures";
import { orgContextForUser } from "../../src/db/org-context";
import { ensureOrgOfOne, forOrg } from "../../src/db/org-scope";
import * as schema from "../../src/db/schema";
import { applyPaddleSubscriptionEvent } from "../../src/db/subscriptions";
import { computeAccess } from "../../src/lib/access";
import { readDashboardView } from "../../src/lib/dashboard-view";
import { periodFor, recomputeOrg } from "../../src/scoring";
import { buildTeamFixtureGraph } from "./fixture-graph";
import { formatTable, instrumentPglite, measure, type ScenarioResult } from "./query-counter";

// MEASUREMENT harness (perf/authenticated-pages) — not a correctness test.
// Answers: for the authenticated-page hot path, how many DB round-trips
// does production issue, and how many of them are forced to happen one
// after another (the round-trip depth that sets a floor on TTFB over
// Workers→Hyperdrive→Neon, where every query is a real network hop)?
//
// Three scenarios mirror the real call chain, in the order a request hits
// them (see src/lib/api-context.ts `appContext`, src/app/(app)/layout.tsx,
// src/app/(app)/dashboard/page.tsx):
//   1. "context chain" — ensureOrgOfOne + orgContextForUser, what
//      appContext does with the session it already has. Better Auth's own
//      getSession() is NOT included (it needs real request headers) — in
//      production it adds ~1-2 more round-trips (session + account lookup)
//      BEFORE this chain even starts.
//   2. "shell" — computeAccess, the free-band paywall gate every app page
//      and API route runs through.
//   3. "dashboard" — readDashboardView, what the team dashboard page (the
//      non-trivial authenticated page) actually reads.
//
// Query counts are asserted against a recorded CURRENT baseline with a
// generous upper bound: tight enough to catch a real regression (e.g. an
// accidental N+1), loose enough that unrelated changes elsewhere don't
// make this suite flaky.
//
// HISTORY: scenario 3's total query count used to be ~99 against a
// sequential depth of only ~4 — two of readDashboardView's read paths
// (dashboard-signals.ts readActivityHeatmap, shared-account/query.ts
// computeSharedAccountFlags) each fanned out ONE query per org subject, and
// shared-account/index.ts additionally looped `identities.forSubject` per
// detected flag with no Promise.all. Fixed by the query-consolidation pass
// (ADR 0017's `metrics.allSignals` bulk reader replaced both per-subject
// signal fan-outs — and the two paths now share ONE fetch of those rows;
// `identities.all()` replaced the per-flag identity loop; and
// dashboard-view.ts now fetches scores/definitions/people/connections once
// and threads them into every module below instead of each one re-querying).
// A follow-up hoist then moved EVERY read the composed view needs into
// dashboard-view.ts's single stage-1 Promise.all (the downstream modules run
// on pre-fetched rows only, issuing zero queries of their own), taking the
// scenario from total 14 / depth 2 to its floor.
// Current baseline (25 tracked people, 36 subjects): total 13, depth 1.
// (W4-W added connector_runs to the stage-1 Promise.all so the team view
// surfaces honesty gaps like the personal view — +1 query, still depth 1.)

const PEOPLE_COUNT = 25;
const WINDOW = { from: "2026-06-01", to: "2026-06-30" };
const JUNE = periodFor("month", "2026-06-15");

let db: Db;
let counter: ReturnType<typeof instrumentPglite>;
let orgId: string;
let userId: string;
let scope: ReturnType<typeof forOrg>;
const results: ScenarioResult[] = [];

beforeAll(async () => {
  const pglite = new PGlite();
  counter = instrumentPglite(pglite);
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const org = await createFixtureOrg(db, "perf-authenticated-pages", "team");
  orgId = org.id;
  await loadFixture(db, orgId, buildTeamFixtureGraph(PEOPLE_COUNT));
  scope = forOrg(db, orgId);
  await recomputeOrg(db, orgId, { period: JUNE });

  // A real paying team — computeAccess short-circuits the tracked-user
  // count query for this path (the common case for a hot authenticated
  // page), matching the "entitled/system orgs" short-circuit documented
  // in src/lib/access.ts.
  await applyPaddleSubscriptionEvent(db, {
    orgId,
    paddleSubscriptionId: "sub_perf",
    occurredAt: new Date("2026-06-01T00:00:00Z"),
    status: "active",
    priceId: "pri_team_perf",
    quantity: PEOPLE_COUNT,
  });

  const [user] = await db
    .insert(schema.user)
    .values({ id: "perf-user", name: "Perf User", email: "perf-user@fixture.example" })
    .returning();
  userId = user.id;
  await db.insert(schema.orgMembers).values({ orgId, userId, role: "admin" });
  // 120s, not the 30s the suite started with: PGlite cold-start + the full
  // migration chain + fixture load routinely exceeds 30s on the Windows dev
  // machine when other test files (or a build) share the box — the suite
  // then reports "failed | skipped" with no assertion failure at all. The
  // measured scenarios themselves stay fast; only setup needs the headroom.
}, 120_000);

describe("authenticated-page query baseline (measurement, not correctness)", () => {
  it("1. context chain — ensureOrgOfOne + orgContextForUser", async () => {
    const result = await measure(counter, "context chain", async () => {
      const sessionUser = { id: userId, name: "Perf User", email: "perf-user@fixture.example" };
      await ensureOrgOfOne(db, sessionUser);
      const ctx = await orgContextForUser(db, userId);
      expect(ctx?.org.id).toBe(orgId);
    });
    results.push(result);

    // Recorded baseline: membershipForUser (1) + orgContextForUser (1) = 2.
    // ensureOrgOfOne short-circuits on an existing membership with a single
    // SELECT and never opens its insert transaction, so this is the CHEAP
    // path — a first-ever signup would add the transaction's INSERT round
    // trips on top. Generous upper bound: catches an accidental N+1 without
    // being brittle to an unrelated extra column read.
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(6);
    expect(result.sequentialDepth).toBeLessThanOrEqual(6);
  });

  it("2. shell — computeAccess", async () => {
    const result = await measure(counter, "shell", async () => {
      const access = await computeAccess(db, scope, { id: orgId, kind: "team" });
      expect(access.blocked).toBe(false);
    });
    results.push(result);

    // Recorded baseline: subscriptionsForOrg().current() (1 SELECT), then
    // short-circuits on the team plan — the trackedUsers() count query
    // never runs. A regression that drops the short-circuit would show up
    // as a jump here (extra query on the entitled hot path this gate is
    // explicitly optimized for).
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(4);
    expect(result.sequentialDepth).toBeLessThanOrEqual(4);
  });

  it("3. dashboard — readDashboardView", async () => {
    let connectionCount = 0;
    const result = await measure(counter, "dashboard", async () => {
      const view = await readDashboardView(scope, "private", WINDOW);
      expect(view.summary.scores.length).toBeGreaterThan(0);
      // The composed view now RETURNS the connections it already fetched in
      // its depth-1 Promise.all, so the team dashboard page renders its
      // Connections panel + needs-attention strip from `view.connections`
      // instead of stacking a separate `connections.list()` round trip
      // BEFORE this read (that serial hop cost ~250–500ms of authenticated
      // TTFB on Workers→Hyperdrive→Neon). This pins that the connections read
      // stays folded into the single depth-1 batch — no extra query, no
      // extra sequential stage.
      connectionCount = view.connections.length;
    });
    results.push(result);
    expect(connectionCount).toBeGreaterThan(0);

    // Recorded baseline (25 tracked people, 36 subjects) after the
    // query-consolidation pass + depth-1 hoist: total 13, sequential
    // depth 1 (see the module doc comment above for what dropped ~99 → 12;
    // W4-W's connector_runs read for honesty gaps took it to 13).
    // Ceilings are generous (roughly 2x total, 3x depth) so an unrelated
    // one-query change doesn't make this flaky, while a real regression
    // (e.g. a reintroduced per-subject/per-row fan-out, or a stage that
    // stops overlapping with the main Promise.all) still trips it. Depth
    // stays 1 with connections now folded into the view's single batch —
    // the ceiling of 3 both catches regressions and documents the win
    // (the pre-change team page ran connections.list() as its own stage
    // ahead of this call, i.e. one extra round trip in the page's data path).
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(24);
    expect(result.sequentialDepth).toBeLessThanOrEqual(3);
  });

  it("prints the baseline table", () => {
    expect(results).toHaveLength(3);
    // eslint-disable-next-line no-console
    console.log(`\nAuthenticated-page query baseline (org: ${PEOPLE_COUNT} tracked people, 30d window)\n${formatTable(results)}\n`);
  });
});
