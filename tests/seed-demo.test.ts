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
  OTEL_MARKER_PERSONAS,
  OTEL_MARKER_SOURCE_CONNECTOR,
  PERSON_PRESET_CLONES,
  SOURCE_CONNECTOR,
  buildDemoSeedPlan,
} from "../scripts/seed/activity";
import {
  ACME_EMAIL_DOMAIN,
  ACME_PEOPLE,
  JORDAN_EMAIL,
} from "../scripts/seed/personas";
import { membershipsForUser } from "../src/db/org-context";
import { OTEL_MARKER_METRIC_KEYS } from "../src/contracts/metrics";
import { OTEL_SOURCE } from "../src/lib/otel-receiver";
import { overallCapabilityBand } from "../src/lib/capability-glossary";
import { recentlyShownRecIds } from "../src/lib/recommendation-catalog";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "../src/lib/segments";
import { CAPABILITY_STATE_CONSTANTS } from "../src/scoring/capability-state";
import { recomputeTeamInsights } from "../src/scoring/recompute-team-insights";
import { readMaturityView } from "../src/lib/maturity";
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
      // W6-C: the seeded per-org catalog, carried on the composed view.
      recommendations: view.recommendations,
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

  it("OTel marker source tag equals the real receiver's OTEL_SOURCE", () => {
    expect(OTEL_MARKER_SOURCE_CONNECTOR).toBe(OTEL_SOURCE);
  });

  it("the generator is deterministic: same anchor → deep-equal plan", () => {
    expect(buildDemoSeedPlan(ANCHOR_DAY)).toEqual(buildDemoSeedPlan(ANCHOR_DAY));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 19. Roles & team governance (migs 0026/0036/0039) — the Settings roster,
// manager grants, and the D-TCI-2 per-team spend toggle.
// ─────────────────────────────────────────────────────────────────────────

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!row) throw new Error(`no seeded auth user for ${email}`);
  return row.id;
}

// One shared scope per org (also what makes the person-lookup memo below
// effective — a fresh forOrg() per test would defeat the per-scope cache).
const scopeByOrgName = new Map<string, OrgScopedDb>();
function scopeFor(name: string): OrgScopedDb {
  let scope = scopeByOrgName.get(name);
  if (!scope) {
    scope = forOrg(db, orgId(name));
    scopeByOrgName.set(name, scope);
  }
  return scope;
}

// Memoized per scope: several tests below resolve a dozen pseudonyms each,
// and re-running people.list() per lookup would serialize dozens of
// identical queries through PGlite's single session.
const peopleByScope = new Map<OrgScopedDb, Map<string, string>>();

async function personIdByPseudonym(
  scope: OrgScopedDb,
  pseudonym: string,
): Promise<string> {
  let byPseudonym = peopleByScope.get(scope);
  if (!byPseudonym) {
    const people = await scope.people.list();
    byPseudonym = new Map(people.map((p) => [p.pseudonym, p.id]));
    peopleByScope.set(scope, byPseudonym);
  }
  const personId = byPseudonym.get(pseudonym);
  if (!personId) throw new Error(`person '${pseudonym}' not found`);
  return personId;
}

describe("roles & team governance (Acme)", () => {
  it("every persona has a role assignment whose slug exists in the global roles table", async () => {
    const [assignments, roleRows, people] = await Promise.all([
      acmeScope.roles.assignments(),
      acmeScope.roles.list(),
      acmeScope.people.list(),
    ]);
    expect(assignments.length).toBe(ACME_PEOPLE.length);

    // Drift tripwire vs mig 0026: a persona role slug absent from the seeded
    // reference table means personas.ts drifted (or a role was retired).
    const validSlugs = new Set(roleRows.map((r) => r.slug));
    const idByPseudonym = new Map(people.map((p) => [p.pseudonym, p.id]));
    const assignedByPersonId = new Map(assignments.map((a) => [a.personId, a.roleSlug]));
    for (const persona of ACME_PEOPLE) {
      expect(validSlugs.has(persona.role), `role '${persona.role}'`).toBe(true);
      expect(
        assignedByPersonId.get(idByPseudonym.get(persona.pseudonym)!),
        persona.pseudonym,
      ).toBe(persona.role);
    }
  });

  it("the manager user manages Product Eng, and only Product Eng shows individual cost", async () => {
    const productEngId = await teamIdByName(acmeScope, "Product Eng");
    const platformId = await teamIdByName(acmeScope, "Platform");

    const managers = await acmeScope.teamManagers.list();
    expect(managers).toHaveLength(1);
    expect(managers[0].teamId).toBe(productEngId);
    expect(managers[0].userId).toBe(
      await userIdByEmail(`amber-lynx@${ACME_EMAIL_DOMAIN}`),
    );

    // Product Eng flipped the D-TCI-2 toggle; Platform has NO row and reads
    // the absent-row default — the settings contrast the demo needs.
    expect((await acmeScope.teamSettings.get(productEngId)).managersSeeIndividualCost).toBe(true);
    expect((await acmeScope.teamSettings.get(platformId)).managersSeeIndividualCost).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 20. Email-lane send state — exec report, renewal reminders, budget
// alerts, digest preferences. The seed pre-claims everything its data has
// already "sent", so a live cron against a seeded DB never emails fixture
// addresses; each claim's CAS must therefore LOSE on replay.
// ─────────────────────────────────────────────────────────────────────────

describe("email-lane send state", () => {
  it("exec report: opted in, anchor month claimed, cron replay loses", async () => {
    const state = await acmeScope.execReportState.get();
    expect(state?.execReportEnabled).toBe(true);
    expect(state?.lastSentMonth).toBe("2026-07");
    expect(await acmeScope.execReportState.claimMonth("2026-07")).toBe(false);
  });

  it("renewals: dates stored on the connections, both thresholds pre-claimed", async () => {
    const connections = await acmeScope.connections.list();
    const cursor = connections.find((c) => c.displayName === "Cursor");
    const legacy = connections.find((c) => c.displayName === "OpenAI (legacy key)");
    expect(cursor?.renewalDate).toBe("2026-07-31"); // anchor + 21
    expect(legacy?.renewalDate).toBe("2026-07-15"); // anchor + 5 (urgent)

    const claims = await acmeScope.renewalReminderState.list();
    expect(claims).toHaveLength(4); // 2 connections × [30, 7]
    // A daily-cron replay of an already-claimed threshold must lose (CAS).
    expect(
      await acmeScope.renewalReminderState.claim(cursor!.id, "2026-07-31", 7),
    ).toBe(false);
  });

  it("budget alerts: Acme claimed through 80 (≈85% MTD), Globex through 100 (over budget)", async () => {
    expect(
      (await acmeScope.budgetAlertState.get("2026-07"))?.highestAlertedThreshold,
    ).toBe(80);
    const globexScope = scopeFor("Globex Pilot");
    expect(
      (await globexScope.budgetAlertState.get("2026-07"))?.highestAlertedThreshold,
    ).toBe(100);
    // Replaying an already-claimed crossing loses; the NEXT threshold wins.
    expect(await acmeScope.budgetAlertState.claimThreshold("2026-07", 80)).toBe(false);
  });

  it("digest preferences: an explicit opt-out and an explicit opt-in", async () => {
    const taraId = await userIdByEmail(`tara.cto@${ACME_EMAIL_DOMAIN}`);
    const deviId = await userIdByEmail(`sable-wren@${ACME_EMAIL_DOMAIN}`);
    expect((await acmeScope.digestPreferences.getForUser(taraId))?.digestEnabled).toBe(false);
    expect((await acmeScope.digestPreferences.getForUser(deviId))?.digestEnabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 21. Capability mastery & the OTel measured tier (migs 0030/0031/0034) —
// derived by the REAL reducer from the seeded evidence, never written by
// the loader.
// ─────────────────────────────────────────────────────────────────────────

describe("capability mastery & the OTel measured tier", () => {
  it("brisk-falcon is measured ONLY where ≥2 bound markers carry evidence", async () => {
    const rows = await acmeScope.mastery.forPerson(
      await personIdByPseudonym(acmeScope, "brisk-falcon"),
    );
    const tierBySlug = new Map(rows.map((r) => [r.capabilitySlug, r.confidenceTier]));
    // effective-prompting (3 bound markers) + ship-with-ai (2) upgrade;
    // agentic-delivery binds only otel_active_time — 1 < MEASURED_MARKER_MIN,
    // so it stays directional even though the person ships markers.
    expect(tierBySlug.get("effective-prompting")).toBe("measured");
    expect(tierBySlug.get("ship-with-ai")).toBe("measured");
    expect(tierBySlug.get("agentic-delivery")).toBe("directional");
    // Everyone else in the org is directional-only (no OTel channel).
    const allRows = await Promise.all(
      ACME_PEOPLE.filter(
        (p) => !OTEL_MARKER_PERSONAS.has(p.key) && p.vendors.length > 0,
      ).map(async (p) =>
        acmeScope.mastery.forPerson(await personIdByPseudonym(acmeScope, p.pseudonym)),
      ),
    );
    for (const row of allRows.flat()) {
      expect(row.confidenceTier, row.capabilitySlug).toBe("directional");
    }
  });

  it("honesty: the no-signal and churned personas have NO capability rows", async () => {
    // idle-newt has no subjects at all; wistful-stoat's evidence is >42 days
    // stale (grace 14 + decay span 28) — both must be withheld, never a 0.
    for (const pseudonym of ["idle-newt", "wistful-stoat"]) {
      const rows = await acmeScope.mastery.forPerson(
        await personIdByPseudonym(acmeScope, pseudonym),
      );
      expect(rows, pseudonym).toHaveLength(0);
    }
  });

  it("marker records: canonical keys, the real receiver's source tag, only on OTel personas' subjects", async () => {
    const [subjects, identities] = await Promise.all([
      acmeScope.subjects.list(),
      acmeScope.identities.all(),
    ]);
    const falconId = await personIdByPseudonym(acmeScope, "brisk-falcon");
    const falconSubjects = new Set(
      identities.filter((i) => i.personId === falconId).map((i) => i.subjectId),
    );
    expect(subjects.length).toBeGreaterThan(0);

    let markerRows = 0;
    for (const metricKey of OTEL_MARKER_METRIC_KEYS) {
      const rows = await acmeScope.metrics.records({
        metricKey,
        from: "2026-01-01",
        to: ANCHOR_DAY,
      });
      for (const row of rows) {
        markerRows++;
        expect(row.sourceConnector).toBe(OTEL_SOURCE);
        expect(row.attribution).toBe("person");
        expect(falconSubjects.has(row.subjectId), "marker on a non-OTel subject").toBe(true);
      }
    }
    expect(markerRows).toBeGreaterThan(0); // anti-vacuity
  });

  it("Jordan's measured rows activate the Growth-Journey capability band", async () => {
    const jordanScope2 = scopeFor("Jordan Lee");
    const rows = await jordanScope2.mastery.forPerson(
      await personIdByPseudonym(jordanScope2, "solo-fox"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.confidenceTier === "measured")).toBe(true);
    // The W7-4 headline gate: null until ≥1 measured row exists.
    expect(overallCapabilityBand(rows)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 22. Missions (mig 0032) — opt-in starts seeded, completion stamped ONLY
// by the reducer's measured crossing.
// ─────────────────────────────────────────────────────────────────────────

describe("missions", () => {
  it("every seeded mission slug exists in the global catalog (drift tripwire vs mig 0032)", async () => {
    const catalog = await acmeScope.missions.catalog();
    const validSlugs = new Set(catalog.missions.map((m) => m.slug));
    const plan = buildDemoSeedPlan(ANCHOR_DAY);
    const starts = plan.orgs.flatMap((o) => o.missionStarts ?? []);
    expect(starts.length).toBeGreaterThan(0); // anti-vacuity
    for (const start of starts) {
      expect(validSlugs.has(start.missionSlug), start.missionSlug).toBe(true);
    }
  });

  it("tri-state: reducer-completed, honestly stuck in-progress, and not-started", async () => {
    const progress = await acmeScope.missions.progressForOrg();
    const falconId = await personIdByPseudonym(acmeScope, "brisk-falcon");
    const wrenId = await personIdByPseudonym(acmeScope, "sable-wren");
    const otterId = await personIdByPseudonym(acmeScope, "quiet-otter");

    // brisk-falcon: both starts completed by the derived pass, and the
    // measured-crossing stamp postdates the backdated opt-in.
    const falcon = progress.filter((r) => r.personId === falconId);
    expect(falcon).toHaveLength(2);
    for (const row of falcon) {
      expect(row.completedAt, row.missionSlug).not.toBeNull();
      expect(row.completedAt!.getTime()).toBeGreaterThan(row.startedAt.getTime());
    }

    // sable-wren (OpenAI-only): ship-work-with-ai can never complete —
    // effective-prompting has NO evidence for her (no suggestions metrics,
    // no markers), and isMissionComplete fails closed on a missing
    // capability. get-started-with-ai did complete (real active days).
    const wren = new Map(
      progress
        .filter((r) => r.personId === wrenId)
        .map((r) => [r.missionSlug, r.completedAt]),
    );
    expect(wren.get("ship-work-with-ai")).toBeNull();
    expect(wren.get("get-started-with-ai")).not.toBeNull();

    // Everyone who never opted in has NO row (opt-in only, never auto).
    expect(progress.some((r) => r.personId === otterId)).toBe(false);
  });

  it("Jordan completed both missions through the reducer", async () => {
    const jordanScope2 = scopeFor("Jordan Lee");
    const progress = await jordanScope2.missions.progressForOrg();
    expect(progress).toHaveLength(2);
    for (const row of progress) {
      expect(row.completedAt, row.missionSlug).not.toBeNull();
      expect(row.completedAt!.getTime()).toBeGreaterThan(row.startedAt.getTime());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 23. Team capability history & insights (migs 0038/0040) + the MIN_PEOPLE
// coverage floor contrast (Acme clears it, Globex sits under it).
// ─────────────────────────────────────────────────────────────────────────

describe("team capability history & insights", () => {
  it("Acme has history rows for both derived periods (prev month + current)", async () => {
    const rows = await acmeScope.capabilityHistory.list();
    const periods = new Set(rows.map((r) => `${r.periodStart}..${r.periodEnd}`));
    expect(periods.has("2026-06-01..2026-06-30")).toBe(true);
    expect(periods.has("2026-07-01..2026-07-31")).toBe(true);
  });

  it("Acme has open team insights, and re-running the engine is idempotent", async () => {
    const before = await acmeScope.teamInsights.listOpen();
    expect(before.length).toBeGreaterThan(0);
    await recomputeTeamInsights(db, acmeId, { asOfDay: ANCHOR_DAY });
    const after = await acmeScope.teamInsights.listOpen();
    expect(after.map((r) => `${r.category}:${r.subject}`).sort()).toEqual(
      before.map((r) => `${r.category}:${r.subject}`).sort(),
    );
  });

  it("coverage floor: Acme clears MIN_PEOPLE on some capabilities, Globex on none", async () => {
    const threshold = CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD;
    const acmeCounts = await acmeScope.mastery.coverageCounts(threshold);
    expect(
      [...acmeCounts.values()].some(
        (c) => c.withState >= SEGMENT_MIN_PEOPLE_TO_NAME,
      ),
    ).toBe(true);

    // Globex derived per-person rows too (self-views work), but with 3
    // people every capability sits under the naming floor — the team card's
    // honest small-team empty state.
    const globexScope = scopeFor("Globex Pilot");
    const globexCounts = await globexScope.mastery.coverageCounts(threshold);
    expect(globexCounts.size).toBeGreaterThan(0);
    for (const [slug, c] of globexCounts) {
      expect(c.withState, slug).toBeLessThan(SEGMENT_MIN_PEOPLE_TO_NAME);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 24. Recommendation lifecycle (migs 0024/0033) — interaction tri-state,
// exposure log, and the COACH-004 novelty window.
// ─────────────────────────────────────────────────────────────────────────

describe("recommendation lifecycle", () => {
  it("the coach persona carries all three interaction states, ids from the live catalog", async () => {
    const deviId = await userIdByEmail(`sable-wren@${ACME_EMAIL_DOMAIN}`);
    const states = await acmeScope.recInteractions.statesForUser(deviId);
    expect(new Set(states.map((s) => s.state))).toEqual(
      new Set(["snoozed", "dismissed", "tried"]),
    );

    // Drift tripwire vs mig 0029: every seeded recId must be a live catalog
    // slug, or the interaction/exposure rows point at nothing.
    const catalog = await acmeScope.catalog.list();
    const validIds = new Set(catalog.map((c) => c.id));
    for (const s of states) {
      expect(validIds.has(s.recId), s.recId).toBe(true);
    }

    // The snooze is still live at the frozen "now" (expires anchor + 7).
    const snoozed = states.find((s) => s.state === "snoozed");
    expect(snoozed?.snoozeUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("exposures land inside the novelty lookback and rotate those recs", async () => {
    const deviId = await userIdByEmail(`sable-wren@${ACME_EMAIL_DOMAIN}`);
    const exposures = await acmeScope.exposures.forUser(deviId);
    expect(exposures).toHaveLength(2);

    const catalog = await acmeScope.catalog.list();
    const validIds = new Set(catalog.map((c) => c.id));
    for (const e of exposures) {
      expect(validIds.has(e.recId), e.recId).toBe(true);
    }

    // Both exposure days sit in the previous-1..7-day window (excluding
    // today), so the shared novelty derivation picks them up — the exact
    // set the dashboard AND digest would deprioritize.
    expect(recentlyShownRecIds(exposures, new Date())).toEqual(
      new Set(["adoption-active-days", "fluency-depth"]),
    );
  });

  it("Jordan carries the LIVE lifecycle states (his companion is the only rendered coaching card while team-org companions stay gated)", async () => {
    const jordanUserId = await userIdByEmail(JORDAN_EMAIL);
    const jordanScope2 = scopeFor("Jordan Lee");
    const states = await jordanScope2.recInteractions.statesForUser(jordanUserId);
    expect(new Set(states.map((s) => s.state))).toEqual(
      new Set(["tried", "dismissed"]),
    );
    const exposures = await jordanScope2.exposures.forUser(jordanUserId);
    expect(recentlyShownRecIds(exposures, new Date())).toEqual(
      new Set(["adoption-tool-coverage"]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 26. Maturity level placement — the Growth-Journey headline, the AI
// maturity board, and the exec report all render THE LEVEL only when
// activation is computable: people must be KNOWN (created_at) as of the
// window end (knownPeopleAsOf, F3). The fixture loader stamps created_at =
// seed-run time, which postdates every data window — peopleCreatedOn
// backdates it, or the level is structurally unplaceable on seeded data.
// ─────────────────────────────────────────────────────────────────────────

describe("maturity level placement", () => {
  it("Acme and Jordan both place a level (activation computable)", async () => {
    const acmeView = await readMaturityView(acmeScope, todayUtc());
    expect(acmeView.axes.activationPct).not.toBeNull();
    expect(acmeView.axes.activationPct!).toBeGreaterThan(50);
    expect(acmeView.level, "Acme level").not.toBeNull();

    const jordanView = await readMaturityView(scopeFor("Jordan Lee"), todayUtc());
    expect(jordanView.level, "Jordan level").not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 25. Workspace switcher (mig 0041, ADR 0051) — one user in two orgs with
// the personal org pinned active via the production switch seam.
// ─────────────────────────────────────────────────────────────────────────

describe("workspace switcher", () => {
  it("Jordan belongs to both orgs, personal org active-first", async () => {
    const jordanUserId = await userIdByEmail(JORDAN_EMAIL);
    const memberships = await membershipsForUser(db, jordanUserId);
    expect(memberships.map((m) => m.orgName)).toEqual([
      "Jordan Lee",
      "Acme Robotics",
    ]);
  });
});
