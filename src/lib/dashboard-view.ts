import type { forOrg } from "../db/org-scope";
import { resolveBenchmarkSource, type BenchmarkSummary } from "./benchmarks";
import {
  latestTeamScoresBySlug,
  readDashboard,
  readToolCoverage,
  type DashboardData,
  type ToolCoverage,
} from "./dashboard-read";
import {
  readActivityHeatmap,
  type ActivityHeatmap,
} from "./dashboard-signals";
import { readScoreTrends, type ScoreTrend } from "./dashboard-trends";
import { resolveSegmentSource, type SegmentDistribution } from "./segments";
import {
  resolveSharedAccountSource,
  type SharedAccountFlag,
} from "./shared-account";
import type { VisibilityMode } from "./visibility";

type OrgScope = ReturnType<typeof forOrg>;

// THE composed team-dashboard view — one read path the page renders and the
// W1-S privacy E2E resolves through tests/harness/seams.ts. Every person that
// reaches this view has already passed the src/lib/visibility.ts gate; the
// assertTeamOnlyPseudonymized predicate audits the end state.
export type DashboardView = {
  summary: DashboardData;
  benchmarks: BenchmarkSummary[];
  heatmap: ActivityHeatmap;
  coverage: ToolCoverage;
  trends: ScoreTrend[];
  segments: SegmentDistribution;
  sharedAccounts: SharedAccountFlag[];
};

export async function readDashboardView(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  window: { from: string; to: string },
): Promise<DashboardView> {
  const [summary, heatmap, coverage, trends, segments, sharedAccounts] =
    await Promise.all([
      readDashboard(scope, visibilityMode, window),
      readActivityHeatmap(scope, window),
      readToolCoverage(scope, window),
      readScoreTrends(scope, window),
      resolveSegmentSource().forOrg(scope, visibilityMode, window),
      resolveSharedAccountSource().flags(scope, window),
    ]);

  const latest = latestTeamScoresBySlug(summary.scores);
  const benchmarks = resolveBenchmarkSource().forScores([
    { slug: "adoption", value: latest.get("adoption")?.value ?? null },
    { slug: "fluency", value: latest.get("fluency")?.value ?? null },
    { slug: "efficiency", value: latest.get("efficiency")?.value ?? null },
  ]);

  return { summary, benchmarks, heatmap, coverage, trends, segments, sharedAccounts };
}
