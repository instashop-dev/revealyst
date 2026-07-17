import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight, Cable, Gauge, UsersRound } from "lucide-react";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { AgenticAdoptionCard } from "@/components/dashboard/agentic-adoption-card";
import { AttributionTrendCard } from "@/components/dashboard/attribution-trend-card";
import { BenchmarkPanel } from "@/components/dashboard/benchmark-panel";
import {
  DataTrustCard,
  type CoverageAggregate,
} from "@/components/dashboard/data-trust-card";
import { MaturityExportButton } from "@/components/dashboard/maturity-export-button";
import { TeamNarrativeHero } from "@/components/dashboard/team-narrative-hero";
import { RecentMovementPanel } from "@/components/dashboard/recent-movement-panel";
import { ScoreTrend } from "@/components/dashboard/score-trend";
import { SegmentBreakdown } from "@/components/dashboard/segment-breakdown";
import { SharedAccountFlags } from "@/components/dashboard/shared-account-flags";
import { TeamFreshnessLine } from "@/components/dashboard/team-freshness-line";
import { ToolCoveragePanel } from "@/components/dashboard/tool-coverage-panel";
import { CapabilityCoverageCard } from "@/components/dashboard/capability-coverage-card";
import { ManagerInsightsCard } from "@/components/dashboard/manager-insights-card";
import { CapabilityGrowthCard } from "@/components/dashboard/capability-growth-card";
import { TrainingOpportunitiesCard } from "@/components/dashboard/training-opportunities-card";
import { UsageConcentrationPanel } from "@/components/dashboard/usage-concentration-panel";
import { UsageDistributionPanel } from "@/components/dashboard/usage-distribution-panel";
import { MaturityAxisMeters } from "@/components/maturity/maturity-axis-meters";
import { MaturityLevelBanner } from "@/components/maturity/maturity-level-banner";
import { EmptyState } from "@/components/empty-state";
import { OnboardingInterim } from "@/components/onboarding-interim";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { CollapsibleSection } from "@/components/collapsible-section";
import { ScoreCard, type ScoreCardData } from "@/components/scores/score-card";
import { fromDashboardScore } from "@/components/scores/score-card-model";
import { BudgetAlertBanner } from "@/components/spend/budget-alert-banner";
import { SyncStalenessBanner } from "@/components/sync-staleness-banner";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SYNC_STALE_AFTER_DAYS } from "@/lib/agent-sync";
import { type AppContext } from "@/lib/api-context";
import { latestTeamScoresBySlug } from "@/lib/dashboard-read";
import { readDashboardView } from "@/lib/dashboard-view";
import { readMaturityView } from "@/lib/maturity";
import { formatCents } from "@/lib/format";
import { readBudgetAlertForRole, todayUtc } from "@/lib/spend-governance";
import { SCORE_SLUGS, type ScoreSlug } from "@/lib/metrics-glossary";
import { SEGMENT_MIN_PEOPLE_TO_NAME } from "@/lib/segments";
import { isUsableConnection, syncedToolCount } from "@/lib/onboarding-guide";
import { timeStage } from "@/lib/request-timing";
import { computeSignalCoverage } from "@/lib/signal-coverage";
import { isTeamOverviewView, trackLaunchEvent } from "@/lib/launch-events";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";
import { NEW_TEAM_INVITE_CTA } from "@/lib/team-onboarding-copy";
import { MANAGER_ROSTER_COPY } from "@/lib/manager-capability-copy";
import { managerSurfaceAvailable } from "@/lib/manager-capability-view";
import {
  connectionAttentionInputs,
  deriveAttention,
  deriveDelta,
  teamScoreDropAttribution,
  type DeltaResult,
} from "@/lib/score-insights";
import { vendorLabel } from "@/lib/vendor-labels";
import { VISIBILITY_MODE_INFO } from "@/lib/visibility-playbook";
import {
  AttentionSection,
  dashboardWindow,
  SpendGovernanceLine,
} from "./shared";

export async function TeamOverview({ ctx }: { ctx: AppContext }) {
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
  // P3-A (ADR 0045): the manager entry-point read is folded into the SAME flat
  // Promise.all (depth 1, perf law G10) — the drill-in link shows only for a
  // manager (≥1 managed team) in managed/full mode. It's just the id list here;
  // no per-person data reaches this count-only dashboard (D-TCI-5).
  const [view, budgetAlert, maturity, managedTeamIds] = await timeStage(
    "pageData",
    () =>
      Promise.all([
        readDashboardView(ctx.scope, ctx.org.visibilityMode, dashboardWindow()),
        readBudgetAlertForRole(ctx.scope, ctx.role, todayUtc()),
        readMaturityView(ctx.scope, todayUtc()),
        ctx.scope.teamManagers.managedTeamIds(ctx.user.id),
      ]),
  );
  const showManagerEntry =
    managerSurfaceAvailable(ctx.org.visibilityMode) && managedTeamIds.length > 0;

  // TCI §15 team_overview_view (P2-B): the manager-engagement signal for a
  // team-dashboard view. Emitted HERE, not at the src/worker.ts seam, because
  // the seam is path-based and `/dashboard` is shared with the personal
  // companion — only this branch knows the org is a team (page.tsx routed here
  // on `org.kind !== "personal"`). Content-free by construction: no dim, not
  // even the org id (same privacy rule as companion_revisit). RSC soft-navs are
  // excluded (isTeamOverviewView) so a client-side route transition isn't
  // double-counted, matching companion_revisit at the seam. trackLaunchEvent
  // no-ops without the LAUNCH_EVENTS binding (plain `next dev`, tests, build)
  // and never throws; fired after the pageData reads so it adds nothing to TTFB
  // (writeDataPoint is a synchronous, buffered Analytics Engine write — no
  // request-path round trip).
  if (isTeamOverviewView((await headers()).has("rsc"))) {
    await trackLaunchEvent("team_overview_view");
  }
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
    teamInsights,
    capabilityGrowth,
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
      >
        {/* P2c freshness indicator — reuses maturity.dataAsOf (already in the
         * page's single Promise.all), so the header shows how current the whole
         * surface is with zero extra reads. */}
        <TeamFreshnessLine dataAsOf={maturity.dataAsOf} stale={maturity.stale} />
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

      <AttentionSection items={attentionItems} />

      {/* P3-A (ADR 0045): manager-only entry into the per-person capability
       * drill-in. A SEPARATE surface from the count-only 5-card fold below —
       * no per-person data here, just a link. Shown only to a manager (≥1
       * managed team) in managed/full mode; hidden in private (surface absent). */}
      {showManagerEntry ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="size-4 text-primary" aria-hidden="true" />
              {MANAGER_ROSTER_COPY.entryCard.title}
            </CardTitle>
            <CardDescription>
              {MANAGER_ROSTER_COPY.entryCard.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/team" />}
            >
              {MANAGER_ROSTER_COPY.entryCard.action}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {hasScores ? (
        // W5-H dashboard-itis fold: ~18–20 panels curated into FIVE
        // audience-scoped cards — Team AI health · AI maturity · Training
        // opportunities · Benchmarks & distribution · Data trust. Every retired
        // panel keeps its component; only the grouping changed (curation over
        // the same readDashboardView batch — no new reader, no capability loss).
        <>
          {/* U4.1 narrative hero: the period story leads (promoted out of
           * section (a)), with a single CTA into the training section below.
           * Reorder only — same `narrative`/`correlations` the card always
           * received. */}
          <TeamNarrativeHero narrative={narrative} correlations={correlations} />

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

          {/* TCI Phase 2-F: the aggregate manager insight feed (≤3, count-only,
           * dismissible) + the capability growth trend. ONE self-contained
           * section, so a parallel edit to this file (the P3-A manager entry
           * card) rebases cleanly. Both cards are aggregate/MIN_PEOPLE-floored
           * with no per-person data. */}
          <section id="team-insights" className="flex flex-col gap-3">
            <SectionHeading>Insights &amp; growth</SectionHeading>
            <p className="text-sm text-muted-foreground">
              A short, prioritized read on what&apos;s worth your attention, and
              how your team&apos;s capabilities are trending — aggregate only.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <ManagerInsightsCard
                insights={teamInsights}
                capabilityLabels={capabilityLabels}
              />
              <CapabilityGrowthCard
                rows={capabilityGrowth}
                capabilityLabels={capabilityLabels}
              />
            </div>
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
          <section id="team-training" className="flex flex-col gap-3">
            <SectionHeading>{TEAM_OVERVIEW_COPY.training.title}</SectionHeading>
            <p className="text-sm text-muted-foreground">
              {TEAM_OVERVIEW_COPY.training.sectionLead}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <TrainingOpportunitiesCard
                segments={segments}
                plateau={usagePlateau}
              />
              {/* W7-6: aggregate, count-only capability coverage — the manager's
               * "where to coach" surface, MIN_PEOPLE-floored, no per-person data.
               * U4.1: the floor note states WHY a small-group capability is
               * absent instead of it silently vanishing (count-free rule). */}
              <CapabilityCoverageCard
                rows={capabilityCoverage}
                floorNote={TEAM_OVERVIEW_COPY.floorNote(SEGMENT_MIN_PEOPLE_TO_NAME)}
              />
              {/* P2c distribution completeness: the count-only tally of tracked
               * people with no activity yet this period, so the split never
               * implies the segmented people are the whole team. */}
              <SegmentBreakdown
                distribution={segments}
                notYetActive={summary.notYetActive}
              />
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
          {/* A brand-new team workspace lands here. Point the admin who just
           * created it at inviting people (Settings → People, where the invite
           * affordance lives) so the create → invite path is coherent. Members
           * can't manage people, so they see only the "how scores work" link. */}
          {ctx.role === "admin" ? (
            <Button
              nativeButton={false}
              render={<Link href="/settings/people" />}
            >
              <UsersRound data-icon="inline-start" />
              {NEW_TEAM_INVITE_CTA.action}
            </Button>
          ) : null}
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
          {/* People & teams — consolidated into the admin-only /settings/people
           * tab (U3). The card is ADMIN-GATED like its "Workspace settings"
           * sibling: pre-U3 the un-gated /people and /teams roster pages were an
           * unretired W5-H leftover, and a member-visible button here would now
           * dead-end on the tab's admins-only notice (U3 review finding). */}
          {ctx.role === "admin" && (
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
                  render={<Link href="/settings/people" />}
                >
                  <UsersRound data-icon="inline-start" />
                  People &amp; teams
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </>
  );
}
