import type { ActivityHeatmap } from "@/lib/dashboard-signals";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const HOUR_TICKS = [0, 6, 12, 18];

/** Plain-English summary of the busiest weekday, busiest UTC hour range, and
 * peak concurrency — derived only from cells actually present in the grid
 * (all real data; never a fabricated "no activity" claim when there is no
 * signal at all). */
function summarizeHeatmap(heatmap: ActivityHeatmap): string | null {
  if (heatmap.daysWithSignals === 0) return null;

  const weekdayTotals = heatmap.grid.map((row) =>
    row.reduce((sum, v) => sum + v, 0),
  );
  const hourTotals = Array.from({ length: 24 }, (_, hour) =>
    heatmap.grid.reduce((sum, row) => sum + (row[hour] ?? 0), 0),
  );
  const busiestWeekday = weekdayTotals.indexOf(Math.max(...weekdayTotals));
  const busiestHour = hourTotals.indexOf(Math.max(...hourTotals));
  const hourRange = `${String(busiestHour).padStart(2, "0")}:00–${String(
    (busiestHour + 1) % 24,
  ).padStart(2, "0")}:00 UTC`;

  const parts = [
    `busiest weekday is ${WEEKDAY_NAMES[busiestWeekday]}`,
    `busiest hour range is ${hourRange}`,
  ];
  if (heatmap.peakConcurrency != null) {
    parts.push(`peak concurrency of ${heatmap.peakConcurrency}`);
  }
  return `Activity heatmap: ${parts.join(", ")}.`;
}

/**
 * Weekday × hour-of-day activity heatmap from sub-daily signals. Team-level and
 * aggregate — no per-person exposure. Cells scale with intensity; an empty grid
 * and the "no sub-daily data" note keep the absence honest.
 */
export function ActivityHeatmap({ heatmap }: { heatmap: ActivityHeatmap }) {
  const max = Math.max(0, ...heatmap.grid.flat());
  const summary = summarizeHeatmap(heatmap);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Activity heatmap
          <InfoTip
            label="Activity heatmap"
            short="Team-level activity by weekday and UTC hour — aggregated across everyone, never broken out per person."
            detail="Hours are shown in UTC, not your local timezone."
          />
        </CardTitle>
        <CardDescription>
          When AI activity happens across the team (by weekday and UTC hour).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {heatmap.daysWithSignals === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sub-daily activity data in this period yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            {summary ? <p className="sr-only">{summary}</p> : null}
            <div
              className="flex flex-col gap-1"
              role="img"
              aria-label={summary ?? undefined}
            >
              {heatmap.grid.map((row, weekday) => (
                <div key={weekday} className="flex items-center gap-1">
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">
                    {WEEKDAYS[weekday]}
                  </span>
                  <div className="flex gap-0.5">
                    {row.map((value, hour) => {
                      const intensity = max > 0 ? value / max : 0;
                      return (
                        <div
                          key={hour}
                          className="size-3 rounded-[2px]"
                          style={{
                            backgroundColor:
                              value > 0
                                ? `color-mix(in oklab, var(--primary) ${Math.round(
                                    15 + intensity * 85,
                                  )}%, transparent)`
                                : "var(--muted)",
                          }}
                          title={`${WEEKDAYS[weekday]} ${String(hour).padStart(2, "0")}:00 — ${value}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-1 pl-9">
                <div className="flex gap-0.5">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span
                      key={hour}
                      className="w-3 text-center text-[9px] text-muted-foreground"
                    >
                      {HOUR_TICKS.includes(hour) ? hour : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {heatmap.peakConcurrency != null ? (
            <span>Peak concurrency: {heatmap.peakConcurrency}</span>
          ) : null}
          {heatmap.daysWithoutSubDaily > 0 ? (
            <span>
              {heatmap.daysWithoutSubDaily} subject-day
              {heatmap.daysWithoutSubDaily === 1 ? "" : "s"} without sub-daily
              data (not shown)
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
