import type { forOrg } from "../db/org-scope";
import {
  computeAgenticAdoption,
  type AgenticAdoption,
} from "./agentic-adoption";
import {
  computeAttributionTrend,
  type AttributionTrend,
} from "./attribution-trend";
import {
  computeCorrelationPanel,
  type CorrelationResult,
} from "./correlation";
import { composeNarrative, type Narrative } from "./narrative";
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
import {
  computeRecentMovement,
  RECENT_PERIOD_DAYS,
  type RecentMovement,
} from "./recent-movement";
import { resolveSegmentSource, type SegmentDistribution } from "./segments";
import {
  resolveSharedAccountSource,
  type SharedAccountFlag,
} from "./shared-account";
import {
  resolvePerPersonUsage,
  summarizeUsageConcentration,
  summarizeUsageDistribution,
  type UsageConcentration,
  type UsageDistribution,
} from "./usage-distribution";
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
  /** The org's connections, already fetched in the depth-1 Promise.all below
   * for readToolCoverage + the shared-account source. Returning them lets the
   * team dashboard page render its Connections panel and needs-attention strip
   * WITHOUT a separate `connections.list()` round trip stacked before this
   * view (that serial hop cost ~250–500ms per authenticated TTFB on
   * Workers→Hyperdrive→Neon). Connection rows carry no person data (vendor,
   * admin-set displayName, status) — same privacy rationale as `definitions`,
   * so `assertTeamOnlyPseudonymized` is unaffected. */
  connections: Awaited<ReturnType<OrgScope["connections"]["list"]>>;
  /** Attribution-coverage trend (F1.7) — the person-attributed share of tracked
   * usage over recent weeks, computed IN JS from the `active_day` rows already
   * fetched below (`activeDayRecords`), so it adds zero DB reads. It carries
   * only aggregate counts/percentages and week dates — no person identifiers of
   * any kind — so, like `definitions` and `gaps`, it does not change what
   * `assertTeamOnlyPseudonymized` (src/lib/visibility.ts) must inspect. */
  attributionTrend: AttributionTrend;
  /** Agentic-adoption view (F1.4 / research M6): the org-level share of active
   * days on which an AI agent was used, plus a weekly trend. Derived in JS from
   * the `agent_active` rows fetched in the stage-1 Promise.all below and the
   * `active_day` rows already fetched for the summary — one new query, zero new
   * sequential stages (G10). The value is aggregate-only: distinct subject-day
   * COUNTS and per-connector day counts, never a person identifier or a
   * per-person ranking — so, like `definitions`/`gaps`/`connections`, it does
   * not change what `assertTeamOnlyPseudonymized` (src/lib/visibility.ts) must
   * inspect, and the team surface stays aggregate-only (no per-person agentic
   * ranking, per the F1.4 constraint). */
  agentic: AgenticAdoption;
  /** F1.2 analytics computed in stage-2 from rows already fetched below (zero
   * new queries beyond one `prompts` read). All THREE are aggregate-only —
   * period-over-period counts (M1), band tallies + org-relative percentiles
   * (M3), and top-decile shares (M4) — carrying NO person id, pseudonym, name,
   * or per-named-person value. Like `definitions`/`gaps`/`connections` above,
   * they add nothing `assertTeamOnlyPseudonymized` (src/lib/visibility.ts)
   * needs to inspect (that predicate audits person refs on scores, segment
   * members, and shared-account identifiers — none of which appear here). */
  recentMovement: RecentMovement;
  usageDistribution: UsageDistribution;
  usageConcentration: UsageConcentration;
  /** F2.4 (research I7): a 3–6 sentence, template-composed plain-prose summary
   * of the recent period, built in JS from the movement/agentic/attribution
   * derivations already computed above — zero new reads, no LLM (G6). Carries
   * only aggregate sentences (no person id/pseudonym/name), so like
   * `recentMovement`/`agentic` it does not change what
   * `assertTeamOnlyPseudonymized` (src/lib/visibility.ts) inspects. */
  narrative: Narrative;
  /** F2.4 (research I4): the "moved together" panel — directional same-direction
   * agreement over weekly buckets for a few fixed metric pairs, derived in JS
   * from the same pre-fetched rows (zero new reads). Aggregate-only (pair keys +
   * percentages + week counts, never a subject/person identifier), so it too
   * leaves the privacy predicate unaffected. Explicitly non-causal (see
   * correlation.ts / CORRELATION_COPY). */
  correlations: CorrelationResult[];
};

export async function readDashboardView(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  window: { from: string; to: string },
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
    agentActiveRecords,
    featureRecords,
    volumeRecords,
    runs,
    promptRecords,
  ] = await Promise.all([
    scope.scores.results({ from: window.from, to: window.to }),
    scope.scores.definitions(),
    scope.people.list(),
    scope.connections.list(),
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
    // dim pinned to "" (active_day's undimmed catalog shape): the attribution
    // trend counts each row as one usage-day, so if a future connector ever
    // emitted dimmed active_day variants, unpinned rows would double-count
    // subject-days. readDashboard is unaffected either way — it dedups these
    // rows via subjectId/day sets, not row counts.
    scope.metrics.records({
      metricKey: "active_day",
      from: window.from,
      to: window.to,
      dim: "",
    }),
    // Agentic-adoption numerator (F1.4). One new stage-1 read — the denominator
    // (active_day) is already fetched above, so the rate + weekly trend derive
    // in JS with zero further queries and no new sequential stage (G10).
    scope.metrics.records({
      metricKey: "agent_active",
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
    // F1.2 (M4): prompt volume per person feeds the usage-concentration
    // module. The ONE new stage-1 read this feature adds — still round-trip
    // depth 1 (it rides the existing Promise.all, no new sequential stage).
    scope.metrics.records({
      metricKey: "prompts",
      from: window.from,
      to: window.to,
    }),
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

  // F1.2 stage-2 (M1/M3/M4): pure aggregation over rows already fetched above,
  // zero further queries. `window.to` is today UTC (dashboardWindow), a
  // partial day mid-ingestion — computeRecentMovement anchors both comparison
  // windows at the last COMPLETE day (today − 1) so a flat org never renders
  // a fabricated morning "decline". M3/M4 slice per-person usage over the
  // SAME current window (taken from the movement result, so the two can't
  // drift) — the whole "recent" story on the dashboard covers one window,
  // and today is excluded from it everywhere.
  const recentMovement = computeRecentMovement({
    today: window.to,
    spendReportedRecords: spendRecords,
    activeDayRecords,
    identities,
  });
  const inRecent = <T extends { day: string }>(rows: T[]) =>
    rows.filter(
      (r) =>
        r.day >= recentMovement.currentFrom && r.day <= recentMovement.currentTo,
    );
  const recentUsage = resolvePerPersonUsage({
    activeDayRows: inRecent(activeDayRecords),
    promptRows: inRecent(promptRecords),
    identities,
  });
  const usageDistribution = summarizeUsageDistribution(
    recentUsage.perPerson,
    RECENT_PERIOD_DAYS,
  );
  const usageConcentration = summarizeUsageConcentration(
    recentUsage.perPerson,
    // Volume the per-person math honestly could NOT attribute (unresolved
    // keys/accounts + shared multi-person subjects) — disclosed on the panel.
    recentUsage.excluded.unresolvedPrompts + recentUsage.excluded.sharedPrompts,
  );

  // Zero new reads: the person-attributed usage-day share and the agentic rate
  // both derive in JS from rows readDashboard already consumed. Hoisted to
  // consts so the F2.4 narrative below reuses the SAME results the view
  // returns, rather than recomputing them.
  const attributionTrend = computeAttributionTrend(activeDayRecords);
  const agentic = computeAgenticAdoption({
    agentActiveRows: agentActiveRecords,
    activeDayRows: activeDayRecords,
    identityLinks: identities,
    windowTo: window.to,
  });

  // F2.4 (I7/I4): both derive in JS from rows already fetched above — zero new
  // queries, no new sequential stage (G10). The narrative composes the movement
  // (F1.2), agentic (F1.4), and attribution (F1.7) results already in hand; the
  // correlation panel buckets the same spend/active/agent/prompt rows into
  // weeks. Notable events (F2.3 anomaly/plateau) are not on the view in this
  // phase, so none are passed — the composer omits that block honestly.
  const narrative = composeNarrative({
    movement: recentMovement,
    agentic,
    attribution: attributionTrend,
  });
  const correlations = computeCorrelationPanel({
    windowTo: window.to,
    spendReportedRows: spendRecords,
    activeDayRows: activeDayRecords,
    agentActiveRows: agentActiveRecords,
    promptRows: promptRecords,
    identities,
  });

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
    connections,
    // Both computed once above (zero new reads) and reused here + by the F2.4
    // narrative: the person-attributed usage-day share (F1.7) and the agentic
    // person-day rate (F1.4), identity-resolved from already-fetched rows.
    attributionTrend,
    agentic,
    recentMovement,
    usageDistribution,
    usageConcentration,
    narrative,
    correlations,
  };
}
