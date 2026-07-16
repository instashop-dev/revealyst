import { LineChart } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CapabilityHistoryRow } from "@/lib/capability-history";

// Team capability growth-trend card (TCI Phase 2-F, ADR 0050; consumes the
// ADR-0046 history rollup). COUNT-ONLY: how many people have reached a strong
// level in each capability, over the last few months. The rows are already
// MIN_PEOPLE-floored by the caller (a below-floor capability is absent, never a
// suppressed-but-implied number) and carry NO person data. Honest empty state
// when fewer than two periods exist — a trend needs two points to be a trend.

const W = 120;
const H = 28;

type Point = { periodStart: string; mastered: number; total: number };

function CountSparkline({
  points,
  label,
}: {
  points: Point[];
  label: string;
}) {
  // Scale y to the largest cohort (total) seen in this capability's series, so
  // the mastered line is read against the group size, never a fabricated 0..100.
  const max = Math.max(1, ...points.map((p) => p.total));
  const x = (i: number) =>
    points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W;
  const y = (v: number) => H - (Math.min(v, max) / max) * H;
  const first = points[0];
  const last = points[points.length - 1];
  const a11y = `${label}: ${first.mastered} of ${first.total} people at the start, ${last.mastered} of ${last.total} now, across ${points.length} ${points.length === 1 ? "period" : "periods"}.`;

  if (points.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={a11y}>
        <circle cx={x(0)} cy={y(points[0].mastered)} r={2.5} fill="var(--primary)" />
      </svg>
    );
  }
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.mastered)}`)
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={a11y}>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
    </svg>
  );
}

export function CapabilityGrowthCard({
  rows,
  capabilityLabels,
}: {
  /** Org-wide, MIN_PEOPLE-floored history rows, oldest period first. */
  rows: readonly CapabilityHistoryRow[];
  capabilityLabels: ReadonlyMap<string, string>;
}) {
  // Group into a per-capability point series (rows already oldest-first).
  const bySlug = new Map<string, Point[]>();
  for (const r of rows) {
    const list = bySlug.get(r.capabilitySlug) ?? [];
    list.push({
      periodStart: r.periodStart,
      mastered: r.masteredCount,
      total: r.representedCount,
    });
    bySlug.set(r.capabilitySlug, list);
  }
  const distinctPeriods = new Set(rows.map((r) => r.periodStart)).size;
  const series = [...bySlug.entries()]
    .map(([slug, points]) => ({
      slug,
      label: capabilityLabels.get(slug) ?? slug,
      points,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChart className="size-4 text-primary" aria-hidden="true" />
          Capability growth
        </CardTitle>
        <CardDescription>
          How many people have reached a strong level in each area, month over
          month — counts only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {distinctPeriods < 2 || series.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            History starts accruing from this month. Check back next month to see
            how your team&apos;s coverage is trending.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {series.map((s) => {
              const latest = s.points[s.points.length - 1];
              return (
                <li
                  key={s.slug}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="w-28 shrink-0 truncate text-sm">
                    {s.label}
                  </span>
                  <CountSparkline points={s.points} label={s.label} />
                  <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                    {latest.mastered} of {latest.total}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
