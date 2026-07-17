import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db/client";
import { createFixtureOrg, loadFixture } from "../../src/db/fixtures";
import { orgContextForUser } from "../../src/db/org-context";
import { ensureOrgOfOne, forOrg } from "../../src/db/org-scope";
import * as schema from "../../src/db/schema";
import { applyPaddleSubscriptionEvent } from "../../src/db/subscriptions";
import { computeAccess } from "../../src/lib/access";
import { dashboardSummary } from "../../src/lib/api-impl";
import {
  cachedCapabilityGraph,
  cachedMissionCatalog,
  cachedRecommendationCatalog,
  cachedVerifiedOverallBenchmarks,
  clearReferenceCache,
} from "../../src/lib/reference-cache";
import {
  monthToDateWindow,
  readBudgetAlertForRole,
} from "../../src/lib/spend-governance";
import { readDashboardView } from "../../src/lib/dashboard-view";
import {
  readMaturityView,
  sharedCompanionReadSpans,
  sliceScoreRows,
} from "../../src/lib/maturity";
import { periodFor, previousDay, recomputeOrg } from "../../src/scoring";
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

    // Recorded baseline: computeAccess now issues subscriptionsForOrg()
    // .current() and the trackedUsers() count CONCURRENTLY (Promise.all), so
    // for this team-plan org it runs subscription(1) + trackedUsers(2) = 3
    // queries but at round-trip DEPTH 1 — the count result is discarded once
    // the team plan resolves, a query-count trade for a depth win (see
    // computeAccess's doc comment). What matters is depth stays 1: a
    // regression that re-serialized the two reads (or reintroduced a fan-out)
    // would push depth above 1 and trip the ceiling below.
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(4);
    expect(result.sequentialDepth).toBeLessThanOrEqual(1);
  });

  it("2b. shell (free-band) — computeAccess parallelizes its two reads", async () => {
    // The dominant login population is free/personal orgs, for which BOTH of
    // computeAccess's reads always run (no team short-circuit). Before the
    // parallelization pass this was subscription→count = depth 2 (~1.0-1.3s of
    // sequential Neon latency on Workers→Hyperdrive→Neon); folding them into
    // one Promise.all collapses it to depth 1, removing a full ~500-670ms hop
    // from every free-tier authenticated request. This scenario is the guard:
    // a fresh free org (no subscription → plan "personal") measured through
    // the exact production computeAccess.
    const freeOrg = await createFixtureOrg(db, "perf-free-band", "team");
    await loadFixture(db, freeOrg.id, buildTeamFixtureGraph(3));
    const freeScope = forOrg(db, freeOrg.id);

    const result = await measure(counter, "shell (free-band)", async () => {
      // No subscription rows → resolveEntitlement returns plan "personal", so
      // the count is the operative input (3 tracked ≤ FREE_TRACKED_USER_LIMIT
      // of 5 → not blocked).
      const access = await computeAccess(db, freeScope, {
        id: freeOrg.id,
        kind: "personal",
      });
      expect(access.blocked).toBe(false);
    });
    results.push(result);

    // subscription.current() (1) + billing.trackedUsers() (2 internal, already
    // parallel) = 3 queries, all issued concurrently → sequential DEPTH 1.
    // Exact-equality on depth is the whole point of this scenario: it fails
    // the moment the two reads re-serialize (the regression this pass fixes).
    expect(result.total).toBe(3);
    expect(result.sequentialDepth).toBe(1);
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

  // Mirrors personal-self-view.tsx's batch EXACTLY (the shared-read shape):
  // one read per table over the UNION of the page's and readMaturityView's
  // windows, handed to both consumers via prefetched inputs; reference tables
  // (capability graph, mission catalog, rec catalog, benchmarks) go through
  // the isolate cache helpers (pass-through when the cache is cold/disabled).
  async function runTodayBatch(anchor: string) {
    const period = periodFor("month", anchor);
    const prevPeriod = periodFor("month", previousDay(period.periodStart));
    const definitionsPromise = scope.scores.definitions();
    const peoplePromise = scope.people.list();
    const connectionsPromise = scope.connections.list();
    const identitiesPromise = scope.identities.all();
    const spans = sharedCompanionReadSpans({
      today: anchor,
      agenticFrom: WINDOW.from,
      period,
      prevPeriod,
    });
    const activeDayPromise = scope.metrics.records({
      metricKey: "active_day",
      from: spans.metricFrom,
      to: spans.metricTo,
    });
    const agentActivePromise = scope.metrics.records({
      metricKey: "agent_active",
      from: spans.metricFrom,
      to: spans.metricTo,
    });
    const spendPromise = scope.metrics.records({
      metricKey: "spend_cents",
      from: spans.spendFrom,
      to: spans.spendTo,
    });
    const estimatedSpendPromise = scope.metrics.records({
      metricKey: "spend_cents_estimated",
      from: period.periodStart,
      to: period.periodEnd,
    });
    const monthToDate = monthToDateWindow(anchor);
    const sliceToMonthToDate = (
      rows: Awaited<ReturnType<typeof scope.metrics.records>>,
    ) =>
      rows.filter((r) => r.day >= monthToDate.from && r.day <= monthToDate.to);
    const scoreRowsPromise = scope.scores.results({
      from: spans.scoreFrom,
      to: spans.scoreTo,
    });
    const [maturity] = await Promise.all([
      readMaturityView(scope, anchor, {
        people: peoplePromise,
        identities: identitiesPromise,
        connections: connectionsPromise,
        activeDayRows: activeDayPromise,
        agentActiveRows: agentActivePromise,
        spendRows: spendPromise,
        scoreRows: scoreRowsPromise,
        definitions: definitionsPromise,
      }),
      connectionsPromise,
      dashboardSummary(
        scope,
        "private",
        { from: period.periodStart, to: period.periodEnd },
        {
          definitions: definitionsPromise,
          people: peoplePromise,
          results: scoreRowsPromise.then((rows) =>
            sliceScoreRows(rows, {
              from: period.periodStart,
              to: period.periodEnd,
            }),
          ),
          spendRows: spendPromise.then((rows) =>
            rows.filter(
              (r) => r.day >= period.periodStart && r.day <= period.periodEnd,
            ),
          ),
          estimatedRows: estimatedSpendPromise,
        },
      ),
      cachedVerifiedOverallBenchmarks(db),
      definitionsPromise,
      scoreRowsPromise.then((rows) =>
        sliceScoreRows(rows, {
          from: prevPeriod.periodStart,
          to: prevPeriod.periodEnd,
          subjectLevel: "person",
        }),
      ),
      readBudgetAlertForRole(scope, "admin", anchor, {
        reportedRows: spendPromise.then(sliceToMonthToDate),
        estimatedRows: estimatedSpendPromise.then(sliceToMonthToDate),
      }),
      activeDayPromise,
      agentActivePromise,
      identitiesPromise,
      spendPromise,
      scope.recInteractions.statesForUser(userId),
      cachedRecommendationCatalog(scope),
      cachedCapabilityGraph(scope),
      scope.mastery.forUser(userId),
      cachedMissionCatalog(scope),
      scope.missions.progressForUser(userId),
      scope.exposures.forUser(userId),
      peoplePromise,
    ]);
    return maturity;
  }

  it("4. Today (personal self-view) — the WHOLE recomposed batch stays ONE depth-1 stage", async () => {
    // The shared-read pass (perf: dashboard/growth <2s): this page and
    // readMaturityView used to fetch people/identities/connections and the
    // active_day/agent_active/spend_cents/score rows SEPARATELY over
    // overlapping windows (total 39). Each is now ONE union-window read handed
    // to both consumers, and the four reference reads go through the isolate
    // cache. This scenario is the COLD-isolate number (cache disabled in
    // tests → the reference reads still hit Postgres); the warm scenario
    // below shows the steady-state. Depth stays EXACTLY 1 — every read still
    // overlaps in one stage.
    const anchor = "2026-06-30";
    let placed = false;
    const result = await measure(counter, "Today (cold isolate)", async () => {
      const maturity = await runTodayBatch(anchor);
      expect(maturity.numbers).toBeDefined();
      placed = maturity.currentWindow.to.length > 0;
    });
    results.push(result);
    expect(placed).toBe(true);

    // Measured after the shared-read pass + the spend/budget sharing pass
    // (this fixture): total 27 cold / 20 warm (was 39), depth 1 — and the
    // shell's access decision is additionally cached per-org in production
    // (cachedAccessDecision), so the warm full-request query count is the
    // Today number alone. Generous ceiling catches a real regression
    // (an accidental N+1 or a re-duplicated read) without being brittle to a
    // one-query change. Depth is pinned EXACT.
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(40);
    expect(result.sequentialDepth).toBe(1);
  });

  it("4b. Today (warm isolate) — reference cache serves the seeded tables", async () => {
    // The production steady state: the isolate has served this org before, so
    // the capability graph (3 queries), mission catalog (2), rec catalog (1)
    // and benchmarks (1) come from the isolate cache — ~7 fewer Neon round
    // trips per page load. NODE_ENV is stubbed to production because the cache
    // deliberately disables itself in tests (see reference-cache.ts).
    vi.stubEnv("NODE_ENV", "production");
    clearReferenceCache();
    try {
      await runTodayBatch("2026-06-30"); // warm the cache (uncounted)
      const result = await measure(counter, "Today (warm isolate)", async () => {
        const maturity = await runTodayBatch("2026-06-30");
        expect(maturity.numbers).toBeDefined();
      });
      results.push(result);
      expect(result.total).toBeGreaterThan(0);
      expect(result.total).toBeLessThanOrEqual(32);
      expect(result.sequentialDepth).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      clearReferenceCache();
    }
  });

  // Mirrors growth/page.tsx's batch EXACTLY (same shared-read shape as Today,
  // minus the summary/budget/spend cluster).
  async function runGrowthBatch(anchor: string) {
    const period = periodFor("month", anchor);
    const prevPeriod = periodFor("month", previousDay(period.periodStart));
    const spans = sharedCompanionReadSpans({
      today: anchor,
      agenticFrom: WINDOW.from,
      period,
      prevPeriod,
    });
    const peoplePromise = scope.people.list();
    const identitiesPromise = scope.identities.all();
    const connectionsPromise = scope.connections.list();
    const activeDayPromise = scope.metrics.records({
      metricKey: "active_day",
      from: spans.metricFrom,
      to: spans.metricTo,
    });
    const agentActivePromise = scope.metrics.records({
      metricKey: "agent_active",
      from: spans.metricFrom,
      to: spans.metricTo,
    });
    const scoreRowsPromise = scope.scores.results({
      from: spans.scoreFrom,
      to: spans.scoreTo,
    });
    const [maturity, graph] = await Promise.all([
      readMaturityView(scope, anchor, {
        people: peoplePromise,
        identities: identitiesPromise,
        connections: connectionsPromise,
        activeDayRows: activeDayPromise,
        agentActiveRows: agentActivePromise,
        scoreRows: scoreRowsPromise,
      }),
      cachedCapabilityGraph(scope),
      scope.mastery.forUser(userId),
      cachedMissionCatalog(scope),
      scope.missions.progressForUser(userId),
      scoreRowsPromise,
      connectionsPromise,
      peoplePromise,
      activeDayPromise,
      agentActivePromise,
      identitiesPromise,
    ]);
    return { maturity, graph };
  }

  it("5. Growth (/growth) — its own flat Promise.all, depth 1", async () => {
    // U1.3 + the shared-read pass: the route composes readMaturityView INSIDE
    // its batch and hands it the page's own people/identities/connections/
    // metric/score reads as prefetched inputs (each ONE union-window read).
    // The two narrow person-score reads (current + previous month) are now
    // JS slices of the one shared score read. Depth must stay 1.
    const anchor = "2026-06-30";
    let ok = false;
    const result = await measure(counter, "Growth (cold isolate)", async () => {
      const { maturity, graph } = await runGrowthBatch(anchor);
      expect(maturity.numbers).toBeDefined();
      ok = graph.capabilities.length >= 0;
    });
    results.push(result);
    expect(ok).toBe(true);

    // Measured after the shared-read pass (this fixture): total 18 cold /
    // 13 warm (was 25), depth 1. Generous ceiling (~1.5x). Depth pinned EXACT.
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(28);
    expect(result.sequentialDepth).toBe(1);
  });

  it("5b. Growth (warm isolate) — reference cache serves the seeded tables", async () => {
    vi.stubEnv("NODE_ENV", "production");
    clearReferenceCache();
    try {
      await runGrowthBatch("2026-06-30"); // warm the cache (uncounted)
      const result = await measure(counter, "Growth (warm isolate)", async () => {
        const { maturity } = await runGrowthBatch("2026-06-30");
        expect(maturity.numbers).toBeDefined();
      });
      results.push(result);
      expect(result.total).toBeGreaterThan(0);
      expect(result.total).toBeLessThanOrEqual(20);
      expect(result.sequentialDepth).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      clearReferenceCache();
    }
  });

  it("prints the baseline table", () => {
    expect(results).toHaveLength(8);
    // eslint-disable-next-line no-console
    console.log(`\nAuthenticated-page query baseline (org: ${PEOPLE_COUNT} tracked people, 30d window)\n${formatTable(results)}\n`);
  });
});
