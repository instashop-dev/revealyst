import type { forOrg } from "../db/org-scope";

type OrgScope = ReturnType<typeof forOrg>;
type SignalRow = Awaited<ReturnType<OrgScope["metrics"]["allSignals"]>>[number];

// Activity heatmap read (W2-L). Aggregates the org's sub-daily signals
// (subject_day_signals: a 24-slot hour histogram per subject/day) into a
// weekday × hour-of-day grid, reading them with one org-wide `allSignals`
// call (ADR 0017's bulk reader) instead of fanning out one query per subject.
// Honesty rule: a subject/day with no intra-day data (sourceGranularity
// 'none' → NULL hours, e.g. Copilot) is OMITTED and counted separately,
// never rendered as a row of zeros.

/** grid[weekday][hour] summed activity; weekday 0 = Monday … 6 = Sunday. */
export type ActivityHeatmap = {
  grid: number[][];
  peakConcurrency: number | null;
  /** Subject-days with intra-day data that fed the grid. */
  daysWithSignals: number;
  /** Subject-days omitted for lack of sub-daily data (surfaced, not zeroed). */
  daysWithoutSubDaily: number;
};

/** Monday-indexed weekday (0=Mon … 6=Sun) for a UTC calendar day. */
function weekdayMondayIndex(day: string): number {
  const utcDay = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0=Sun … 6=Sat
  return (utcDay + 6) % 7;
}

function emptyGrid(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

export async function readActivityHeatmap(
  scope: OrgScope,
  window: { from: string; to: string },
  prefetched?: { signalRows?: SignalRow[] },
): Promise<ActivityHeatmap> {
  const rows =
    prefetched?.signalRows ??
    (await scope.metrics.allSignals({ from: window.from, to: window.to }));

  const grid = emptyGrid();
  let peakConcurrency: number | null = null;
  let daysWithSignals = 0;
  let daysWithoutSubDaily = 0;

  for (const row of rows) {
    if (!row.hours) {
      // sourceGranularity 'none' — no intra-day data. Omit; never fabricate.
      daysWithoutSubDaily += 1;
      continue;
    }
    daysWithSignals += 1;
    const weekday = weekdayMondayIndex(row.day);
    for (let hour = 0; hour < 24; hour++) {
      grid[weekday][hour] += row.hours[hour] ?? 0;
    }
    if (row.peakConcurrency != null) {
      peakConcurrency = Math.max(peakConcurrency ?? 0, row.peakConcurrency);
    }
  }

  return { grid, peakConcurrency, daysWithSignals, daysWithoutSubDaily };
}
