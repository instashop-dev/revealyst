import type { forOrg } from "../db/org-scope";
import { DASHBOARD_SLUGS } from "./dashboard-read";

type OrgScope = ReturnType<typeof forOrg>;

// Score trends read (W2-L): the team-level score history over the window,
// grouped by definition slug into one series per preset. Read-only over
// score_results — the dashboard renders whatever periods the recompute wrote,
// in chronological order, and never interpolates missing periods.

export type ScoreTrendPoint = {
  periodStart: string;
  periodEnd: string;
  value: number;
};

export type ScoreTrend = {
  slug: string;
  points: ScoreTrendPoint[];
};

export async function readScoreTrends(
  scope: OrgScope,
  window: { from: string; to: string },
): Promise<ScoreTrend[]> {
  const [rows, definitions] = await Promise.all([
    scope.scores.results({
      from: window.from,
      to: window.to,
      subjectLevel: "team",
    }),
    scope.scores.definitions(),
  ]);
  const slugById = new Map(definitions.map((d) => [d.id, d.slug]));

  const bySlug = new Map<string, ScoreTrendPoint[]>();
  for (const row of rows) {
    const slug = slugById.get(row.definitionId);
    if (!slug) continue;
    const points = bySlug.get(slug) ?? [];
    points.push({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      value: row.value,
    });
    bySlug.set(slug, points);
  }

  const trends: ScoreTrend[] = [];
  for (const slug of DASHBOARD_SLUGS) {
    const points = (bySlug.get(slug) ?? []).sort((a, b) =>
      a.periodEnd.localeCompare(b.periodEnd),
    );
    if (points.length > 0) trends.push({ slug, points });
  }
  return trends;
}
