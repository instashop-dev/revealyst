import type { forOrg } from "../db/org-scope";
import type { TeamInsightRow } from "../db/org-scope/team-insights";
import {
  buildCapabilityCoverage,
  type CapabilityCoverageRow,
} from "./capability-coverage";
import {
  applyMinPeopleFloor,
  type CapabilityHistoryRow,
} from "./capability-history";
import {
  computeAgenticAdoption,
  type AgenticAdoption,
} from "./agentic-adoption";
import { detectDailySpike, type AnomalyResult } from "./anomaly";
import {
  computeAttributionTrend,
  type AttributionTrend,
} from "./attribution-trend";
import {
  computeCorrelationPanel,
  type CorrelationResult,
} from "./correlation";
import {
  composeNarrative,
  type Narrative,
  type NarrativeNotableEvent,
} from "./narrative";
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
import { detectPlateau, type PlateauResult } from "./plateau";
import type { CatalogRecommendation } from "./recommendation-catalog";
import {
  resolveSegmentSource,
  SEGMENT_MIN_PEOPLE_TO_NAME,
  type SegmentDistribution,
} from "./segments";
import { CAPABILITY_STATE_CONSTANTS } from "../scoring/capability-state";
import {
  resolveSharedAccountSource,
  type SharedAccountFlag,
} from "./shared-account";
import {
  computeUsageBaselines,
  materializeMeasuredZeroWeeks,
} from "./usage-baselines";
import {
  resolvePerPersonUsage,
  summarizeUsageConcentration,
  summarizeUsageDistribution,
  type UsageConcentration,
  type UsageDistribution,
} from "./usage-distribution";
import { assertTeamOnlyPseudonymized, type VisibilityMode } from "./visibility";

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
  /** The org's subjects + identity links — ALREADY fetched in the depth-1
   * Promise.all below (shared by the shared-account source). Returned so the
   * team Data Trust card can compute per-person signal COVERAGE
   * (src/lib/signal-coverage.ts) with ZERO new queries. The full subject rows
   * DO carry identity (email/displayName/externalId), so the view exposes a
   * deliberate PROJECTION to the two internal ids coverage actually needs —
   * a future consumer can't accidentally render a vendor identifier from
   * here. `identities` carries only internal uuids by construction. Neither
   * therefore adds anything `assertTeamOnlyPseudonymized`
   * (src/lib/visibility.ts) must inspect, and the team surface renders
   * coverage as an AGGREGATE count only (never a per-named-person list). */
  subjects: readonly { id: string; connectionId: string }[];
  identities: Awaited<ReturnType<OrgScope["identities"]["all"]>>;
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
  /** F2.3 (I2/I3) early-warning results, computed request-time in stage-2 from
   * rows already fetched below — spend/prompts daily series (spike detection),
   * `active_day` + identities (the M8 retention curve behind the plateau
   * detector), and `connections.lastSuccessAt` (the G5 staleness/post-gap
   * gates). ZERO new queries. All THREE are aggregate-only — an org daily
   * total, an org daily total, and a weekly active-PEOPLE count series — with
   * NO person id, pseudonym, name, or per-named-person value, so like
   * `recentMovement`/`agentic` above they add nothing
   * `assertTeamOnlyPseudonymized` (src/lib/visibility.ts) must inspect. The
   * detectors self-gate (staleness, post-gap catch-up batches, insufficient
   * baselines), so a stale or sparse org yields a non-`spike`/non-`plateau`
   * kind, never a fabricated alert. */
  spendAnomaly: AnomalyResult;
  promptAnomaly: AnomalyResult;
  usagePlateau: PlateauResult;
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
  /** W6-C (ADR 0033) — the per-org recommendation catalog (global presets ∪
   * this org's rows), fetched in the depth-1 Promise.all below (+1 query, no new
   * sequential stage) and evaluated per-person IN MEMORY by `deriveAttention`
   * on the page — never re-queried per person (§8.2 perf floor). Rows are
   * global/org reference content (title/body/metadata) with NO person data, so
   * like `definitions`/`gaps` they add nothing `assertTeamOnlyPseudonymized`
   * (src/lib/visibility.ts) must inspect. */
  recommendations: CatalogRecommendation[];
  /** W7-1 — capability slug → display label (global reference data, no org_id),
   * fetched in the same depth-1 Promise.all (+1 query, no new stage). Used ONLY
   * to attach a display label to a recommendation on the coaching card; carries
   * no person data, so it leaves `assertTeamOnlyPseudonymized` unaffected. */
  capabilityLabels: Map<string, string>;
  /** W7-6 — aggregate capability-coverage rollup for the team view: per
   * capability, how many people are at/above the mastery threshold out of how
   * many have any state. COUNT-ONLY and `MIN_PEOPLE`-floored (a capability with
   * fewer than `SEGMENT_MIN_PEOPLE_TO_NAME` people with state is omitted, never
   * a suppressed-but-implied number). The row shape carries NO person id/name,
   * so a per-person leak is structurally impossible — it adds nothing
   * `assertTeamOnlyPseudonymized` must inspect. */
  capabilityCoverage: CapabilityCoverageRow[];
  /** TCI Phase 2-F (ADR 0050): the OPEN aggregate manager insight feed (≤3),
   * COUNT-ONLY. Each row carries only a category + count-only params + a
   * capability subject slug — NO person id/name (the row shape makes a
   * per-person leak structurally impossible), so like `capabilityCoverage` it
   * adds nothing `assertTeamOnlyPseudonymized` must inspect. Plain-English copy
   * is rendered from the glossary on the card, never stored. */
  teamInsights: TeamInsightRow[];
  /** TCI Phase 2-F growth-trend card: the per-capability team history rollup
   * (ADR 0046), MIN_PEOPLE-floored at READ (a below-floor capability is dropped
   * entirely, never a suppressed-but-implied number). COUNT-ONLY — the rows
   * carry represented/mastered COUNTS and capability slugs, no person data, so
   * they too leave the privacy predicate unaffected. Ordered oldest-period
   * first for a left-to-right trend. */
  capabilityGrowth: CapabilityHistoryRow[];
};

// Re-exported from the shared builder so existing importers of
// `CapabilityCoverageRow` from this module keep working (the type + the build
// logic now live in src/lib/capability-coverage.ts, shared with the team brief).
export type { CapabilityCoverageRow };

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
    recommendations,
    capabilityLabels,
    capabilityCoverageCounts,
    teamInsights,
    capabilityGrowthRows,
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
    // W6-C (ADR 0033): the per-org recommendation catalog — ONE read folded
    // into this single round-trip (§8.2 perf floor), evaluated per-person in
    // memory by `deriveAttention` on the page. Global presets ∪ this org's rows.
    scope.catalog.list(),
    // W7-1: capability slug → label map (global reference data), same single
    // round-trip — the coaching card's "advances X" label source.
    scope.capabilities.labels(),
    // W7-6: aggregate capability-coverage counts (mastered vs with-state per
    // capability, COUNT-ONLY — no person id) for the team rollup. One batched
    // read; MIN_PEOPLE floor + label join happen in memory below.
    scope.mastery.coverageCounts(CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD),
    // TCI Phase 2-F (ADR 0050): the OPEN manager insight feed (≤3) + the
    // per-capability team history rollup for the growth-trend card — TWO reads
    // folded into this single round-trip (§8.2 perf floor), both count-only and
    // free of person data, so neither adds a sequential stage nor anything the
    // privacy predicate must inspect.
    scope.teamInsights.listOpen(),
    scope.capabilityHistory.list(),
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

  // F2.3 stage-2 (I2/I3): pure derivation over rows already fetched above, zero
  // further queries. Spike detection compares the last COMPLETE day's org spend
  // / prompt total against its trailing 28-day baseline (the detector excludes
  // today and the day itself); the plateau detector reads the M8 weekly
  // active-people retention curve with activity-less complete weeks
  // materialized as measured zeros (a total collapse must register, not vanish
  // — see materializeMeasuredZeroWeeks). Both self-gate on connection
  // staleness (G5) from `connections.lastSuccessAt`.
  const usageBaselines = computeUsageBaselines({
    activeDayRows: activeDayRecords,
    identityLinks: identities,
    windowTo: window.to,
  });
  const usagePlateau = detectPlateau({
    weeklyActive: materializeMeasuredZeroWeeks(usageBaselines),
    connections,
    today: window.to,
  });
  const spendAnomaly = detectDailySpike({
    metric: "spend",
    records: spendRecords,
    today: window.to,
    connections,
  });
  const promptAnomaly = detectDailySpike({
    metric: "prompts",
    records: promptRecords,
    today: window.to,
    connections,
  });

  // F2.4 (I7/I4): both derive in JS from rows already fetched above — zero new
  // queries, no new sequential stage (G10). The narrative composes the movement
  // (F1.2), agentic (F1.4), and attribution (F1.7) results already in hand,
  // plus the F2.3 spike/plateau results above as its notable events (they are
  // optional directional inputs — a non-`spike`/non-`plateau` kind adds no
  // sentence, so a quiet or stale org narrates honestly without them).
  const notableEvents: NarrativeNotableEvent[] = [];
  for (const anomaly of [spendAnomaly, promptAnomaly]) {
    if (anomaly.kind === "spike") {
      notableEvents.push({
        kind: "spike",
        subject: anomaly.signal.metric,
        multiple: anomaly.signal.factor,
        onDate: anomaly.signal.day,
      });
    }
  }
  if (usagePlateau.kind === "plateau") {
    notableEvents.push({ kind: "plateau", subject: "active-people" });
  }
  const narrative = composeNarrative({
    movement: recentMovement,
    agentic,
    attribution: attributionTrend,
    notableEvents,
  });
  const correlations = computeCorrelationPanel({
    windowTo: window.to,
    spendReportedRows: spendRecords,
    activeDayRows: activeDayRecords,
    agentActiveRows: agentActiveRecords,
    promptRows: promptRecords,
    identities,
  });

  const view: DashboardView = {
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
    // Already fetched above — returned for the Data Trust coverage element
    // (zero new queries). PROJECTED to the two internal ids coverage needs:
    // the full rows carry email/displayName/externalId, which must never
    // ride out on the composed view. See the DashboardView.subjects doc.
    subjects: subjects.map((s) => ({ id: s.id, connectionId: s.connectionId })),
    identities,
    // Both computed once above (zero new reads) and reused here + by the F2.4
    // narrative: the person-attributed usage-day share (F1.7) and the agentic
    // person-day rate (F1.4), identity-resolved from already-fetched rows.
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
    // W7-6: aggregate capability coverage — count-only, MIN_PEOPLE-floored, no
    // person data. A capability with fewer than the floor of people-with-state
    // is dropped entirely (never a suppressed-but-implied number). Ordered by
    // mastery share descending, then label.
    // W7-6: aggregate capability coverage — count-only, MIN_PEOPLE-floored, no
    // person data. Built by the SHARED `buildCapabilityCoverage` helper (also
    // used by the weekly team brief) so the two surfaces can never disagree.
    capabilityCoverage: buildCapabilityCoverage(
      capabilityCoverageCounts,
      capabilityLabels,
    ),
    // TCI Phase 2-F: the open manager insight feed, straight from the read
    // (already severity-ordered, ≤3, count-only). Rendered to prose on the card.
    teamInsights,
    // TCI Phase 2-F growth card: org-wide history rows, MIN_PEOPLE-floored at
    // READ (org-wide series only — team_id null; a multi-team split is a later
    // no-schema-change follow-up), oldest period first for a left-to-right
    // trend. The floor drops a below-floor capability entirely (never a
    // suppressed-but-implied number).
    capabilityGrowth: applyMinPeopleFloor(
      capabilityGrowthRows.filter((r) => r.teamId === null),
    ),
  };

  // T2.1: enforce the §7 privacy default at runtime, not just in tests. Gated
  // on `private` — `managed`/`full` are real, admin-opted-into governance
  // postures (src/lib/visibility-playbook.ts) that deliberately surface real
  // names/account identifiers, so asserting team-only-pseudonymized against
  // those modes would 500 every managed/full org as a matter of course, not
  // catch a bug. `private` (the default, EU-safe posture, and the one the
  // gated Wave-10 companion-in-team work needs proven at runtime) must never
  // leak — if it ever does, that's a real bug and failing closed (a 500) beats
  // silently rendering a real name.
  if (visibilityMode === "private") {
    assertTeamOnlyPseudonymized(view);
  }

  return view;
}
