import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { forOrg, type OrgScopedDb } from "../src/db/org-scope";
import { listBenchmarks } from "../src/db/benchmarks";
import { benchmarkConsentForOrg } from "../src/db/benchmark-consent";
import { shareLinksForOrg } from "../src/db/share-links";
import { invitesForOrg } from "../src/db/invites";
import {
  ACME_CONNECTIONS,
  PERSON_PRESET_CLONES,
  SOURCE_CONNECTOR,
  buildDemoSeedPlan,
} from "../scripts/seed/activity";
import { loadSeedPlan } from "../scripts/seed/load";
import type { LoadSeedPlanResult } from "../scripts/seed/plan";
import { readDashboardView, type DashboardView } from "../src/lib/dashboard-view";
import { latestTeamScoresBySlug } from "../src/lib/dashboard-read";
import {
  connectionAttentionInputs,
  deriveAttention,
  deriveDelta,
  teamScoreDropAttribution,
} from "../src/lib/score-insights";
import { fromDashboardScore } from "../src/components/scores/score-card-model";
import { SCORE_SLUGS, type ScoreSlug } from "../src/lib/metrics-glossary";
import {
  buildOnboardingInterim,
  isUsableConnection,
  scoreTimingChannel,
} from "../src/lib/onboarding-guide";
import {
  DEFAULT_ALERT_THRESHOLDS,
  readSpendGovernance,
  todayUtc,
} from "../src/lib/spend-governance";
// Side-effect import: registers every shipped connector (tests/
// vendor-connect-meta.test.ts's pattern) — needed so getConnector() below
// resolves real sourceConnector strings instead of undefined.
import "../src/connectors";
import { getConnector } from "../src/connectors/registry";
import personalPresets from "../fixtures/score-definitions/personal-presets.json";

// End-to-end validation of the rich demo seed (scripts/seed/README.md):
// seeds the fixed-anchor plan into a PGlite database exactly like the CLI
// does, then drives every dashboard/API read seam against it, asserting
// non-degenerate output. See CLAUDE.md's seed-data workstream brief for the
// per-scenario numeric targets this suite checks against.

const FROZEN_NOW = "2026-07-11T08:00:00.000Z";
const ANCHOR_DAY = "2026-07-10";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Mirrors src/app/(app)/dashboard/page.tsx's dashboardWindow(). */
function dashboardWindow(): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - 180 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

let db: Db;
let result: LoadSeedPlanResult;

function orgId(name: string): string {
  const org = result.orgs.find((o) => o.name === name);
  if (!org) throw new Error(`seed org "${name}" not found in loadSeedPlan result`);
  return org.orgId;
}

async function teamIdByName(scope: OrgScopedDb, name: string): Promise<string> {
  const teams = await scope.teams.list();
  const team = teams.find((t) => t.name === name);
  if (!team) throw new Error(`team "${name}" not found`);
  return team.id;
}

beforeAll(async () => {
  // Freeze "today" WITHOUT breaking async I/O — only Date is faked, so
  // PGlite's internal async machinery (setTimeout etc.) keeps working.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(FROZEN_NOW) });

  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const plan = buildDemoSeedPlan(ANCHOR_DAY);
  result = await loadSeedPlan(db, plan, {});
}, 240_000);

afterAll(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Loader summary
// ─────────────────────────────────────────────────────────────────────────

describe("loader summary", () => {
  it("seeds 7+ orgs, Acme has 5000+ records, every org has scoreResults except onboarding orgs", () => {
    expect(result.orgs.length).toBeGreaterThanOrEqual(7);

    const acme = result.orgs.find((o) => o.name === "Acme Robotics")!;
    expect(acme.records).toBeGreaterThan(5000);

    const onboardingNames = new Set([
      "Onboarding — Same Day",
      "Onboarding — Overnight",
      "Onboarding — Awaiting Agent",
      "Onboarding — Mixed",
    ]);
    for (const org of result.orgs) {
      if (onboardingNames.has(org.name)) {
        expect(org.scoreResults, `${org.name} should have no scores`).toBe(0);
        continue;
      }
      expect(org.scoreResults, `${org.name} should have scores`).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2–9. Team dashboard composed view (Acme Robotics) — shared across several
// assertion groups since readDashboardView is the one round-trip-depth-1
// read the real page renders from.
// ─────────────────────────────────────────────────────────────────────────

let acmeId: string;
let acmeScope: OrgScopedDb;
let view: DashboardView;

describe("dashboard view (Acme Robotics)", () => {
  beforeAll(async () => {
    acmeId = orgId("Acme Robotics");
    acmeScope = forOrg(db, acmeId);
    view = await readDashboardView(acmeScope, "managed", dashboardWindow());
  }, 60_000);

  it("renders three team-level score cards (adoption/fluency/efficiency)", () => {
    const latest = latestTeamScoresBySlug(view.summary.scores);
    expect(latest.size).toBe(3);
    for (const slug of SCORE_SLUGS) {
      expect(latest.has(slug), `missing ${slug} team score`).toBe(true);
      expect(latest.get(slug)!.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("has a delta on at least one score card's trend", () => {
    const trendsBySlug = new Map(view.trends.map((t) => [t.slug, t]));
    const deltas = SCORE_SLUGS.map((slug) =>
      deriveDelta(trendsBySlug.get(slug)?.points ?? []),
    );
    expect(deltas.some((d) => d.kind === "delta")).toBe(true);
  });

  it("has a sparkline/trend of 2+ points for at least one slug", () => {
    expect(view.trends.some((t) => t.points.length >= 2)).toBe(true);
  });

  it("has an activity heatmap with at least one non-null hours day", () => {
    expect(view.heatmap.daysWithSignals).toBeGreaterThanOrEqual(1);
  });

  it("tool coverage lists 2+ connections and 3+ feature dims", () => {
    expect(view.coverage.connections.length).toBeGreaterThanOrEqual(2);
    expect(view.coverage.features.length).toBeGreaterThanOrEqual(3);
  });

  it("connections include one error and one paused", () => {
    expect(view.connections.some((c) => c.status === "error")).toBe(true);
    expect(view.connections.some((c) => c.status === "paused")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Score insights / attention (org-wide "needs attention" strip, built the
// same way src/app/(app)/dashboard/page.tsx's TeamOverview does).
// ─────────────────────────────────────────────────────────────────────────

describe("score insights / attention (Acme Robotics)", () => {
  it("includes a connection-error attention item", () => {
    const attentionItems = deriveAttention({
      connections: connectionAttentionInputs(view.connections),
      gaps: view.gaps,
      sharedAccountCount: view.sharedAccounts.length,
      scoreDrops: [],
    });
    expect(
      attentionItems.some(
        (i) => i.severity === "action" && /connection needs attention/.test(i.title),
      ),
    ).toBe(true);
  });

  it("dedupes the exact-duplicate honesty-gap pair (oauth_actors_missing) to one entry", () => {
    // The seed plants the SAME (kind, detail) gap on two different connector
    // runs for the anthropic connection (activity.ts buildAcmeConnectorRuns) —
    // collectGaps (src/lib/honesty-gaps.ts) must dedupe them to one.
    const oauthGaps = view.gaps.filter((g) => g.kind === "oauth_actors_missing");
    expect(oauthGaps).toHaveLength(1);
  });

  it("includes a shared-accounts attention item", () => {
    const attentionItems = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: view.sharedAccounts.length,
      scoreDrops: [],
    });
    expect(view.sharedAccounts.length).toBeGreaterThan(0);
    expect(attentionItems.some((i) => i.title === "Shared accounts detected")).toBe(
      true,
    );
  });

  it("names Effectiveness as the driver of Product Eng's fluency drop (>=10 pts)", async () => {
    const productEngId = await teamIdByName(acmeScope, "Product Eng");
    const defs = await acmeScope.scores.definitions();
    const fluencyDef = defs.find((d) => d.slug === "fluency" && d.orgId === null)!;
    const allTeamRows = await acmeScope.scores.results({ subjectLevel: "team" });
    const fluencyRows = allTeamRows
      .filter(
        (r) =>
          r.teamId === productEngId &&
          r.periodGrain === "month" &&
          r.definitionId === fluencyDef.id,
      )
      .map((r) => ({ ...r, definitionVersion: fluencyDef.version }));
    const sorted = [...fluencyRows].sort((a, b) =>
      a.periodEnd.localeCompare(b.periodEnd),
    );
    expect(sorted.length).toBeGreaterThanOrEqual(2);
    const previous = sorted[sorted.length - 2];
    const current = sorted[sorted.length - 1];
    const delta = current.value - previous.value;
    expect(delta).toBeLessThanOrEqual(-10);

    const attribution = teamScoreDropAttribution([previous, current]);
    const attentionItems = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [{ slug: "fluency", delta, attribution }],
    });
    const dropItem = attentionItems.find((i) => i.title === "Fluency dropped");
    expect(dropItem).toBeTruthy();
    expect(dropItem!.body).toMatch(/Effectiveness/);
  });

  it("surfaces at most 2 coaching recommendations", () => {
    const cardData = new Map(
      SCORE_SLUGS.map((slug) => {
        const latest = latestTeamScoresBySlug(view.summary.scores).get(slug) ?? null;
        return [
          slug,
          fromDashboardScore({
            slug,
            score: latest,
            definitions: view.definitions,
          }),
        ] as const;
      }),
    );
    const scoreComponents = SCORE_SLUGS.map((slug) => ({
      slug,
      components: cardData.get(slug)!.componentRows,
    }));
    const attentionItems = deriveAttention({
      connections: [],
      gaps: [],
      sharedAccountCount: 0,
      scoreDrops: [],
      scoreComponents,
    });
    const recommendations = attentionItems.filter((i) => i.kind === "recommendation");
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.length).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Segments
// ─────────────────────────────────────────────────────────────────────────

describe("segments (Acme Robotics)", () => {
  it("has all four buckets non-empty and at least one unsegmented person", () => {
    for (const segment of view.segments.segments) {
      expect(segment.count, `segment ${segment.segment} should be non-empty`).toBeGreaterThan(0);
    }
    expect(view.segments.segments).toHaveLength(4);
    expect(view.segments.unsegmented).toBeGreaterThanOrEqual(1);
  });

});

// ─────────────────────────────────────────────────────────────────────────
// 5. Usage distribution + concentration
// ─────────────────────────────────────────────────────────────────────────

describe("usage distribution + concentration (Acme Robotics)", () => {
  it("distribution is available with all four bands populated", () => {
    expect(view.usageDistribution.available).toBe(true);
    if (view.usageDistribution.available) {
      for (const band of view.usageDistribution.bands) {
        expect(band.count, `band ${band.key} should be non-empty`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("concentration is available, top10 share < top25 share, both > 0", () => {
    expect(view.usageConcentration.available).toBe(true);
    if (view.usageConcentration.available) {
      expect(view.usageConcentration.top10SharePct).toBeGreaterThan(0);
      expect(view.usageConcentration.top25SharePct).toBeGreaterThan(0);
      expect(view.usageConcentration.top10SharePct).toBeLessThan(
        view.usageConcentration.top25SharePct,
      );
      expect(view.usageConcentration.excludedPrompts).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Recent movement
// ─────────────────────────────────────────────────────────────────────────

describe("recent movement (Acme Robotics)", () => {
  it("spend and active-people movement are measured with a real previous-window comparison", () => {
    const spend = view.recentMovement.metrics.find((m) => m.key === "reported_spend")!;
    const people = view.recentMovement.metrics.find((m) => m.key === "active_people")!;
    expect(spend.delta.kind).toBe("delta");
    expect(people.delta.kind).toBe("delta");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. Attribution trend
// ─────────────────────────────────────────────────────────────────────────

describe("attribution trend (Acme Robotics)", () => {
  it("has 6+ usage weeks with a positive person-share delta", () => {
    expect(view.attributionTrend.kind).toBe("measured");
    if (view.attributionTrend.kind === "measured") {
      expect(view.attributionTrend.trend.length).toBeGreaterThanOrEqual(6);
      expect(view.attributionTrend.delta.kind).toBe("delta");
      if (view.attributionTrend.delta.kind === "delta") {
        expect(view.attributionTrend.delta.deltaPct).toBeGreaterThan(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. Agentic adoption
// ─────────────────────────────────────────────────────────────────────────

describe("agentic adoption (Acme Robotics)", () => {
  it("is measured with a rate strictly between 0 and 100%, a growing 2+ week trend", () => {
    expect(view.agentic.kind).toBe("measured");
    if (view.agentic.kind === "measured") {
      expect(view.agentic.ratePct).toBeGreaterThan(0);
      expect(view.agentic.ratePct).toBeLessThan(100);
      expect(view.agentic.trend.length).toBeGreaterThanOrEqual(2);
      expect(view.agentic.delta.kind).toBe("delta");
      if (view.agentic.delta.kind === "delta") {
        expect(view.agentic.delta.delta).toBeGreaterThan(0);
      }
    }
  });

  // NOTE: claude_code_local is deliberately excluded from this check. Its
  // real connector (scripts/seed/activity.ts's emitClaudeCodeLocalDay,
  // mirroring the actual local-agent ingest contract) never emits
  // `agent_active` — no source in src/connectors or the agent-ingest path
  // reports that flag for the local channel, matching the honesty rule
  // "never fabricated where a vendor has no agent signal" (src/lib/
  // agentic-adoption.ts). Asserting its presence here would demand a
  // fabricated signal, so this checks the two vendors that legitimately
  // report agent_active (see final report for the full note).
  it("per-vendor coverage includes cursor and copilot", () => {
    expect(view.agentic.kind).toBe("measured");
    if (view.agentic.kind === "measured") {
      const vendors = view.agentic.coveragePerVendor.map((v) => v.sourceConnector);
      expect(vendors.some((v) => v.startsWith("cursor"))).toBe(true);
      expect(vendors.some((v) => v.includes("copilot"))).toBe(true);
    }
  });

  it("has unresolved subjects (the CI service key has no identity link)", () => {
    expect(view.agentic.kind).toBe("measured");
    if (view.agentic.kind === "measured") {
      expect(view.agentic.unresolvedSubjects).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Shared accounts
// ─────────────────────────────────────────────────────────────────────────

describe("shared accounts (Acme Robotics)", () => {
  it("flags shared-anthropic-console high confidence with round_the_clock + concurrent_usage", () => {
    const flag = view.sharedAccounts.find((f) => f.externalId === "shared-team-login");
    expect(flag).toBeTruthy();
    expect(flag!.confidence).toBe("high");
    expect(flag!.reasons).toContain("round_the_clock");
    expect(flag!.reasons).toContain("concurrent_usage");
    expect(flag!.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag svc-ci-runner as shared but does count it unresolved", async () => {
    const flag = view.sharedAccounts.find((f) => f.externalId === "svc-ci-runner");
    expect(flag).toBeUndefined();

    const subjects = await acmeScope.subjects.list();
    const svc = subjects.find((s) => s.externalId === "svc-ci-runner");
    expect(svc).toBeTruthy();
    const links = await acmeScope.identities.forSubject(svc!.id);
    expect(links).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. Spend governance
// ─────────────────────────────────────────────────────────────────────────

describe("spend governance", () => {
  it("Acme's budget alert crosses 80 (not 100) and is not over budget", async () => {
    const spend = await readSpendGovernance(acmeScope, todayUtc());
    expect(spend.alert).toBeTruthy();
    expect(spend.alert!.crossedThreshold).toBe(DEFAULT_ALERT_THRESHOLDS[1]);
    expect(spend.alert!.overBudget).toBe(false);
  });

  it("Globex is over budget", async () => {
    const globexScope = forOrg(db, orgId("Globex Pilot"));
    const spend = await readSpendGovernance(globexScope, todayUtc());
    expect(spend.alert).toBeTruthy();
    expect(spend.alert!.overBudget).toBe(true);
  });

  it("Acme's month-end projection exceeds month-to-date spend", async () => {
    const spend = await readSpendGovernance(acmeScope, todayUtc());
    expect(spend.projection).toBeTruthy();
    expect(spend.projection!.projectedMonthEndCents).toBeGreaterThan(
      spend.projection!.reportedMtdCents,
    );
  });

  it("Acme's model-mix trend shows gpt-5 falling and claude-sonnet-5 rising", async () => {
    const spend = await readSpendGovernance(acmeScope, todayUtc());
    expect(spend.modelMixTrend.available).toBe(true);
    if (spend.modelMixTrend.available) {
      expect(spend.modelMixTrend.weeks.length).toBeGreaterThanOrEqual(2);
      const gpt5 = spend.modelMixTrend.shifts.find((s) => s.model === "gpt-5");
      const sonnet = spend.modelMixTrend.shifts.find(
        (s) => s.model === "claude-sonnet-5",
      );
      expect(gpt5).toBeTruthy();
      expect(sonnet).toBeTruthy();
      expect(gpt5!.shiftPct).toBeLessThan(0);
      expect(sonnet!.shiftPct).toBeGreaterThan(0);
    }
  });

  it("Acme's cost-per-unit is non-null for both active-day and prompt denominators", async () => {
    const spend = await readSpendGovernance(acmeScope, todayUtc());
    expect(spend.costPerActiveDay).toBeTruthy();
    expect(spend.costPerPrompt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Scoring honesty (team-scoped, direct score_results reads)
// ─────────────────────────────────────────────────────────────────────────

describe("scoring honesty (Acme Robotics)", () => {
  it("Platform's current-month fluency result omits effectiveness (newlyUnmeasured)", async () => {
    const platformId = await teamIdByName(acmeScope, "Platform");
    const fluencyDefId = (await acmeScope.scores.definitions()).find(
      (d) => d.slug === "fluency" && d.orgId === null,
    )!.id;
    const rows = (await acmeScope.scores.results({ subjectLevel: "team" })).filter(
      (r) => r.teamId === platformId && r.definitionId === fluencyDefId && r.periodGrain === "month",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const current = [...rows].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
    const components = current.components as Record<string, unknown>;
    expect("effectiveness" in components).toBe(false);
  });

  it("Product Eng's fluency drops 10+ points month over month", async () => {
    const productEngId = await teamIdByName(acmeScope, "Product Eng");
    const fluencyDefId = (await acmeScope.scores.definitions()).find(
      (d) => d.slug === "fluency" && d.orgId === null,
    )!.id;
    const rows = (await acmeScope.scores.results({ subjectLevel: "team" })).filter(
      (r) => r.teamId === productEngId && r.definitionId === fluencyDefId && r.periodGrain === "month",
    );
    const sorted = [...rows].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    expect(sorted.length).toBeGreaterThanOrEqual(2);
    const previous = sorted[sorted.length - 2];
    const current = sorted[sorted.length - 1];
    expect(current.value - previous.value).toBeLessThanOrEqual(-10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 12. Tracked users / billing
// ─────────────────────────────────────────────────────────────────────────

describe("tracked users / billing (Acme Robotics)", () => {
  it("resolves 10+ tracked users, surfaces unresolved subjects, never double-counts a shared subject's people", async () => {
    const tracked = await acmeScope.billing.trackedUsers({
      start: "2020-01-01",
      end: ANCHOR_DAY,
    });
    expect(tracked.trackedPersonIds.length).toBeGreaterThanOrEqual(10);
    expect(tracked.unresolvedSubjectIds.length).toBeGreaterThan(0);
    // Every tracked person appears once — a shared subject linked to N
    // people surfaces N distinct persons, never inflates beyond the real
    // person count.
    expect(new Set(tracked.trackedPersonIds).size).toBe(tracked.trackedPersonIds.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 13. Custom indexes
// ─────────────────────────────────────────────────────────────────────────

describe("custom indexes (Acme Robotics)", () => {
  it("has custom-agentic-momentum active and custom-legacy-pilot retired", async () => {
    const customDefs = await acmeScope.scores.customDefinitions();
    const momentum = customDefs.find(
      (d) => d.slug === "custom-agentic-momentum" && d.status === "active",
    );
    expect(momentum).toBeTruthy();
    expect(
      customDefs.some((d) => d.slug === "custom-legacy-pilot" && d.status === "active"),
    ).toBe(false);
    expect(
      customDefs.some((d) => d.slug === "custom-legacy-pilot" && d.status === "retired"),
    ).toBe(true);
  });

  it("has a score_results row for the active custom index (recompute ran with the Team subscription)", async () => {
    const customDefs = await acmeScope.scores.customDefinitions();
    const momentum = customDefs.find(
      (d) => d.slug === "custom-agentic-momentum" && d.status === "active",
    )!;
    const rows = await acmeScope.scores.results({ definitionId: momentum.id });
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 14. Benchmarks + consent + share + invite + audit
// ─────────────────────────────────────────────────────────────────────────

describe("benchmarks, consent, share links, invites, audit log", () => {
  it("a verified benchmark row is readable via the personal-page reader", async () => {
    const rows = await listBenchmarks(db, { status: "verified", segment: "overall" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.scoreSlug === "fluency" && r.componentKey === "effectiveness")).toBe(
      true,
    );
  });

  it("Acme has a granted benchmark-consent row", async () => {
    const rows = await benchmarkConsentForOrg(db, acmeId).list();
    expect(rows.some((r) => r.granted)).toBe(true);
  });

  it("Acme has one resolvable (active, non-revoked) share link", async () => {
    const rows = await shareLinksForOrg(db, acmeId).list();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.scoreSlug === "fluency" && r.revokedAt === null)).toBe(true);
  });

  it("Acme has one pending invite", async () => {
    const rows = await invitesForOrg(db, acmeId).listPending();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("Acme's audit log is non-empty", async () => {
    const rows = await acmeScope.auditLog.list();
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 15. Onboarding orgs
// ─────────────────────────────────────────────────────────────────────────

describe("onboarding orgs (channel classification + interim bridge)", () => {
  const cases: { name: string; expectedChannel: string }[] = [
    { name: "Onboarding — Same Day", expectedChannel: "same_day" },
    { name: "Onboarding — Overnight", expectedChannel: "overnight" },
    { name: "Onboarding — Awaiting Agent", expectedChannel: "awaiting_agent" },
    { name: "Onboarding — Mixed", expectedChannel: "mixed" },
  ];

  for (const { name, expectedChannel } of cases) {
    it(`${name} classifies as ${expectedChannel} and has a non-null onboarding interim`, async () => {
      const scope = forOrg(db, orgId(name));
      const connections = await scope.connections.list();
      const channel = scoreTimingChannel(connections);
      expect(channel).toBe(expectedChannel);
      const interim = buildOnboardingInterim({ connections, scoresExist: false });
      expect(interim).not.toBeNull();
      expect(interim!.channel).toBe(expectedChannel);
    });
  }

  it("Acme (scores exist) has a null onboarding interim", async () => {
    const connections = await acmeScope.connections.list();
    const interim = buildOnboardingInterim({ connections, scoresExist: true });
    expect(interim).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 16. Jordan Lee personal org (JORDAN SPEC)
// ─────────────────────────────────────────────────────────────────────────

describe("Jordan Lee personal org (JORDAN SPEC)", () => {
  let jordanId: string;
  let jordanScope: OrgScopedDb;

  beforeAll(() => {
    jordanId = orgId("Jordan Lee");
    jordanScope = forOrg(db, jordanId);
  });

  it("org kind is personal", async () => {
    const [row] = await db
      .select({ kind: schema.orgs.kind })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, jordanId));
    expect(row?.kind).toBe("personal");
  });

  it("has org-scoped person-level preset definitions (ADR 0014)", async () => {
    const defs = await jordanScope.scores.definitions();
    const personDefs = defs.filter((d) => d.orgId === jordanId && d.subjectLevel === "person");
    expect(personDefs.map((d) => d.slug).sort()).toEqual(["adoption", "efficiency", "fluency"]);
  });

  it("has person-level score_results for adoption, fluency, and efficiency at month grain for both June and July", async () => {
    const [rows, defs] = await Promise.all([
      jordanScope.scores.results({ subjectLevel: "person" }),
      jordanScope.scores.definitions(),
    ]);
    const slugById = new Map(defs.map((d) => [d.id, d.slug]));
    const monthRows = rows.filter((r) => r.periodGrain === "month");
    for (const slug of SCORE_SLUGS) {
      const slugRows = monthRows.filter((r) => slugById.get(r.definitionId) === slug);
      const juneRow = slugRows.find((r) => r.periodStart.startsWith("2026-06"));
      const julyRow = slugRows.find((r) => r.periodStart.startsWith("2026-07"));
      expect(juneRow, `${slug}: expected a June person-level month result`).toBeTruthy();
      expect(julyRow, `${slug}: expected a July person-level month result`).toBeTruthy();
    }
  });

  it("fluency's components breakdown omits effectiveness (personal mode has no suggestion metrics)", async () => {
    const [rows, defs] = await Promise.all([
      jordanScope.scores.results({ subjectLevel: "person" }),
      jordanScope.scores.definitions(),
    ]);
    const fluencyDefIds = new Set(defs.filter((d) => d.slug === "fluency").map((d) => d.id));
    const fluencyRows = rows.filter(
      (r) => r.periodGrain === "month" && fluencyDefIds.has(r.definitionId),
    );
    expect(fluencyRows.length).toBeGreaterThan(0);
    for (const row of fluencyRows) {
      const components = row.components as Record<string, unknown>;
      expect("effectiveness" in components).toBe(false);
    }
  });

  it("efficiency's result attribution is 'account' (degraded via the manually-linked account spend subject)", async () => {
    const [rows, defs] = await Promise.all([
      jordanScope.scores.results({ subjectLevel: "person" }),
      jordanScope.scores.definitions(),
    ]);
    const efficiencyDefIds = new Set(
      defs.filter((d) => d.slug === "efficiency").map((d) => d.id),
    );
    const efficiencyRows = rows.filter(
      (r) => r.periodGrain === "month" && efficiencyDefIds.has(r.definitionId),
    );
    expect(
      efficiencyRows.length,
      "expected person-level efficiency results for Jordan",
    ).toBeGreaterThan(0);
    for (const row of efficiencyRows) {
      expect(row.attribution).toBe("account");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 17. Tenant sanity (spot check — the full sweep lives in
// tests/tenant-isolation.test.ts)
// ─────────────────────────────────────────────────────────────────────────

describe("tenant sanity (Globex sees none of Acme's people/subjects)", () => {
  it("Globex's people/subjects share no pseudonym or externalId with Acme's", async () => {
    const globexScope = forOrg(db, orgId("Globex Pilot"));
    const [acmePeople, globexPeople, acmeSubjects, globexSubjects] = await Promise.all([
      acmeScope.people.list(),
      globexScope.people.list(),
      acmeScope.subjects.list(),
      globexScope.subjects.list(),
    ]);
    const acmePseudonyms = new Set(acmePeople.map((p) => p.pseudonym));
    const acmeExternalIds = new Set(acmeSubjects.map((s) => s.externalId));

    expect(globexPeople.length).toBeGreaterThan(0);
    expect(globexSubjects.length).toBeGreaterThan(0);
    for (const p of globexPeople) {
      expect(acmePseudonyms.has(p.pseudonym)).toBe(false);
    }
    for (const s of globexSubjects) {
      expect(acmeExternalIds.has(s.externalId)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 18. Drift tripwires — the generator's copies of shared shapes vs. their
// real sources of truth, so a future edit to either side fails loudly
// instead of silently diverging (CLAUDE.md fix #12).
// ─────────────────────────────────────────────────────────────────────────

describe("drift tripwires (generator vs. sources of truth)", () => {
  it("PERSON_PRESET_CLONES deep-equals fixtures/score-definitions/personal-presets.json", () => {
    expect(PERSON_PRESET_CLONES).toEqual(personalPresets.definitions);
  });

  it("SOURCE_CONNECTOR values equal the registered connectors' sourceConnector strings", () => {
    const vendorByKey = new Map(ACME_CONNECTIONS.map((c) => [c.key, c.vendor]));
    let checked = 0;
    for (const [key, sourceConnector] of Object.entries(SOURCE_CONNECTOR)) {
      const vendor = vendorByKey.get(key);
      expect(vendor, `ACME_CONNECTIONS has no entry for SOURCE_CONNECTOR key '${key}'`).toBeTruthy();
      const registered = getConnector(vendor!);
      if (!registered) {
        // claude_code_local is a local-agent push with no polled connector
        // registered — the one intentional gap; anything else missing here
        // is a real drift, not an intentional exception.
        expect(key, `'${key}' (vendor '${vendor}') has no registered connector`).toBe(
          "claude_code_local",
        );
        continue;
      }
      expect(registered.sourceConnector, `${key} (${vendor})`).toBe(sourceConnector);
      checked++;
    }
    // The 4 polled vendors (anthropic, openai, cursor, copilot) must all
    // have been checked — guards against the skip branch above silently
    // swallowing every entry.
    expect(checked).toBe(4);
  });
});
