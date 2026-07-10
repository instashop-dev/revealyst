import type { forOrg } from "../db/org-scope";
import { resolveBenchmarkSource, type BenchmarkSummary } from "./benchmarks";
import {
  latestTeamScoresBySlug,
  readDashboard,
  readToolCoverage,
  type DashboardData,
  type DefinitionRow,
  type ToolCoverage,
} from "./dashboard-read";
import {
  readActivityHeatmap,
  type ActivityHeatmap,
} from "./dashboard-signals";
import { readScoreTrends, type ScoreTrend } from "./dashboard-trends";
import { collectGaps, type CollectedGap } from "./honesty-gaps";
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
  /** The global score-definition presets (metrics-UX redesign) — component
   * shapes/weights/normalization for the glossary's describeCalculation().
   * Already fetched below for trends/segments/summary; threading it onto the
   * view is additive (zero new queries). `assertTeamOnlyPseudonymized`
   * (src/lib/visibility.ts) only audits summary.scores[].person, segments'
   * members, and sharedAccounts' externalId — score_definitions rows are
   * global presets with no person data, so adding this field does not
   * change what that privacy predicate needs to inspect. */
  definitions: DefinitionRow[];
  /** Connector honesty gaps — degraded-attribution holes the connectors
   * report (src/lib/honesty-gaps.ts). W4-W finding A5: the personal self-view
   * already surfaces these in its needs-attention strip; the team view now
   * does too (same data, same "how complete is this?" framing), so a team
   * admin isn't shown fabricated coverage. Gaps carry only `{ kind, detail }`
   * — no person data — so like `definitions` they do not change what
   * `assertTeamOnlyPseudonymized` (src/lib/visibility.ts) must inspect. */
  gaps: CollectedGap[];
};

export async function readDashboardView(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  window: { from: string; to: string },
  prefetched?: {
    /** e.g. dashboard/page.tsx's own `connections.list()` fetch (needed
     * there for the Connections panel / personal-mode onboarding gate) —
     * pass to avoid a redundant query here too. */
    connections?: Awaited<ReturnType<OrgScope["connections"]["list"]>>;
  },
): Promise<DashboardView> {
  // EVERY DB read the composed view needs, in ONE Promise.all — round-trip
  // depth 1 on Workers→Hyperdrive→Neon (verified by tests/perf/
  // authenticated-page-queries.test.ts). The unfiltered scores.results is a
  // superset spanning every subjectLevel; the team/person subsets the
  // trends/segments modules used to re-query are exact JS filters of it
  // (split in one pass below). subjects/identities are shared between
  // readDashboard and the shared-account source; signalRows between the
  // heatmap and the shared-account detector. Fetch timing/dedup only — no
  // aggregation logic changed.
  const [
    rawScores,
    definitions,
    people,
    connections,
    signalRows,
    subjects,
    identities,
    spendRecords,
    spendEstimatedRecords,
    activeDayRecords,
    featureRecords,
    volumeRecords,
    runs,
  ] = await Promise.all([
    scope.scores.results({ from: window.from, to: window.to }),
    scope.scores.definitions(),
    scope.people.list(),
    prefetched?.connections ?? scope.connections.list(),
    scope.metrics.allSignals({ from: window.from, to: window.to }),
    scope.subjects.list(),
    scope.identities.all(),
    scope.metrics.records({
      metricKey: "spend_cents",
      from: window.from,
      to: window.to,
    }),
    scope.metrics.records({
      metricKey: "spend_cents_estimated",
      from: window.from,
      to: window.to,
    }),
    scope.metrics.records({
      metricKey: "active_day",
      from: window.from,
      to: window.to,
    }),
    scope.metrics.records({
      metricKey: "feature_used",
      from: window.from,
      to: window.to,
    }),
    // The shared-account detector's volume metric (its default key).
    scope.metrics.records({
      metricKey: "tokens_input",
      from: window.from,
      to: window.to,
    }),
    // Connector honesty gaps (A5) — same read the personal self-view makes
    // (api-impl.ts `dashboardSummary`); the recent runs carry the deduped
    // gap set the poller wrote. Additive to the single-round-trip Promise.all.
    scope.connectorRuns.list({ limit: 200 }),
  ]);

  // One pass over the superset: the exact splits trends (team) and segments
  // (person) would otherwise re-query with a subjectLevel filter.
  const teamLevelRows: typeof rawScores = [];
  const personLevelRows: typeof rawScores = [];
  for (const row of rawScores) {
    if (row.subjectLevel === "team") teamLevelRows.push(row);
    else if (row.subjectLevel === "person") personLevelRows.push(row);
  }

  // Downstream modules run on the pre-fetched rows only — zero further
  // queries (each module still fetches for itself when called standalone).
  const [summary, heatmap, coverage, trends, segments, sharedAccounts] =
    await Promise.all([
      readDashboard(scope, visibilityMode, window, {
        rawScores,
        definitions,
        people,
        spendRecords,
        spendEstimatedRecords,
        activeDayRecords,
        subjects,
        identities,
      }),
      readActivityHeatmap(scope, window, { signalRows }),
      readToolCoverage(scope, window, { connections, featureRecords }),
      readScoreTrends(scope, window, { rows: teamLevelRows, definitions }),
      resolveSegmentSource().forOrg(scope, visibilityMode, window, {
        rows: personLevelRows,
        definitions,
        people,
      }),
      resolveSharedAccountSource().flags(scope, visibilityMode, window, {
        connections,
        signalRows,
        subjects,
        identities,
        volumeRecords,
      }),
    ]);

  const latest = latestTeamScoresBySlug(summary.scores);
  const benchmarks = resolveBenchmarkSource().forScores([
    { slug: "adoption", value: latest.get("adoption")?.value ?? null },
    { slug: "fluency", value: latest.get("fluency")?.value ?? null },
    { slug: "efficiency", value: latest.get("efficiency")?.value ?? null },
  ]);

  return {
    summary,
    benchmarks,
    heatmap,
    coverage,
    trends,
    segments,
    sharedAccounts,
    definitions,
    gaps: collectGaps(runs),
  };
}
