import { scoreResultSchema } from "../contracts/api";
import {
  scoreComponentBreakdownSchema,
  type ScoreComponentBreakdown,
} from "../contracts/scores";
import type { forOrg } from "../db/org-scope";
import { toPersonRef, type PersonLike, type VisibilityMode } from "./visibility";

// Read/aggregate core for the team dashboard (W2-L). Pure functions over the
// org-scoped repository (`forOrg`) — never `createDb`, never a raw table.
// W2-L only RENDERS score_results; it must not re-derive scores (invariant b).
// The page and the /api/dashboard + /api/scores route cores both call these,
// so UI and API cannot drift.

type OrgScope = ReturnType<typeof forOrg>;
type ScoreRow = Awaited<ReturnType<OrgScope["scores"]["results"]>>[number];
type DefinitionRow = Awaited<ReturnType<OrgScope["scores"]["definitions"]>>[number];

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

async function definitionIndex(scope: OrgScope): Promise<Map<string, DefinitionRow>> {
  const defs = await scope.scores.definitions();
  return new Map(defs.map((d) => [d.id, d]));
}

async function peopleIndex(scope: OrgScope): Promise<Map<string, PersonLike>> {
  const people = await scope.people.list();
  return new Map(people.map((p) => [p.id, p]));
}

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

/** Maps a batch of raw rows, resolving definitions and people once. */
export async function mapScoreResults(
  scope: OrgScope,
  rows: ScoreRow[],
  visibilityMode: VisibilityMode,
): Promise<DashboardScore[]> {
  const [defs, people] = await Promise.all([
    definitionIndex(scope),
    peopleIndex(scope),
  ]);
  return rows.map((row) => mapScoreRow(row, defs, people, visibilityMode));
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
  /** Key/account subjects with no identity link — surfaced, not billed. */
  unresolvedSubjects: number;
};

/**
 * Reads and aggregates the org-level dashboard over one window, through the
 * org-scoped repository only. Spend metrics are summed (estimated kept separate
 * — honesty, not blended). Never re-derives scores; renders score_results as-is.
 */
export async function readDashboard(
  scope: OrgScope,
  visibilityMode: VisibilityMode,
  window: { from: string; to: string },
): Promise<DashboardData> {
  const rawScores = await scope.scores.results({
    from: window.from,
    to: window.to,
  });
  const scores = await mapScoreResults(scope, rawScores, visibilityMode);

  const spendCents = sumValue(
    await scope.metrics.records({
      metricKey: "spend_cents",
      from: window.from,
      to: window.to,
    }),
  );
  const spendCentsEstimated = sumValue(
    await scope.metrics.records({
      metricKey: "spend_cents_estimated",
      from: window.from,
      to: window.to,
    }),
  );

  const activeRows = await scope.metrics.records({
    metricKey: "active_day",
    from: window.from,
    to: window.to,
  });
  const activeSubjectIds = new Set(activeRows.map((row) => row.subjectId));
  const people = await scope.people.list();
  let activePeople = 0;
  for (const person of people) {
    const links = await scope.identities.forPerson(person.id);
    if (links.some((link) => activeSubjectIds.has(link.subjectId))) {
      activePeople += 1;
    }
  }

  const subjects = await scope.subjects.list();
  let unresolvedSubjects = 0;
  for (const subject of subjects) {
    const links = await scope.identities.forSubject(subject.id);
    if (links.length === 0) unresolvedSubjects += 1;
  }

  return {
    scores,
    spendCents,
    spendCentsEstimated,
    activePeople,
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
): Promise<ToolCoverage> {
  const [connections, featureRows] = await Promise.all([
    scope.connections.list(),
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
