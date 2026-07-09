import Link from "next/link";
import { redirect } from "next/navigation";
import { Cable, Gauge, Info, UsersRound } from "lucide-react";
import { BenchmarkConsentToggle } from "@/components/benchmark-consent-toggle";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { BenchmarkPanel } from "@/components/dashboard/benchmark-panel";
import { ScoreCard as TeamScoreCard } from "@/components/dashboard/score-card";
import { ScoreTrend } from "@/components/dashboard/score-trend";
import { SegmentBreakdown } from "@/components/dashboard/segment-breakdown";
import { SharedAccountFlags } from "@/components/dashboard/shared-account-flags";
import { ToolCoveragePanel } from "@/components/dashboard/tool-coverage-panel";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ScoreCard, type ScoreComponentView } from "@/components/score-card";
import { ShareScoreButton } from "@/components/share-score-button";
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
import { requireAppContext, type AppContext } from "@/lib/api-context";
import { dashboardSummary } from "@/lib/api-impl";
import { latestTeamScoresBySlug } from "@/lib/dashboard-read";
import { readDashboardView } from "@/lib/dashboard-view";
import { formatCents } from "@/lib/format";
import { vendorLabel } from "@/lib/vendor-labels";
import { periodFor } from "@/scoring";

export const dynamic = "force-dynamic";

const VISIBILITY_LABELS = {
  private: "Private — team-level, pseudonymized",
  managed: "Managed visibility",
  full: "Full visibility",
} as const;

// The three self-view scores + their component drill-down. Component keys
// mirror the (placeholder person-level, calibrated by W2-I) definitions; a
// component absent from a result's breakdown renders as "not enough data"
// (e.g. a ratio omitted for want of rows), never a fabricated 0.
const SCORE_META = [
  {
    slug: "adoption",
    title: "Adoption",
    description: "How consistently you're using AI across your tools.",
    components: [
      { key: "active_days", label: "Active days" },
      { key: "tool_coverage", label: "Tool coverage" },
    ],
  },
  {
    slug: "fluency",
    title: "Fluency",
    description: "Breadth, depth, and effectiveness of how you use AI.",
    components: [
      { key: "breadth", label: "Breadth" },
      { key: "depth", label: "Depth" },
      { key: "effectiveness", label: "Effectiveness" },
    ],
  },
  {
    slug: "efficiency",
    title: "Efficiency",
    description: "Output and engagement per dollar of AI spend.",
    components: [
      { key: "output_per_spend", label: "Output per $" },
      { key: "engagement_per_spend", label: "Engagement per $" },
    ],
  },
] as const;

type ScoreView = {
  value: number;
  attribution: "person" | "key_project" | "account";
  components: Record<string, unknown>;
};

function componentViews(
  score: ScoreView | undefined,
  specs: ReadonlyArray<{ key: string; label: string }>,
): ScoreComponentView[] {
  const comps = (score?.components ?? {}) as Record<
    string,
    { normalized?: number } | undefined
  >;
  return specs.map((s) => {
    const n = comps[s.key]?.normalized;
    return {
      key: s.key,
      label: s.label,
      normalized: typeof n === "number" ? n : null,
    };
  });
}

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
    return <PersonalSelfView ctx={ctx} />;
  }
  return <TeamOverview ctx={ctx} connections={connections} />;
}

async function PersonalSelfView({ ctx }: { ctx: AppContext }) {
  const today = new Date().toISOString().slice(0, 10);
  const period = periodFor("month", today);
  // Independent reads (one Postgres round trip each on Workers→Hyperdrive→
  // Neon) — gathered concurrently rather than run one after another.
  const [summary, benchmarks] = await Promise.all([
    dashboardSummary(ctx.scope, ctx.org.visibilityMode, {
      from: period.periodStart,
      to: period.periodEnd,
    }),
    // Personal self-view compares against the "overall" segment — an
    // enterprise/smb norm is not this solo user's peer group.
    listBenchmarks(ctx.db, { status: "verified", segment: "overall" }),
  ]);
  const scores = new Map(
    summary.scores
      .filter((s) => s.subjectLevel === "person" && s.periodGrain === "month")
      .map((s) => [s.definitionSlug, s as unknown as ScoreView]),
  );
  const monthLabel = new Date(`${period.periodStart}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  // Share the headline (fluency) score, and only once it's actually computed —
  // a share link to a "still computing" card isn't worth minting.
  const fluencyComputed = scores.has("fluency");
  const personId =
    summary.scores.find((s) => s.person)?.person?.id ?? null;

  return (
    <>
      <PageHeader
        title="Your AI self-view"
        description={`${monthLabel} · adoption, fluency, and efficiency from your connected tools.`}
      >
        {fluencyComputed && personId && (
          <ShareScoreButton
            personId={personId}
            scoreSlug="fluency"
            defaultLabel={ctx.user.name ?? "My AI"}
          />
        )}
      </PageHeader>

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
              <span className="text-xs text-muted-foreground">
                Estimated (Claude Code, agent-derived)
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {SCORE_META.map((meta) => {
          const score = scores.get(meta.slug);
          return (
            <ScoreCard
              key={meta.slug}
              title={meta.title}
              description={meta.description}
              value={score ? score.value : null}
              attribution={score?.attribution}
              components={componentViews(score, meta.components)}
            />
          );
        })}
      </div>

      {/* None of the three scores has ever computed, and there's ingested
          data sitting unlinked — the near-certain cause is that no `people`
          row exists yet for this org's usage subjects (nothing auto-creates
          one; /reconcile's "Create person" is the sanctioned manual path).
          Admin-gated like /reconcile itself — a non-admin member can't act
          on this, so don't show a dead-end link. */}
      {scores.size === 0 && summary.unresolvedSubjects > 0 && ctx.role === "admin" && (
        <Alert>
          <UsersRound />
          <AlertTitle>Scores need an identity link</AlertTitle>
          <AlertDescription>
            <p>
              We&apos;re seeing usage data, but it isn&apos;t linked to a
              tracked person yet, so Adoption, Fluency, and Efficiency
              can&apos;t compute. Resolve it once in Reconcile.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              nativeButton={false}
              render={<Link href="/reconcile" />}
            >
              Go to Reconcile
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {summary.gaps.length > 0 && (
        <Alert>
          <Info />
          <AlertTitle>How complete is this?</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {summary.gaps.map((gap, i) => (
                <li key={`${gap.kind}-${i}`}>{gap.detail ?? gap.kind}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benchmarks</CardTitle>
          <CardDescription>
            How your scores compare to published norms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {benchmarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Published benchmarks are being verified against primary sources
              and will appear here — we don&apos;t show unverified figures.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {benchmarks.map((b) => (
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
  const view = await readDashboardView(
    ctx.scope,
    ctx.org.visibilityMode,
    dashboardWindow(),
    { connections },
  );
  const { summary, benchmarks, heatmap, coverage, trends, segments, sharedAccounts } =
    view;
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

  return (
    <>
      <PageHeader
        title="Overview"
        description="Who's using AI, how well, and what it costs — across your tools."
      />
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
      {hasScores ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <TeamScoreCard
              title="Adoption"
              description="Breadth and consistency of AI use."
              score={adoption}
            />
            <TeamScoreCard
              title="Fluency"
              description="Breadth · depth · effectiveness."
              score={fluency}
            />
            <TeamScoreCard
              title="Efficiency"
              description="Value signals per unit of spend."
              score={efficiency}
              footer={spendFooter}
            />
            <BenchmarkPanel benchmarks={benchmarks} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ActivityHeatmap heatmap={heatmap} />
            <div className="grid gap-4">
              <ToolCoveragePanel coverage={coverage} />
              <ScoreTrend trends={trends} />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SegmentBreakdown distribution={segments} />
            <SharedAccountFlags flags={sharedAccounts} />
          </div>
        </>
      ) : (
        <EmptyState
          icon={Gauge}
          title="No scores yet"
          description="Adoption, Fluency, and Efficiency scores appear after your first connection syncs data. Nothing here is estimated — scores only ever come from real, attributed metrics."
        />
      )}
    </>
  );
}
