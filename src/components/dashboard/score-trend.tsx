import type { ScoreTrend, ScoreTrendPoint } from "@/lib/dashboard-trends";
import { deriveDelta, formatDelta } from "@/lib/score-insights";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const SLUG_LABELS: Record<string, string> = {
  adoption: "Adoption",
  fluency: "Fluency",
  efficiency: "Efficiency",
};

const W = 140;
const H = 32;

function Sparkline({
  points,
  scoreLabel,
}: {
  points: ScoreTrendPoint[];
  scoreLabel: string;
}) {
  // Values are 0..100; map to the drawing box (y inverted).
  const x = (i: number) =>
    points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W;
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  const first = Math.round(points[0].value);
  const last = Math.round(points[points.length - 1].value);
  const label =
    points.length === 1
      ? `${scoreLabel} trend: 1 scored period, at ${first}`
      : `${scoreLabel} trend: ${points.length} scored periods, from ${first} to ${last}`;

  if (points.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <circle cx={x(0)} cy={y(points[0].value)} r={2.5} fill="var(--primary)" />
      </svg>
    );
  }
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
    </svg>
  );
}

function TrendDelta({ points }: { points: ScoreTrendPoint[] }) {
  const result = deriveDelta(points);
  if (result.kind !== "delta") return null;
  const { direction, srText } = formatDelta(result);
  // No change → nothing to point at here; the sparkline itself already shows
  // a flat line, and rendering "no change" text on a tiny trend row would be
  // more noise than signal.
  if (direction === "none") return null;
  const up = direction === "up";
  const magnitude = Math.abs(Math.round(result.delta));
  return (
    <span
      className={
        "text-xs tabular-nums " +
        (up ? "text-primary" : "text-destructive")
      }
    >
      <span aria-hidden="true">
        {up ? "▲" : "▼"} {magnitude}
      </span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}

/**
 * Score trends: one sparkline per preset over the scored periods. Renders only
 * the periods the recompute actually wrote — a single period shows a point, not
 * an invented line.
 */
export function ScoreTrend({ trends }: { trends: ScoreTrend[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trends</CardTitle>
        <CardDescription>Score movement over time.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {trends.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scored periods yet.
          </p>
        ) : (
          trends.map((trend) => {
            const latest = trend.points[trend.points.length - 1];
            const label = SLUG_LABELS[trend.slug] ?? trend.slug;
            return (
              <div
                key={trend.slug}
                className="flex items-center justify-between gap-3"
              >
                <span className="w-20 shrink-0 text-sm">{label}</span>
                <Sparkline points={trend.points} scoreLabel={label} />
                <span className="flex w-16 shrink-0 items-center justify-end gap-1.5 text-right text-sm font-medium tabular-nums">
                  {Math.round(latest.value)}
                  <TrendDelta points={trend.points} />
                </span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
