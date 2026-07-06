import Link from "next/link";
import { Cable, Gauge } from "lucide-react";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { BenchmarkPanel } from "@/components/dashboard/benchmark-panel";
import { ScoreCard } from "@/components/dashboard/score-card";
import { ScoreTrend } from "@/components/dashboard/score-trend";
import { SegmentBreakdown } from "@/components/dashboard/segment-breakdown";
import { SharedAccountFlags } from "@/components/dashboard/shared-account-flags";
import { ToolCoveragePanel } from "@/components/dashboard/tool-coverage-panel";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import { resolveBenchmarkSource } from "@/lib/benchmarks";
import {
  latestTeamScoresBySlug,
  readDashboard,
  readToolCoverage,
} from "@/lib/dashboard-read";
import { readActivityHeatmap } from "@/lib/dashboard-signals";
import { readScoreTrends } from "@/lib/dashboard-trends";
import { resolveSegmentSource } from "@/lib/segments";
import { resolveSharedAccountSource } from "@/lib/shared-account";
import { vendorLabel } from "@/lib/vendor-labels";

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

function formatSpend(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const readWindow = dashboardWindow();
  const [connections, summary, heatmap, coverage, trends, segments, sharedAccounts] =
    await Promise.all([
      ctx.scope.connections.list(),
      readDashboard(ctx.scope, ctx.org.visibilityMode, readWindow),
      readActivityHeatmap(ctx.scope, readWindow),
      readToolCoverage(ctx.scope, readWindow),
      readScoreTrends(ctx.scope, readWindow),
      resolveSegmentSource().forOrg(ctx.scope, ctx.org.visibilityMode, readWindow),
      resolveSharedAccountSource().flags(ctx.scope),
    ]);

  const latest = latestTeamScoresBySlug(summary.scores);
  const adoption = latest.get("adoption") ?? null;
  const fluency = latest.get("fluency") ?? null;
  const efficiency = latest.get("efficiency") ?? null;
  const hasScores = latest.size > 0;

  const benchmarks = resolveBenchmarkSource().forScores([
    { slug: "adoption", value: adoption?.value ?? null },
    { slug: "fluency", value: fluency?.value ?? null },
    { slug: "efficiency", value: efficiency?.value ?? null },
  ]);

  const spendFooter =
    summary.spendCents > 0 || summary.spendCentsEstimated > 0 ? (
      <>
        {formatSpend(summary.spendCents)} total spend across tools
        {summary.spendCentsEstimated > 0
          ? ` (+${formatSpend(summary.spendCentsEstimated)} estimated)`
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
            <CardDescription>
              {ctx.org.kind === "personal"
                ? "Personal workspace — an org of one."
                : "Team workspace."}
            </CardDescription>
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
                No connections yet. Metrics start flowing once the first
                vendor is connected.
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
                {connections.length === 0 ? "View connections" : "Manage connections"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {hasScores ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <ScoreCard
              title="Adoption"
              description="Breadth and consistency of AI use."
              score={adoption}
            />
            <ScoreCard
              title="Fluency"
              description="Breadth · depth · effectiveness."
              score={fluency}
            />
            <ScoreCard
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
