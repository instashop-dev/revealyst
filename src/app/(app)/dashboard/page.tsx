import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Cable,
  Gauge,
  Info,
  Lightbulb,
  TriangleAlert,
  UsersRound,
  Wallet,
} from "lucide-react";
import { BenchmarkConsentToggle } from "@/components/benchmark-consent-toggle";
import { CapabilityProfileCard } from "@/components/companion/capability-profile-card";
import { CoachingCard } from "@/components/companion/coaching-card";
import { DailyNudgeCard } from "@/components/companion/daily-nudge-card";
import { DiagnosticDetails } from "@/components/companion/diagnostic-details";
import { GrowthJourneyCard } from "@/components/companion/growth-journey-card";
import { MilestoneCard } from "@/components/companion/milestone-card";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { AgenticAdoptionCard } from "@/components/dashboard/agentic-adoption-card";
import { AttributionTrendCard } from "@/components/dashboard/attribution-trend-card";
import { BenchmarkPanel } from "@/components/dashboard/benchmark-panel";
import {
  DataTrustCard,
  type CoverageAggregate,
} from "@/components/dashboard/data-trust-card";
import { MaturityExportButton } from "@/components/dashboard/maturity-export-button";
import { PeriodNarrativeCard } from "@/components/dashboard/period-narrative-card";
import { RecentMovementPanel } from "@/components/dashboard/recent-movement-panel";
import { ScoreTrend } from "@/components/dashboard/score-trend";
import { SegmentBreakdown } from "@/components/dashboard/segment-breakdown";
import { SharedAccountFlags } from "@/components/dashboard/shared-account-flags";
import { ToolCoveragePanel } from "@/components/dashboard/tool-coverage-panel";
import { CapabilityCoverageCard } from "@/components/dashboard/capability-coverage-card";
import { TrainingOpportunitiesCard } from "@/components/dashboard/training-opportunities-card";
import { UsageConcentrationPanel } from "@/components/dashboard/usage-concentration-panel";
import { UsageDistributionPanel } from "@/components/dashboard/usage-distribution-panel";
import { MaturityAxisMeters } from "@/components/maturity/maturity-axis-meters";
import { MaturityLevelBanner } from "@/components/maturity/maturity-level-banner";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { OnboardingInterim } from "@/components/onboarding-interim";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { CollapsibleSection } from "@/components/collapsible-section";
import { ScoreCard, type ScoreCardData } from "@/components/scores/score-card";
import {
  fromDashboardScore,
  fromPersonalScore,
  type PersonalScore,
} from "@/components/scores/score-card-model";
import { ShareScoreButton } from "@/components/share-score-button";
import { BudgetAlertBanner } from "@/components/spend/budget-alert-banner";
import { SyncStalenessBanner } from "@/components/sync-staleness-banner";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listBenchmarks } from "@/db/benchmarks";
import {
  AGENTIC_WINDOW_DAYS,
  computeAgenticAdoption,
} from "@/lib/agentic-adoption";
import { SYNC_STALE_AFTER_DAYS } from "@/lib/agent-sync";
import { detectDailySpike } from "@/lib/anomaly";
import { requireAppContext, type AppContext } from "@/lib/api-context";
import { dashboardSummary } from "@/lib/api-impl";
import {
  buildDailyNudge,
  COMPANION_HEADER,
} from "@/lib/companion-glossary";
import { latestTeamScoresBySlug } from "@/lib/dashboard-read";
import { readDashboardView } from "@/lib/dashboard-view";
import { readMaturityView, type CostPerActiveUserNumber } from "@/lib/maturity";
import { formatCents } from "@/lib/format";
import { readBudgetAlertForRole, todayUtc } from "@/lib/spend-governance";
import {
  CONCEPT_GLOSSARY,
  methodologyAnchor,
  SCORE_SLUGS,
  type ScoreSlug,
} from "@/lib/metrics-glossary";
import { isUsableConnection, syncedToolCount } from "@/lib/onboarding-guide";
import { timeStage } from "@/lib/request-timing";
import { computeSignalCoverage } from "@/lib/signal-coverage";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";
import {
  connectionAttentionInputs,
  deriveAttention,
  deriveDelta,
  featureBreadthFromBreakdown,
  featureBreadthFromRows,
  personDeltaResult,
  personScoreDropAttribution,
  teamScoreDropAttribution,
  type AttentionItem,
  type DeltaResult,
} from "@/lib/score-insights";
import { detectMilestones } from "@/lib/milestones";
import { compareWorkflowDiversity } from "@/lib/workflow-diversity";
import { deriveRecInteractionView } from "@/lib/rec-interactions";
import { vendorLabel } from "@/lib/vendor-labels";
import { VISIBILITY_MODE_INFO } from "@/lib/visibility-playbook";
import { periodFor, previousDay } from "@/scoring";
import { CAPABILITY_STATE_CONSTANTS } from "@/scoring/capability-state";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A wide lookback so the dashboard shows the latest scored period regardless
 * of which grain the recompute wrote (nightly rolling_28d, monthly, …). */
function dashboardWindow(): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - 180 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

// ─── "Needs attention" strip — shared between the personal and team views ───

function attentionActionLabel(href: string): string {
  if (href === "/reconcile") return "Match accounts";
  if (href === "/connections") return "Go to Connections";
  return "View";
}

function AttentionAlert({ item }: { item: AttentionItem }) {
  const isAction = item.severity === "action";
  const isRecommendation = item.kind === "recommendation";
  return (
    <Alert>
      {isAction ? (
        <TriangleAlert />
      ) : isRecommendation ? (
        <Lightbulb className="text-muted-foreground" />
      ) : (
        <Info className="text-muted-foreground" />
      )}
      <AlertTitle className={isAction ? undefined : "text-muted-foreground"}>
        <span className="inline-flex items-center gap-2">
          {item.title}
          {isRecommendation ? (
            <Badge variant="outline" className="font-normal">
              Guidance
            </Badge>
          ) : null}
        </span>
      </AlertTitle>
      <AlertDescription>
        <p>{item.body}</p>
        {item.href ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            nativeButton={false}
            render={<Link href={item.href} />}
          >
            {attentionActionLabel(item.href)}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** Renders `deriveAttention`'s output as one Alert per item, ordered as
 * returned (action severity first, then info, each impact-ranked). Renders
 * nothing when there is nothing to surface — never an empty section shell. */
function AttentionSection({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <AttentionAlert key={`${item.severity}-${i}-${item.title}`} item={item} />
      ))}
    </div>
  );
}

/** Deliverable 5: Spend Governance as a one-LINE exec summary (the full /spend
 * page stays). Reported spend + the measured cost-per-active-person + a link to
 * manage budgets. Reported/measured only — never an estimated or ROI figure
 * (invariant b). */
function SpendGovernanceLine({
  spendCents,
  spendCentsEstimated,
  costPerActiveUser,
}: {
  spendCents: number;
  spendCentsEstimated: number;
  costPerActiveUser: CostPerActiveUserNumber;
}) {
  if (spendCents === 0 && spendCentsEstimated === 0) return null;
  const cpu = costPerActiveUser.cost;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground">AI spend this period:</span>
          <span className="font-medium tabular-nums">
            {formatCents(spendCents)} total
          </span>
          {spendCentsEstimated > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              (+{formatCents(spendCentsEstimated)} estimated)
            </span>
          ) : null}
          {cpu ? (
            <span className="text-muted-foreground tabular-nums">
              · {formatCents(cpu.centsPerUnit)} per active person
            </span>
          ) : null}
        </span>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/spend" />}
        >
          <Wallet data-icon="inline-start" />
          Manage budgets
        </Button>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const ctx = await requireAppContext();

  // Neither branch stacks a separate `connections.list()` round trip ahead of
  // its data read. The team path: `readDashboardView` already fetches
  // connections inside its depth-1 Promise.all and returns them, so
  // TeamOverview renders its Connections panel + attention strip from
  // `view.connections`. The personal path: the connections read is started
  // here (in flight) and FOLDED into PersonalSelfView's depth-1 Promise.all,
  // where the onboarding gate is evaluated once it resolves — so the gate no
  // longer costs a serial Workers→Hyperdrive→Neon hop (~250–500ms of
  // authenticated TTFB) ahead of the page's other reads on the common
  // already-connected login that lands here.
  if (ctx.org.kind === "personal") {
    return (
      <PersonalSelfView
        ctx={ctx}
        connectionsPromise={ctx.scope.connections.list()}
      />
    );
  }
  return <TeamOverview ctx={ctx} />;
}

async function PersonalSelfView({
  ctx,
  connectionsPromise,
}: {
  ctx: AppContext;
  // Passed in flight (not awaited) so it overlaps the pageData batch below —
  // resolved inside that batch's single Promise.all, then the onboarding gate
  // is evaluated on the result before any card renders.
  connectionsPromise: ReturnType<AppContext["scope"]["connections"]["list"]>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const period = periodFor("month", today);
  const prevPeriod = periodFor("month", previousDay(period.periodStart));
  // Independent reads (one Postgres round trip each on Workers→Hyperdrive→
  // Neon) — gathered concurrently rather than run one after another. The
  // previous-period score read is separate from `dashboardSummary`'s window
  // (which stays the current month, feeding "Spend this month") — it exists
  // purely to compute a same-definition-version delta, never to widen what
  // spend is summed over.
  // Kicked off once, then handed to BOTH `dashboardSummary` (which otherwise
  // fetches its own definitions internally, via hydrateScoreResults) and this
  // Promise.all directly — one definitions query per page load, not two,
  // while staying at round-trip depth 1 (dashboardSummary awaits the same
  // in-flight promise rather than starting a second query).
  const definitionsPromise = ctx.scope.scores.definitions();
  // A wider window than the current-month summary, purely so the agentic
  // adoption card has ~12 weeks to draw a real trend line (the lib slices to
  // its own AGENTIC_WINDOW_DAYS window ending today — this fetch matches it).
  // Org-of-one, so these rows are the viewer's own — the person-day rate IS
  // their personal rate.
  const agenticFrom = new Date(Date.now() - (AGENTIC_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const [
    connections,
    summary,
    verifiedBenchmarks,
    definitions,
    prevScores,
    budgetAlert,
    personalActiveDay,
    personalAgentActive,
    personalIdentities,
    personalSpend,
    maturity,
    recInteractions,
    recommendations,
    capabilityGraph,
    capabilityStates,
  ] = await timeStage("pageData", () =>
      Promise.all([
        // Onboarding-gate read, folded in here so it overlaps the rest of the
        // batch instead of serializing ahead of the page (round-trip depth 1).
        connectionsPromise,
        dashboardSummary(
          ctx.scope,
          ctx.org.visibilityMode,
          { from: period.periodStart, to: period.periodEnd },
          { definitions: definitionsPromise },
        ),
        // Personal self-view compares against the "overall" segment — an
        // enterprise/smb norm is not this solo user's peer group.
        listBenchmarks(ctx.db, { status: "verified", segment: "overall" }),
        definitionsPromise,
        // Person-level only — this read exists purely to compute a
        // same-definition-version personal delta, so team/org-level rows
        // (which `personDeltaResult` would filter out in JS anyway) are
        // never fetched from Postgres in the first place.
        ctx.scope.scores.results({
          from: prevPeriod.periodStart,
          to: prevPeriod.periodEnd,
          subjectLevel: "person",
        }),
        // The month-to-date budget alert (W4-V), role-gated like TeamOverview's:
        // a personal-kind org CAN have an invited member (org-of-one machinery is
        // identical to Team), and the budget limit is admin-configured governance
        // — for a member the read is skipped entirely, not fetched-then-hidden.
        // Null also when no budget is set or no threshold is crossed.
        readBudgetAlertForRole(ctx.scope, ctx.role, today),
        // Agentic adoption inputs (F1.4). Numerator + denominator over the
        // wider trend window; the rate + weekly trend derive in JS below.
        ctx.scope.metrics.records({
          metricKey: "active_day",
          from: agenticFrom,
          to: today,
        }),
        ctx.scope.metrics.records({
          metricKey: "agent_active",
          from: agenticFrom,
          to: today,
        }),
        // Identity links resolve the agentic rows' subject-days to
        // person-days — the same human often spans several vendor subjects
        // (review F1). Fetched inside this flat Promise.all: +1 query, still
        // round-trip depth 1.
        ctx.scope.identities.all(),
        // F2.3 (I2): reported spend over the same wide window, so the spend
        // spike detector has a trailing 28-day baseline (the current-month
        // summary window is too short). Org-of-one, so these rows are the
        // viewer's own spend. The ONE new stage-1 read this feature adds on the
        // personal path — inside this flat Promise.all, still round-trip depth
        // 1 (no new sequential stage).
        ctx.scope.metrics.records({
          metricKey: "spend_cents",
          from: agenticFrom,
          to: today,
        }),
        // Growth Journey headline (W5-C): the modeled maturity LEVEL — for an
        // org-of-one it is personally true (errata §1.2(6)). readMaturityView
        // does its OWN flat Promise.all internally, and because it is CALLED
        // here as an element of this outer Promise.all its internal reads are
        // kicked off synchronously (before its first await) alongside the
        // reads above — so the whole batch stays round-trip depth 1 (G10). We
        // never call readDashboardView + readMaturityView back-to-back; the
        // personal path composes maturity into this single existing stage.
        readMaturityView(ctx.scope, today),
        // W5-D: the signed-in person's recommendation interaction state
        // (snoozed/dismissed/tried), resolved by auth user INSIDE the query so
        // it needs no personId (unknown until `summary` resolves) and folds
        // into this flat Promise.all — +1 query, still round-trip depth 1 (G10).
        // Self-view by construction: returns only the caller's OWN person's
        // states (empty when no person is linked yet).
        ctx.scope.recInteractions.statesForUser(ctx.user.id),
        // W6-C (ADR 0033): the per-org recommendation catalog — ONE read folded
        // into this flat Promise.all (+1 query, still round-trip depth 1),
        // evaluated in memory by `deriveAttention` below (§8.2 perf floor).
        ctx.scope.catalog.list(),
        // W7-1: the capability graph (labels + prerequisite edges), same batch
        // — the coaching card's label source AND the W7-3 prerequisite gate.
        ctx.scope.capabilities.graph(),
        // W7-2: the signed-in user's OWN capability state (self-view), folded
        // into this depth-1 batch via a people.auth_user_id join so it needs no
        // resolved tracked personId ahead of the batch.
        ctx.scope.mastery.forUser(ctx.user.id),
      ]),
    );
  // Onboarding gate (evaluated here, after the overlapped read above, rather
  // than as a serial hop ahead of the batch): a fresh personal workspace with
  // no usable connection has nothing to show — send it to the focused
  // onboarding flow (W2-H) before rendering any card. An errored connection
  // (e.g. a rejected key at first attempt) does NOT count as connected, so a
  // bad first key can't strand the user on an empty dashboard; /onboarding
  // itself never redirects here, so there is no loop. `redirect()` throws, so
  // the batch's other (empty, on a fresh org) results are simply discarded.
  const hasUsableConnection = connections.some((c) => c.status !== "error");
  if (!hasUsableConnection) {
    redirect("/onboarding");
  }
  const agentic = computeAgenticAdoption({
    agentActiveRows: personalAgentActive,
    activeDayRows: personalActiveDay,
    identityLinks: personalIdentities,
    windowTo: today,
  });
  const scores = new Map<string, PersonalScore>(
    summary.scores
      .filter((s) => s.subjectLevel === "person" && s.periodGrain === "month")
      .map((s) => [s.definitionSlug, s]),
  );
  const prevMonthLabel = new Date(
    `${prevPeriod.periodStart}T00:00:00Z`,
  ).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const deltas = new Map<ScoreSlug, DeltaResult | null>(
    SCORE_SLUGS.map((slug) => {
      const score = scores.get(slug);
      return [
        slug,
        personDeltaResult({
          currentValue: score?.value ?? null,
          currentVersion: score?.definitionVersion,
          prevRows: prevScores,
          definitions,
          slug,
          grain: "month",
          previousPeriodLabel: prevMonthLabel,
        }),
      ];
    }),
  );

  // Share the headline (fluency) score, and only once it's actually computed —
  // a share link to a "still computing" card isn't worth minting.
  const fluencyComputed = scores.has("fluency");
  const personId =
    summary.scores.find((s) => s.person)?.person?.id ?? null;

  // W7-1/W7-3: derive the capability label map + prerequisite edges from the
  // graph fetched above (zero new queries), and the person's eligibility context
  // for the coaching gates.
  const capabilityLabels = new Map(
    capabilityGraph.capabilities.map((c) => [c.slug, c.label]),
  );
  const capabilityPrereqs = new Map<string, string[]>();
  for (const dep of capabilityGraph.dependencies) {
    const list = capabilityPrereqs.get(dep.capabilitySlug);
    if (list) list.push(dep.requiresSlug);
    else capabilityPrereqs.set(dep.capabilitySlug, [dep.requiresSlug]);
  }
  const masteredCapabilities = new Set(
    capabilityStates
      .filter((s) => s.mastery >= CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD)
      .map((s) => s.capabilitySlug),
  );
  const connectedTools = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.vendor),
  );
  // Safeguard (reliability-first): the prerequisite gate fails closed, so on
  // DIRECTIONAL-only mastery a forming person (nothing yet mastered) would be
  // gated down to root recs. Apply it ONLY once the person has established ≥1
  // capability; a forming person keeps the full coaching set. Tune away once
  // mastery is measured (P8).
  const prereqGateActive = masteredCapabilities.size > 0;

  // Build each card's data once, up front, so the F1.1 coaching gate and the
  // rendered cards read the SAME `componentRows` (one `formatComponentDetail`
  // per score, zero new queries — these are the already-fetched score rows).
  const cardData = new Map<ScoreSlug, ScoreCardData>(
    SCORE_SLUGS.map((slug) => [
      slug,
      fromPersonalScore({
        slug,
        score: scores.get(slug) ?? null,
        definitions,
        delta: deltas.get(slug) ?? null,
      }),
    ]),
  );
  // Coaching recommendations only consider scores that actually exist (G4 — no
  // guidance off a not-yet-computed score); gating (measured-and-weak) is
  // centralized inside deriveAttention.
  const scoreComponents = SCORE_SLUGS.filter((slug) => scores.has(slug)).map(
    (slug) => ({ slug, components: cardData.get(slug)!.componentRows }),
  );

  // F1.3 driver attribution: personScoreDropAttribution resolves the previous
  // row through the SAME selection personDeltaResult diffs against (shared
  // selector in score-insights.ts), so the named driver can't desynchronize
  // from the delta beside it. Zero new queries — prevScores is already fetched.
  const scoreDrops = SCORE_SLUGS.map((slug) => ({ slug, d: deltas.get(slug) }))
    .filter(
      (x): x is { slug: ScoreSlug; d: Extract<DeltaResult, { kind: "delta" }> } =>
        x.d?.kind === "delta",
    )
    .map((x) => {
      const score = scores.get(x.slug);
      return {
        slug: x.slug,
        delta: x.d.delta,
        attribution: score
          ? personScoreDropAttribution({
              currentVersion: score.definitionVersion,
              currentComponents: score.components,
              prevRows: prevScores,
              definitions,
              slug: x.slug,
              grain: "month",
            })
          : undefined,
      };
    });
  // F2.3 (I2): the viewer's own spend spike, staleness-gated (G5) inside
  // detectDailySpike. Org-of-one, so the daily spend total IS the viewer's. No
  // plateau on the self-view: a one-person "active-people cohort" is degenerate
  // (detectPlateau would return `insufficient`), so it's not computed here.
  const spendAnomaly = detectDailySpike({
    metric: "spend",
    records: personalSpend,
    today,
    connections,
  });
  const anomalies = spendAnomaly.kind === "spike" ? [spendAnomaly.signal] : [];
  // The identity-link callout is admin-gated the same way /reconcile itself
  // is — a non-admin member can't act on it, so it's never surfaced to them
  // (rather than shown and then dead-ending). It's further gated on having no
  // computed score yet (old behavior) — once scores are computing, the
  // unresolved-usage callout would just be noise alongside real numbers.
  // Both guards are shaped as raw facts and gated INSIDE deriveAttention now
  // (not by this call site's ternary) — see deriveAttention's unresolvedUsage
  // doc comment for why.
  const attentionItems = deriveAttention({
    connections: connectionAttentionInputs(connections),
    unresolvedUsage: {
      count: summary.unresolvedSubjects,
      viewerIsAdmin: ctx.role === "admin",
      scoresExist: scores.size > 0,
    },
    gaps: summary.gaps,
    sharedAccountCount: 0,
    scoreDrops,
    scoreComponents,
    // W6-C: the per-org catalog fetched in this same flat Promise.all,
    // evaluated in memory here (§8.2 perf floor).
    recommendations,
    // W7-1: display-only capability labels for the coaching card.
    capabilityLabels,
    // W7-3 (now live): stage-1 eligibility. Role/tool always applied (inert for
    // the universal launch recs, future-proof); the prerequisite gate only once
    // the person has established ≥1 capability (the forming-user safeguard).
    connectedTools,
    ...(prereqGateActive ? { masteredCapabilities, capabilityPrereqs } : {}),
    // W7-4: the person's connected-source count (active connections' distinct
    // vendors) → the honest confidence disclosure on each coaching rec.
    coverageSourceCount: connectedTools.size,
    anomalies,
  });
  // W5-C companion composition (positive-first, level-forward): the coaching
  // recommendations get their OWN dedicated card + seed the Growth Journey's
  // single next step, so they are PULLED OUT of the generic attention strip
  // (which keeps only the action alerts + early-warning signals — no
  // duplication). The top rec is the headline next step.
  const allCoachingRecs = attentionItems.filter(
    (i) => i.kind === "recommendation",
  );
  // W5-D: honour this person's interaction state — a dismissed rec, and a
  // snoozed one whose snooze hasn't expired, drop off the card entirely (and so
  // never seed the Growth Journey's next step below). A "tried" rec stays,
  // flagged so the card shows a "tried" indicator instead of the mark-tried
  // button. Pure derivation from the already-fetched rows (no new query).
  const { suppressedRecIds, triedRecIds } = deriveRecInteractionView(
    recInteractions,
    new Date(),
  );
  const coachingRecs = allCoachingRecs.filter(
    (i) => !(i.recId && suppressedRecIds.has(i.recId)),
  );
  const attentionStripItems = attentionItems.filter(
    (i) => i.kind !== "recommendation",
  );
  const topNextStep = coachingRecs[0] ?? null;
  // Daily nudge: ONE fresh fact from the last sync (never a dashboard, never a
  // freshness demand — principle 7). Built purely from data already in hand;
  // `maturity.dataAsOf` is the freshest successful sync across connections.
  const dailyNudge = buildDailyNudge({
    freshestSyncAt: maturity.dataAsOf,
    agentic,
    spendCents: summary.spendCents,
    hasScores: scores.size > 0,
  });

  // W5-F milestones — recompute-on-read, ZERO new queries (perf law G10): every
  // input is derived from rows already in the flat batch above.
  //  • feature-breadth: W5-E's comparator over the distinct-workflow count read
  //    straight off the current score components' `raw` (the `distinct_dims`
  //    component) vs the previous month's stored breakdown. A real prior
  //    baseline (not a fixed 0) means the milestone stops firing once matched —
  //    badge-until-superseded, never re-celebrated (§8.4).
  //  • first-agent-session: agentic work is measured AND still very early
  //    (≤ 1 complete week of activity) — the honest, over-claim-safe proxy for
  //    "agents just showed up" without storage (false negatives over false
  //    positives, invariant b).
  //  • weekly-cadence: a sustained rhythm (≥ 3 complete active weeks). Rendered
  //    as count-free narrative — the no-streak decision (§8.4).
  const currentBreadth = featureBreadthFromRows(
    SCORE_SLUGS.flatMap((slug) => cardData.get(slug)!.componentRows),
  );
  let previousBreadth: number | null = null;
  for (const row of prevScores) {
    const b = featureBreadthFromBreakdown(row.components);
    if (b !== null) {
      previousBreadth = previousBreadth === null ? b : Math.max(previousBreadth, b);
    }
  }
  const milestones = detectMilestones({
    breadth:
      currentBreadth !== null
        ? compareWorkflowDiversity(currentBreadth, previousBreadth ?? 0)
        : null,
    firstAgentSession: agentic.kind === "measured" && agentic.trend.length <= 1,
    activeWeeks: agentic.kind === "measured" ? agentic.trend.length : 0,
  });

  return (
    <>
      <PageHeader
        title={COMPANION_HEADER.title}
        description={COMPANION_HEADER.description}
      >
        {fluencyComputed && personId && (
          <ShareScoreButton
            personId={personId}
            scoreSlug="fluency"
            defaultLabel={ctx.user.name ?? "My AI"}
          />
        )}
      </PageHeader>

      {budgetAlert ? (
        <BudgetAlertBanner
          alert={budgetAlert.alert}
          reportedCents={budgetAlert.reportedCents}
          monthlyLimitCents={budgetAlert.monthlyLimitCents}
          showManageLink
        />
      ) : null}

      <SyncStalenessBanner connections={connections} />

      {/* Action alerts + early-warning signals only — coaching recommendations
       * moved to their dedicated CoachingCard below (no duplication). */}
      <AttentionSection items={attentionStripItems} />

      {/* The companion headline: level-forward, positive-first. Leads with the
       * modeled maturity level + the single next step (the first-sync aha —
       * "You're at <level>, here's the one thing to try next" — NOT a raw
       * score). No blended per-person "AI health" number anywhere (errata
       * §1.2(9)). */}
      <GrowthJourneyCard
        level={maturity.level}
        stale={maturity.stale}
        nextStep={topNextStep}
      />

      {/* W5-F: positive-first — celebrate grounded milestones immediately,
       * right below the level headline. Renders nothing when none crossed. */}
      <MilestoneCard milestones={milestones} />

      <DailyNudgeCard nudge={dailyNudge} />

      <CoachingCard
        recommendations={coachingRecs}
        personId={personId}
        triedRecIds={[...triedRecIds]}
      />

      {/* W7-2: the capability profile — a positive-first decomposition of the
       * one proficiency band, self-view only (the caller passes ONLY the
       * signed-in user's own rows via mastery.forUser). Renders the honest
       * forming state when there is no capability evidence yet. */}
      <CapabilityProfileCard
        rows={capabilityStates.map((s) => ({
          capabilitySlug: s.capabilitySlug,
          label: capabilityLabels.get(s.capabilitySlug) ?? s.capabilitySlug,
          mastery: s.mastery,
          confidenceTier: s.confidenceTier,
          nextCapability: s.nextCapability,
        }))}
        labels={capabilityLabels}
      />

      {scores.size === 0 && (
        // Connected, but no person scores computed yet — the F1.6 cliff. The
        // interim bridge renders ABOVE the still-computing score cards (the
        // grid below stays — its null-state cards explain each score): an
        // honest, sync-state-aware "here's what we ingested; first scores
        // by …" plus the first-week checklist. Ingestion evidence derives
        // from data already in hand (summary + connections) — zero new reads.
        // Renders nothing when no usable (non-errored, non-paused) connection
        // exists (buildOnboardingInterim's `none` channel).
        <OnboardingInterim
          connections={connections}
          ingestionEvidence={{
            activePeople: summary.activePeople,
            unresolvedSubjects: summary.unresolvedSubjects,
            connectionsSynced: syncedToolCount(connections),
          }}
          isAdmin={ctx.role === "admin"}
        />
      )}

      {/* The raw 0–100 scores are DEMOTED behind an expander (W5-C deliverable
       * 4): collapsed by default, so the number is never the headline of the
       * default render — the level + next step above are. */}
      <DiagnosticDetails>
        <div className="grid gap-4 md:grid-cols-3">
          {SCORE_SLUGS.map((slug) => (
            <ScoreCard key={slug} data={cardData.get(slug)!} />
          ))}
        </div>
      </DiagnosticDetails>

      <AgenticAdoptionCard data={agentic} />

      {/* Spend as a compact one-line summary + drill-through to the full /spend
       * page (the same pattern Team uses), instead of a full stacked card on
       * the personal home. Renders nothing when there is no spend yet. The
       * estimated-spend breakdown + its methodology note live on /spend. */}
      <SpendGovernanceLine
        spendCents={summary.spendCents}
        spendCentsEstimated={summary.spendCentsEstimated}
        costPerActiveUser={maturity.numbers.costPerActiveUser}
      />

      {/* J1: the modeled-norms comparison panel (BenchmarkPanel) is
       * deliberately NOT rendered here. A single person vs. an org-modeled
       * peer curve is an unsupported comparison, and it previously sat right
       * above the verified-benchmarks card explaining "we don't show
       * unverified figures" — a direct contradiction. The team dashboard
       * keeps the panel; its own copy discloses the modeled-estimate
       * provenance (see CONCEPT_GLOSSARY.benchmarks). */}

      {/* Benchmarks + the anonymized-benchmark opt-in were two back-to-back
       * cards on one topic; folded into one. The verified-figures list leads;
       * the opt-in (self-describing) sits beneath a divider. An InfoTip carries
       * the "two different benchmark claims" explanation the personal card
       * previously lacked. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Benchmarks
            <InfoTip
              label="Benchmarks"
              short={CONCEPT_GLOSSARY.benchmarks.shortWhat}
              learnMoreHref={`/methodology#${methodologyAnchor("benchmarks")}`}
            />
          </CardTitle>
          <CardDescription>
            How your scores compare to published norms.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {verifiedBenchmarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Published benchmarks are being verified against primary sources
              and will appear here — we don&apos;t show unverified figures.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {verifiedBenchmarks.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-4">
                  <span className="min-w-0">
                    <span className="font-medium capitalize">{b.scoreSlug}</span>
                    <span className="text-muted-foreground"> · {b.metricLabel}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {b.value !== null
                      ? `${b.value}${b.valueUnit === "percent" ? "%" : ""}`
                      : b.rangeLow !== null && b.rangeHigh !== null
                        ? `${b.rangeLow}–${b.rangeHigh}${b.valueUnit === "percent" ? "%" : ""}`
                        : "—"}
                    <span className="ml-2 text-xs">({b.sourceName})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t pt-4">
            <BenchmarkConsentToggle />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

async function TeamOverview({ ctx }: { ctx: AppContext }) {
  // The composed view and the month-to-date budget alert are independent reads,
  // gathered together so the banner adds no sequential round-trip to the hot
  // dashboard path (the alert's MTD window differs from the view's 180d window,
  // so its spend can't be reused). Role-gated inside readBudgetAlertForRole:
  // the budget limit is admin-configured governance data (like /billing), so
  // members never see the banner — and the read is skipped for them entirely.
  // Null when no budget is set or no threshold is crossed — the banner then
  // renders nothing. Connections come back ON the view (readDashboardView
  // fetches them in its depth-1 Promise.all) — no separate page-level
  // connections.list() round trip stacked ahead of this read.
  // readMaturityView is threaded into the SAME flat Promise.all as
  // readDashboardView (not run after it) so the modeled maturity level + the
  // eight board numbers the consolidated Maturity card renders cost NO extra
  // sequential round-trip stage — the personal path already composes maturity
  // this way (perf law G10; guarded by tests/perf scenario 4). Both readers do
  // their own internal flat Promise.all kicked off synchronously here, so the
  // batch stays round-trip depth 1.
  const [view, budgetAlert, maturity] = await timeStage("pageData", () =>
    Promise.all([
      readDashboardView(ctx.scope, ctx.org.visibilityMode, dashboardWindow()),
      readBudgetAlertForRole(ctx.scope, ctx.role, todayUtc()),
      readMaturityView(ctx.scope, todayUtc()),
    ]),
  );
  const {
    summary,
    benchmarks,
    heatmap,
    coverage,
    trends,
    segments,
    sharedAccounts,
    definitions,
    gaps,
    connections,
    subjects,
    identities,
    attributionTrend,
    agentic,
    recentMovement,
    usageDistribution,
    usageConcentration,
    spendAnomaly,
    promptAnomaly,
    usagePlateau,
    narrative,
    correlations,
    recommendations,
    capabilityLabels,
    capabilityCoverage,
  } = view;

  // Signal coverage (W5-H card e) — computed from rows ALREADY in the view
  // (subjects/identities/connections), zero new queries. Reduced to an
  // AGGREGATE (how many identified people rest on a single source) — never a
  // per-named-person list, so the team surface stays aggregate-only.
  const coverageByPerson = computeSignalCoverage({
    identities,
    subjects,
    connections,
  });
  const coverageAggregate: CoverageAggregate | null =
    coverageByPerson.size === 0
      ? null
      : {
          total: coverageByPerson.size,
          single: [...coverageByPerson.values()].filter(
            (c) => c.sourceCount === 1,
          ).length,
        };
  const latest = latestTeamScoresBySlug(summary.scores);
  const adoption = latest.get("adoption") ?? null;
  const fluency = latest.get("fluency") ?? null;
  const efficiency = latest.get("efficiency") ?? null;
  const hasScores = latest.size > 0;
  const spendFooter =
    summary.spendCents > 0 || summary.spendCentsEstimated > 0 ? (
      <>
        {formatCents(summary.spendCents)} total spend across tools
        {summary.spendCentsEstimated > 0
          ? ` (+${formatCents(summary.spendCentsEstimated)} estimated)`
          : ""}
      </>
    ) : undefined;

  const trendsBySlug = new Map(trends.map((t) => [t.slug, t]));
  const deltas = new Map<ScoreSlug, DeltaResult>(
    SCORE_SLUGS.map((slug) => [
      slug,
      deriveDelta(trendsBySlug.get(slug)?.points ?? []),
    ]),
  );
  // Build each card's data once so the F1.1 coaching gate and the rendered
  // cards read the SAME `componentRows` (zero new queries — already-fetched
  // score rows). `efficiency` alone carries the spend footer.
  const cardData = new Map<ScoreSlug, ScoreCardData>([
    ["adoption", fromDashboardScore({ slug: "adoption", score: adoption, definitions, delta: deltas.get("adoption") })],
    ["fluency", fromDashboardScore({ slug: "fluency", score: fluency, definitions, delta: deltas.get("fluency") })],
    ["efficiency", fromDashboardScore({ slug: "efficiency", score: efficiency, definitions, delta: deltas.get("efficiency"), footer: spendFooter })],
  ]);
  const scoreComponents = SCORE_SLUGS.filter((slug) => latest.get(slug)).map(
    (slug) => ({ slug, components: cardData.get(slug)!.componentRows }),
  );

  // F1.3 driver attribution: teamScoreDropAttribution picks the SAME
  // last-two-by-periodEnd pair `deriveDelta` compares (shared selector in
  // score-insights.ts), so the named driver can't desynchronize from the
  // delta beside it. Zero new queries — summary.scores is already fetched.
  const scoreDrops = SCORE_SLUGS.map((slug) => ({ slug, d: deltas.get(slug)! }))
    .filter(
      (x): x is { slug: ScoreSlug; d: Extract<DeltaResult, { kind: "delta" }> } =>
        x.d.kind === "delta",
    )
    .map((x) => ({
      slug: x.slug,
      delta: x.d.delta,
      attribution: teamScoreDropAttribution(
        summary.scores.filter(
          (s) => s.subjectLevel === "team" && s.definitionSlug === x.slug,
        ),
      ),
    }));
  // Team's needs-attention strip surfaces the SAME connector honesty gaps the
  // personal self-view does (W4-W finding A5 — the composed team view now
  // fetches connector_runs and threads gaps through `view.gaps`), plus
  // shared-account count, errored connections, score drops, and (F1.1)
  // coaching recommendations. The unresolved-subjects/identity-link callout
  // stays personal/admin-only.
  // F2.3 early warnings — the detectors already applied every gate (G5
  // staleness, statistical floors, insufficient baselines/weeks) inside
  // readDashboardView, so here we only pass the genuine spikes/plateau through.
  const anomalies = [spendAnomaly, promptAnomaly]
    .filter((a): a is Extract<typeof a, { kind: "spike" }> => a.kind === "spike")
    .map((a) => a.signal);
  const plateau = usagePlateau.kind === "plateau" ? usagePlateau : null;
  const attentionItems = deriveAttention({
    connections: connectionAttentionInputs(connections),
    gaps,
    sharedAccountCount: sharedAccounts.length,
    scoreDrops,
    scoreComponents,
    // W6-C: the per-org catalog fetched inside readDashboardView's single
    // round-trip, evaluated in memory here (§8.2 perf floor).
    recommendations,
    // W7-1: display-only capability labels for the coaching card.
    capabilityLabels,
    anomalies,
    plateau,
  });

  return (
    <>
      <PageHeader
        title={TEAM_OVERVIEW_COPY.header.title}
        description={TEAM_OVERVIEW_COPY.header.description}
      />

      {budgetAlert ? (
        <BudgetAlertBanner
          alert={budgetAlert.alert}
          reportedCents={budgetAlert.reportedCents}
          monthlyLimitCents={budgetAlert.monthlyLimitCents}
          showManageLink
        />
      ) : null}

      <SyncStalenessBanner connections={connections} />

      <AttentionSection items={attentionItems} />

      {hasScores ? (
        // W5-H dashboard-itis fold: ~18–20 panels curated into FIVE
        // audience-scoped cards — Team AI health · AI maturity · Training
        // opportunities · Benchmarks & distribution · Data trust. Every retired
        // panel keeps its component; only the grouping changed (curation over
        // the same readDashboardView batch — no new reader, no capability loss).
        <>
          {/* (a) Team AI health — the three headline scores, how they moved, the
           * period story, and the one-line spend-governance summary. */}
          <section className="flex flex-col gap-3">
            <SectionHeading>{TEAM_OVERVIEW_COPY.health.title}</SectionHeading>
            <p className="text-sm text-muted-foreground">
              {TEAM_OVERVIEW_COPY.health.lead}
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
              <ScoreCard data={cardData.get("adoption")!} />
              <ScoreCard data={cardData.get("fluency")!} />
              <ScoreCard data={cardData.get("efficiency")!} />
            </div>
            <RecentMovementPanel movement={recentMovement} />
            <PeriodNarrativeCard
              narrative={narrative}
              correlations={correlations}
            />
            {/* Deliverable 5: Spend Governance folded into the exec view as a
             * one-LINE summary (the full /spend page stays). Reported spend +
             * the measured cost-per-active-person, linking out to manage
             * budgets — never an estimated or ROI number. */}
            <SpendGovernanceLine
              spendCents={summary.spendCents}
              spendCentsEstimated={summary.spendCentsEstimated}
              costPerActiveUser={maturity.numbers.costPerActiveUser}
            />
          </section>

          {/* (b) AI maturity — the modeled level + measured axes, plus how the
           * usage actually looks (activity detail folds in here since the axes
           * ARE breadth/depth/consistency of that usage). Board CSV export +
           * link to the full one-page report. */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <SectionHeading>{TEAM_OVERVIEW_COPY.maturity.title}</SectionHeading>
                <p className="text-sm text-muted-foreground">
                  {TEAM_OVERVIEW_COPY.maturity.lead}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MaturityExportButton />
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/maturity" />}
                >
                  {TEAM_OVERVIEW_COPY.maturity.fullReport}
                </Button>
              </div>
            </div>
            <MaturityLevelBanner
              level={maturity.level}
              dataAsOf={maturity.dataAsOf}
              stale={maturity.stale}
            />
            <MaturityAxisMeters axes={maturity.axes} />
            {/* The level + axes are the headline; the detailed usage panels
             * (heatmap, tool coverage, agent adoption, trends, attribution)
             * fold behind a disclosure so this section stops being the one
             * panel-dense screen in the fold. Everything is preserved — only
             * its default visibility changed (progressive disclosure). */}
            <CollapsibleSection
              label="See usage detail"
              description="When your team is most active, which tools they use, agent adoption, and how scores are trending."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <ActivityHeatmap heatmap={heatmap} />
                <div className="grid gap-4">
                  <ToolCoveragePanel coverage={coverage} />
                  <AgenticAdoptionCard data={agentic} />
                  <ScoreTrend trends={trends} />
                </div>
              </div>
              <AttributionTrendCard trend={attributionTrend} />
            </CollapsibleSection>
          </section>

          {/* (c) Training opportunities — the action card: leading cohort
           * (floor-gated), plateau verdict, segment split (count-only), and
           * usage concentration. */}
          <section className="flex flex-col gap-3">
            <SectionHeading>{TEAM_OVERVIEW_COPY.training.title}</SectionHeading>
            <div className="grid gap-4 lg:grid-cols-2">
              <TrainingOpportunitiesCard
                segments={segments}
                plateau={usagePlateau}
              />
              {/* W7-6: aggregate, count-only capability coverage — the manager's
               * "where to coach" surface, MIN_PEOPLE-floored, no per-person data. */}
              <CapabilityCoverageCard rows={capabilityCoverage} />
              <SegmentBreakdown distribution={segments} />
              <UsageConcentrationPanel concentration={usageConcentration} />
            </div>
          </section>

          {/* (d) Benchmarks & distribution — the within-org percentile lens next
           * to published norms. */}
          <section className="flex flex-col gap-3">
            <SectionHeading>{TEAM_OVERVIEW_COPY.distribution.title}</SectionHeading>
            <p className="text-sm text-muted-foreground">
              {TEAM_OVERVIEW_COPY.distribution.lead}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <BenchmarkPanel benchmarks={benchmarks} />
              <UsageDistributionPanel distribution={usageDistribution} />
            </div>
          </section>

          {/* (e) Data trust — the honesty surface: signal coverage (aggregate),
           * connector reporting gaps, and shared accounts. */}
          <section className="flex flex-col gap-3">
            <SectionHeading>{TEAM_OVERVIEW_COPY.dataTrust.title}</SectionHeading>
            <p className="text-sm text-muted-foreground">
              {TEAM_OVERVIEW_COPY.dataTrust.lead}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <DataTrustCard coverage={coverageAggregate} gaps={gaps} />
              <SharedAccountFlags flags={sharedAccounts} />
            </div>
          </section>
        </>
      ) : connections.some(isUsableConnection) ? (
        // Usable (non-errored, non-paused — the lib's definition) connections
        // exist but no scores yet — the "connected → first scores" cliff
        // (F1.6). Show the interim bridge: what's ingested so far, honest
        // sync-state-aware timing, and the first-week checklist. Ingestion
        // evidence derives from the already-fetched view (zero new reads):
        // activePeople/unresolvedSubjects from the summary, the synced count
        // as distinct usable vendors with a last_success_at. An org with only
        // paused/errored connections falls through to the plain EmptyState —
        // nothing is ingesting, so no bridge that implies progress.
        <OnboardingInterim
          connections={connections}
          ingestionEvidence={{
            activePeople: summary.activePeople,
            unresolvedSubjects: summary.unresolvedSubjects,
            connectionsSynced: syncedToolCount(connections),
          }}
          isAdmin={ctx.role === "admin"}
        />
      ) : (
        <EmptyState
          icon={Gauge}
          title="No scores yet"
          description="Adoption, Fluency, and Efficiency scores appear after your first connection syncs data. Nothing here is estimated — scores only ever come from real, attributed metrics."
        >
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/methodology" />}
          >
            How scores work
          </Button>
        </EmptyState>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeading>Setup</SectionHeading>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>Team workspace.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Organization</span>
                <span className="truncate font-medium">{ctx.org.name}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Active people</span>
                <span className="tabular-nums font-medium">
                  {summary.activePeople}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Privacy mode</span>
                <span className="text-right">
                  {VISIBILITY_MODE_INFO[ctx.org.visibilityMode].label}
                </span>
              </div>
              {ctx.role === "admin" && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/settings" />}
                  >
                    Workspace settings
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Connections</CardTitle>
              <CardDescription>
                The tools connected to your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {connections.length === 0 ? (
                <p className="text-muted-foreground">
                  No tools connected yet — connect one to start seeing your
                  numbers here.
                </p>
              ) : (
                connections.slice(0, 4).map((connection) => (
                  <div
                    key={connection.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 truncate">
                      {connection.displayName}
                      <span className="text-muted-foreground">
                        {" "}
                        · {vendorLabel(connection.vendor)}
                      </span>
                    </span>
                    <SyncStatusBadge
                      status={connection.status}
                      lastSuccessAt={connection.lastSuccessAt}
                      lastError={connection.lastError}
                      staleAfterDays={
                        connection.vendor === "claude_code_local"
                          ? SYNC_STALE_AFTER_DAYS
                          : undefined
                      }
                    />
                  </div>
                ))
              )}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/connections" />}
                >
                  <Cable data-icon="inline-start" />
                  {connections.length === 0
                    ? "View connections"
                    : "Manage connections"}
                </Button>
              </div>
            </CardContent>
          </Card>
          {/* People & teams roster — RELOCATED here from the top nav (W5-H
           * deliverable 2). The pages still resolve; team create/manage dialogs
           * also live on Settings for admins. Reachable in ≤2 clicks. */}
          <Card>
            <CardHeader>
              <CardTitle>{TEAM_OVERVIEW_COPY.setup.peopleTeams}</CardTitle>
              <CardDescription>
                {TEAM_OVERVIEW_COPY.setup.peopleTeamsDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/people" />}
              >
                <UsersRound data-icon="inline-start" />
                People
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/teams" />}
              >
                <UsersRound data-icon="inline-start" />
                Teams
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
