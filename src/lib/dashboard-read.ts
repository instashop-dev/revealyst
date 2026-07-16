import { scoreResultSchema } from "../contracts/api";
import {
  scoreComponentBreakdownSchema,
  type ScoreComponentBreakdown,
} from "../contracts/scores";
import type { forOrg } from "../db/org-scope";
import { groupBy } from "./utils";
import { toPersonRef, type PersonLike, type VisibilityMode } from "./visibility";

// Read/aggregate core for the team dashboard (W2-L). Pure functions over the
// org-scoped repository (`forOrg`) — never `createDb`, never a raw table.
// W2-L only RENDERS score_results; it must not re-derive scores (invariant b).
// The page and the /api/dashboard + /api/scores route cores both call these,
// so UI and API cannot drift.

type OrgScope = ReturnType<typeof forOrg>;
export type ScoreRow = Awaited<ReturnType<OrgScope["scores"]["results"]>>[number];
export type DefinitionRow = Awaited<ReturnType<OrgScope["scores"]["definitions"]>>[number];
export type MetricRecordRow = Awaited<ReturnType<OrgScope["metrics"]["records"]>>[number];
export type SubjectRow = Awaited<ReturnType<OrgScope["subjects"]["list"]>>[number];
export type IdentityRow = Awaited<ReturnType<OrgScope["identities"]["all"]>>[number];

/** The mapped, contract-valid score the dashboard renders. The frozen
 * `scoreResultSchema` types `components` as an opaque record; the dashboard
 * needs the typed per-component breakdown, so we narrow it here. */
export type DashboardScore = Omit<
  ReturnType<(typeof scoreResultSchema)["parse"]>,
  "components"
> & { components: ScoreComponentBreakdown };

/** The three org-level preset cards, in display order. */
export const DASHBOARD_SLUGS = ["adoption", "fluency", "efficiency"] as const;
export type DashboardSlug = (typeof DASHBOARD_SLUGS)[number];

/**
 * Maps one raw score_results row into the frozen `scoreResultSchema` shape.
 * `components` is rendered exactly as stored — an omitted component key means
 * "no data on a side" (the honesty rule), never a fabricated 0. A person-level
 * row is pseudonymised through the single `toPersonRef` gate.
 */
function mapScoreRow(
  row: ScoreRow,
  defs: Map<string, DefinitionRow>,
  people: Map<string, PersonLike>,
  visibilityMode: VisibilityMode,
): DashboardScore {
  const def = defs.get(row.definitionId);
  if (!def) {
    throw new Error(
      `score_results references unknown definition ${row.definitionId}`,
    );
  }
  let person: DashboardScore["person"] = null;
  if (row.personId != null) {
    const p = people.get(row.personId);
    if (!p) {
      throw new Error(`score_results references unknown person ${row.personId}`);
    }
    person = toPersonRef(p, visibilityMode);
  }
  const components = scoreComponentBreakdownSchema.parse(row.components);
  // Validate against the frozen contract shape (drift fails loudly here), then
  // return with the narrowed `components` type the dashboard renders against.
  scoreResultSchema.parse({
    definitionSlug: def.slug,
    definitionVersion: def.version,
    subjectLevel: row.subjectLevel,
    person,
    teamId: row.teamId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    periodGrain: row.periodGrain,
    value: row.value,
    attribution: row.attribution,
    components,
  });
  return {
    definitionSlug: def.slug,
    definitionVersion: def.version,
    subjectLevel: row.subjectLevel,
    person,
    teamId: row.teamId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    periodGrain: row.periodGrain,
    value: row.value,
    attribution: row.attribution,
    components,
  };
}

function sumValue(rows: { value: number }[]): number {
  return rows.reduce((total, row) => total + row.value, 0);
}

/** The typed org-level dashboard aggregate — the single read path the page
 * renders from and the `dashboardSummary` API core validates through. */
export type DashboardData = {
  scores: DashboardScore[];
  spendCents: number;
  spendCentsEstimated: number;
  /** Identity-resolved people with an active_day among their linked subjects
   * in the window — a count, never a per-user number. */
  activePeople: number;
  /** Tracked people with NO active_day among their linked subjects in the
   * window — the honest complement of `activePeople` over the org's tracked
   * people (`activePeople + notYetActive === tracked people`). A COUNT only,
   * never a per-person list, so the distribution can disclose how much of the
   * team it does not yet cover ("N not yet active") instead of implying the
   * segmented people are the whole team. */
  notYetActive: number;
  /** Key/account subjects with no identity link — surfaced, not billed. */
  unresolvedSubjects: number;
};

/** Pre-fetched inputs `readDashboard` can reuse instead of re-querying — all
 * optional, all fall back to the original per-function query when omitted
 * (standalone callers keep working unchanged; dashboard-view.ts supplies
 * everything so its whole render is one round-trip deep). */
export type DashboardReadPrefetched = {
  /** Unfiltered `scope.scores.results({from,to})` — a superset spanning
   * every subjectLevel, shared with dashboard-trends/segments so it's read
   * once per render (dashboard-view.ts) instead of three times. */
  rawScores?: ScoreRow[];
  definitions?: DefinitionRow[];
  people?: PersonLike[];
  /** metric_records for metricKey "spend_cents" over the window. */
  spendRecords?: MetricRecordRow[];
  /** metric_records for metricKey "spend_cents_estimated" over the window. */
  spendEstimatedRecords?: MetricRecordRow[];
  /** metric_records for metricKey "active_day" over the window. */
  activeDayRecords?: MetricRecordRow[];
  subjects?: SubjectRow[];
  identities?: IdentityRow[];
};

/**
 * Reads and aggregates the org-level dashboard over one window, through the
 * org-scoped repository only. Spend metrics are summed (estimated kept separate
 * — honesty, not blended). Never re-derives scores; renders score_results as-is.
 *
 * Every read here is independent of every other — they're gathered in one
 * Promise.all (fetch timing only; no aggregation logic changed) rather than
 * five sequential round trips.
 */
export async function readDashboard(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  window: { from: string; to: string },
  prefetched?: DashboardReadPrefetched,
): Promise<DashboardData> {
  const [rawScores, definitionRows, peopleRows, spendRecords, spendCentsEstimatedRecords, activeRows, subjects, allIdentities] =
    await Promise.all([
      prefetched?.rawScores ??
        scope.scores.results({ from: window.from, to: window.to }),
      prefetched?.definitions ?? scope.scores.definitions(),
      prefetched?.people ?? scope.people.list(),
      prefetched?.spendRecords ??
        scope.metrics.records({
          metricKey: "spend_cents",
          from: window.from,
          to: window.to,
        }),
      prefetched?.spendEstimatedRecords ??
        scope.metrics.records({
          metricKey: "spend_cents_estimated",
          from: window.from,
          to: window.to,
        }),
      prefetched?.activeDayRecords ??
        scope.metrics.records({
          metricKey: "active_day",
          from: window.from,
          to: window.to,
        }),
      prefetched?.subjects ?? scope.subjects.list(),
      prefetched?.identities ?? scope.identities.all(),
    ]);

  const defs = new Map(definitionRows.map((d) => [d.id, d]));
  const people = new Map(peopleRows.map((p) => [p.id, p]));

  // The team dashboard is team/org-level by construction. Person-level scores
  // are the opt-in individual self-view's concern (W2-H) and are never surfaced
  // here — so the private default is team-only pseudonymised structurally, not
  // by after-the-fact stripping. Person scores still feed segment counts.
  const teamScores = rawScores.filter((row) => row.subjectLevel !== "person");
  const scores = teamScores.map((row) => mapScoreRow(row, defs, people, visibilityMode));

  const spendCents = sumValue(spendRecords);
  const spendCentsEstimated = sumValue(spendCentsEstimatedRecords);

  const activeSubjectIds = new Set(activeRows.map((row) => row.subjectId));
  const linksByPerson = groupBy(allIdentities, (link) => link.personId);
  const subjectsWithLinks = new Set(allIdentities.map((link) => link.subjectId));

  const activePeople = peopleRows.filter((p) =>
    (linksByPerson.get(p.id) ?? []).some((link) =>
      activeSubjectIds.has(link.subjectId),
    ),
  ).length;
  // The complement over the org's tracked people — those with no active_day in
  // the window. `activePeople` is a filter of `peopleRows`, so it is always
  // ≤ the total and this can never go negative. Count only; no person leaves.
  const notYetActive = peopleRows.length - activePeople;
  const unresolvedSubjects = subjects.filter(
    (s) => !subjectsWithLinks.has(s.id),
  ).length;

  return {
    scores,
    spendCents,
    spendCentsEstimated,
    activePeople,
    notYetActive,
    unresolvedSubjects,
  };
}

/** Which tools are connected and which of their features are in use — the
 * "tool coverage" panel. Features are the distinct `feature_used` dims seen in
 * the window; connections carry sync status so a stale/errored tool is honest. */
export type ToolCoverage = {
  connections: {
    id: string;
    vendor: string;
    displayName: string;
    status: string;
  }[];
  features: string[];
};

export async function readToolCoverage(
  scope: OrgScope,
  window: { from: string; to: string },
  prefetched?: {
    connections?: Awaited<ReturnType<OrgScope["connections"]["list"]>>;
    /** metric_records for metricKey "feature_used" over the window. */
    featureRecords?: MetricRecordRow[];
  },
): Promise<ToolCoverage> {
  const [connections, featureRows] = await Promise.all([
    prefetched?.connections ?? scope.connections.list(),
    prefetched?.featureRecords ??
      scope.metrics.records({
        metricKey: "feature_used",
        from: window.from,
        to: window.to,
      }),
  ]);
  const features = [...new Set(featureRows.map((row) => row.dim))]
    .filter((dim) => dim.length > 0)
    .sort();
  return {
    connections: connections.map((c) => ({
      id: c.id,
      vendor: c.vendor,
      displayName: c.displayName,
      status: c.status,
    })),
    features,
  };
}

/**
 * The latest TEAM-level score per definition slug — what the three org-level
 * cards render. "Latest" = highest periodEnd, tie-broken by definition version,
 * so a re-run or a newer definition version wins deterministically.
 */
export function latestTeamScoresBySlug<
  T extends {
    subjectLevel: string;
    definitionSlug: string;
    periodEnd: string;
    definitionVersion: number;
  },
>(scores: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const s of scores) {
    if (s.subjectLevel !== "team") continue;
    const current = latest.get(s.definitionSlug);
    const newer =
      !current ||
      s.periodEnd > current.periodEnd ||
      (s.periodEnd === current.periodEnd &&
        s.definitionVersion > current.definitionVersion);
    if (newer) latest.set(s.definitionSlug, s);
  }
  return latest;
}
