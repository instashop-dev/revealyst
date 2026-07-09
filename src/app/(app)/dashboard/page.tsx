import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Cable, Gauge, Info, TriangleAlert } from "lucide-react";
import { BenchmarkConsentToggle } from "@/components/benchmark-consent-toggle";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { BenchmarkPanel } from "@/components/dashboard/benchmark-panel";
import { ScoreTrend } from "@/components/dashboard/score-trend";
import { SegmentBreakdown } from "@/components/dashboard/segment-breakdown";
import { SharedAccountFlags } from "@/components/dashboard/shared-account-flags";
import { ToolCoveragePanel } from "@/components/dashboard/tool-coverage-panel";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { PageHeader } from "@/components/page-header";
import { ScoreCard } from "@/components/scores/score-card";
import {
  fromDashboardScore,
  fromPersonalScore,
  type PersonalScore,
} from "@/components/scores/score-card-model";
import { ShareScoreButton } from "@/components/share-score-button";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listBenchmarks } from "@/db/benchmarks";
import { requireAppContext, type AppContext } from "@/lib/api-context";
import { dashboardSummary } from "@/lib/api-impl";
import { latestTeamScoresBySlug } from "@/lib/dashboard-read";
import { readDashboardView } from "@/lib/dashboard-view";
import { formatCents } from "@/lib/format";
import {
  CONCEPT_GLOSSARY,
  methodologyAnchor,
  SCORE_SLUGS,
  type ScoreSlug,
} from "@/lib/metrics-glossary";
import { timeStage } from "@/lib/request-timing";
import {
  connectionAttentionInputs,
  deriveAttention,
  deriveDelta,
  personDeltaResult,
  type AttentionItem,
  type DeltaResult,
} from "@/lib/score-insights";
import { vendorLabel } from "@/lib/vendor-labels";
import { periodFor, previousDay } from "@/scoring";

export const dynamic = "force-dynamic";

const VISIBILITY_LABELS = {
  private: "Private — team-level, pseudonymized",
  managed: "Managed visibility",
  full: "Full visibility",
} as const;

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
  if (href === "/reconcile") return "Go to Reconcile";
  if (href === "/connections") return "Go to Connections";
  return "View";
}

function AttentionAlert({ item }: { item: AttentionItem }) {
  const isAction = item.severity === "action";
  return (
    <Alert>
      {isAction ? (
        <TriangleAlert />
      ) : (
        <Info className="text-muted-foreground" />
      )}
      <AlertTitle className={isAction ? undefined : "text-muted-foreground"}>
        {item.title}
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

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
      {children}
    </h2>
  );
}

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const connections = await ctx.scope.connections.list();

  // A fresh personal workspace has nothing to show until a source is
  // connected — send it to the focused onboarding flow (W2-H). An errored
  // connection (e.g. a rejected key at first attempt) does NOT count as
  // connected, so a bad first key can't strand the user on an empty
  // dashboard. /onboarding itself never redirects here, so there is no loop.
  const hasUsableConnection = connections.some((c) => c.status !== "error");
  if (ctx.org.kind === "personal" && !hasUsableConnection) {
    redirect("/onboarding");
  }

  if (ctx.org.kind === "personal") {
    return <PersonalSelfView ctx={ctx} connections={connections} />;
  }
  return <TeamOverview ctx={ctx} connections={connections} />;
}

async function PersonalSelfView({
  ctx,
  connections,
}: {
  ctx: AppContext;
  connections: Awaited<ReturnType<AppContext["scope"]["connections"]["list"]>>;
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
  const [summary, verifiedBenchmarks, definitions, prevScores] = await timeStage(
    "pageData",
    () =>
      Promise.all([
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
      ]),
  );
  const scores = new Map<string, PersonalScore>(
    summary.scores
      .filter((s) => s.subjectLevel === "person" && s.periodGrain === "month")
      .map((s) => [s.definitionSlug, s]),
  );
  const monthLabel = new Date(`${period.periodStart}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
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

  const scoreDrops = SCORE_SLUGS.map((slug) => ({ slug, d: deltas.get(slug) }))
    .filter(
      (x): x is { slug: ScoreSlug; d: Extract<DeltaResult, { kind: "delta" }> } =>
        x.d?.kind === "delta",
    )
    .map((x) => ({ slug: x.slug, delta: x.d.delta }));
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
  });

  return (
    <>
      <PageHeader
        title="Your AI self-view"
        description={`${monthLabel} — three scores from your connected tools. Tap the info icon next to any number for a plain-English explanation.`}
      >
        {fluencyComputed && personId && (
          <ShareScoreButton
            personId={personId}
            scoreSlug="fluency"
            defaultLabel={ctx.user.name ?? "My AI"}
          />
        )}
      </PageHeader>

      <AttentionSection items={attentionItems} />

      <div className="grid gap-4 md:grid-cols-3">
        {SCORE_SLUGS.map((slug) => (
          <ScoreCard
            key={slug}
            data={fromPersonalScore({
              slug,
              score: scores.get(slug) ?? null,
              definitions,
              delta: deltas.get(slug) ?? null,
            })}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend this month</CardTitle>
          <CardDescription>
            Consolidated across your connected AI tools.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="flex flex-col">
            <span className="font-heading text-3xl font-semibold tabular-nums">
              {formatCents(summary.spendCents)}
            </span>
            <span className="text-xs text-muted-foreground">Billed spend</span>
          </div>
          {summary.spendCentsEstimated > 0 && (
            <div className="flex flex-col">
              <span className="font-heading text-2xl font-semibold tabular-nums text-muted-foreground">
                {formatCents(summary.spendCentsEstimated)}
              </span>
              {/* spend_cents_estimated is currently only ever agent-derived
               * from Claude Code local logs (docs/connector-facts.md §5) —
               * naming the vendor here, rather than a bare "Estimated", is a
               * real fact about the only source that can produce this
               * number today, not an invented specificity. */}
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                Estimated · Claude Code (agent-derived)
                <InfoTip
                  label="Estimated spend"
                  short={CONCEPT_GLOSSARY.estimatedSpend.shortWhat}
                  learnMoreHref={`/methodology#${methodologyAnchor("estimatedSpend")}`}
                />
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* J1: the modeled-norms comparison panel (BenchmarkPanel) is
       * deliberately NOT rendered here. A single person vs. an org-modeled
       * peer curve is an unsupported comparison, and it previously sat right
       * above the verified-benchmarks card explaining "we don't show
       * unverified figures" — a direct contradiction. The team dashboard
       * keeps the panel; its own copy discloses the modeled-estimate
       * provenance (see CONCEPT_GLOSSARY.benchmarks). */}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benchmarks</CardTitle>
          <CardDescription>
            How your scores compare to published norms.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benchmarks &amp; privacy</CardTitle>
          <CardDescription>
            Your data is yours. Opt in to help build published benchmarks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BenchmarkConsentToggle />
        </CardContent>
      </Card>
    </>
  );
}

async function TeamOverview({
  ctx,
  connections,
}: {
  ctx: AppContext;
  connections: Awaited<ReturnType<AppContext["scope"]["connections"]["list"]>>;
}) {
  const view = await timeStage("pageData", () =>
    readDashboardView(ctx.scope, ctx.org.visibilityMode, dashboardWindow(), {
      connections,
    }),
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
  } = view;
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
  const scoreDrops = SCORE_SLUGS.map((slug) => ({ slug, d: deltas.get(slug)! }))
    .filter(
      (x): x is { slug: ScoreSlug; d: Extract<DeltaResult, { kind: "delta" }> } =>
        x.d.kind === "delta",
    )
    .map((x) => ({ slug: x.slug, delta: x.d.delta }));
  // Team's needs-attention strip is deliberately narrower than the personal
  // view's: shared-account count, errored connections, and score drops only
  // (no gaps/unresolved-subjects reads here — the composed team view doesn't
  // fetch connector_runs, and adding that read is out of scope for this
  // strip; the identity-link callout stays personal/admin-only).
  const attentionItems = deriveAttention({
    connections: connectionAttentionInputs(connections),
    gaps: [],
    sharedAccountCount: sharedAccounts.length,
    scoreDrops,
  });

  return (
    <>
      <PageHeader
        title="Overview"
        description="Who's using AI, how well, and what it costs — across your tools. Tap the info icon next to any number for a plain-English explanation."
      />

      <AttentionSection items={attentionItems} />

      {hasScores ? (
        <>
          <section className="flex flex-col gap-3">
            <SectionHeading>Scores &amp; benchmark</SectionHeading>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <ScoreCard
                data={fromDashboardScore({
                  slug: "adoption",
                  score: adoption,
                  definitions,
                  delta: deltas.get("adoption"),
                })}
              />
              <ScoreCard
                data={fromDashboardScore({
                  slug: "fluency",
                  score: fluency,
                  definitions,
                  delta: deltas.get("fluency"),
                })}
              />
              <ScoreCard
                data={fromDashboardScore({
                  slug: "efficiency",
                  score: efficiency,
                  definitions,
                  delta: deltas.get("efficiency"),
                  footer: spendFooter,
                })}
              />
              <BenchmarkPanel benchmarks={benchmarks} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeading>Activity</SectionHeading>
            <div className="grid gap-4 lg:grid-cols-2">
              <ActivityHeatmap heatmap={heatmap} />
              <div className="grid gap-4">
                <ToolCoveragePanel coverage={coverage} />
                <ScoreTrend trends={trends} />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeading>People</SectionHeading>
            <div className="grid gap-4 lg:grid-cols-2">
              <SegmentBreakdown distribution={segments} />
              <SharedAccountFlags flags={sharedAccounts} />
            </div>
          </section>
        </>
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
                  {VISIBILITY_LABELS[ctx.org.visibilityMode]}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Connections</CardTitle>
              <CardDescription>
                Vendor integrations feeding your metrics.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {connections.length === 0 ? (
                <p className="text-muted-foreground">
                  No connections yet. Metrics start flowing once the first vendor
                  is connected.
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
        </div>
      </section>
    </>
  );
}
