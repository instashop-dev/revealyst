import type { PeriodGrain } from "../contracts/scores";
import type { forOrg } from "../db/org-scope";
import {
  DASHBOARD_SLUGS,
  type DefinitionRow,
  type ScoreRow,
} from "./dashboard-read";
import { groupBy } from "./utils";

type OrgScope = ReturnType<typeof forOrg>;

// Score trends read (W2-L): the team-level score history over the window,
// grouped by definition slug into one series per preset. Read-only over
// score_results — the dashboard renders whatever periods the recompute wrote,
// in chronological order, and never interpolates missing periods.

export type ScoreTrendPoint = {
  periodStart: string;
  periodEnd: string;
  value: number;
  /** The period grain this point was computed at (week/month/rolling_28d) —
   * carried through so consumers can tell whether two points are actually
   * comparable instead of guessing from a day-span heuristic. */
  periodGrain: PeriodGrain;
  /** The scoring definition's version at the time this point was computed —
   * carried through so a v1→v2 definition change within the same slug is
   * detectable, not silently blended into one trend line. */
  definitionVersion: number;
};

export type ScoreTrend = {
  slug: string;
  points: ScoreTrendPoint[];
};

export async function readScoreTrends(
  scope: OrgScope,
  window: { from: string; to: string },
  prefetched?: {
    /** The exact subjectLevel:"team" subset — pass the JS-filtered slice of
     * dashboard-view.ts's single unfiltered `scores.results` fetch to avoid
     * a redundant query. */
    rows?: ScoreRow[];
    definitions?: DefinitionRow[];
  },
): Promise<ScoreTrend[]> {
  const [rows, definitions] = await Promise.all([
    prefetched?.rows ??
      scope.scores.results({
        from: window.from,
        to: window.to,
        subjectLevel: "team",
      }),
    prefetched?.definitions ?? scope.scores.definitions(),
  ]);
  const defById = new Map(definitions.map((d) => [d.id, d]));

  // Rows whose definition has no known slug group under `undefined` and are
  // never read below — same skip semantics as the previous hand-rolled loop.
  const bySlug = groupBy(rows, (row) => defById.get(row.definitionId)?.slug);

  const trends: ScoreTrend[] = [];
  for (const slug of DASHBOARD_SLUGS) {
    const points: ScoreTrendPoint[] = (bySlug.get(slug) ?? [])
      .map((row) => ({
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        value: row.value,
        periodGrain: row.periodGrain,
        definitionVersion: defById.get(row.definitionId)!.version,
      }))
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    if (points.length > 0) trends.push({ slug, points });
  }
  return trends;
}
