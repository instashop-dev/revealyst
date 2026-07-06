import type { ScoreTrend } from "@/lib/dashboard-trends";
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

function Sparkline({ points }: { points: { value: number }[] }) {
  // Values are 0..100; map to the drawing box (y inverted).
  const x = (i: number) =>
    points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W;
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

  if (points.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <circle cx={x(0)} cy={y(points[0].value)} r={2.5} fill="var(--primary)" />
      </svg>
    );
  }
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
    </svg>
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
            return (
              <div
                key={trend.slug}
                className="flex items-center justify-between gap-3"
              >
                <span className="w-20 shrink-0 text-sm">
                  {SLUG_LABELS[trend.slug] ?? trend.slug}
                </span>
                <Sparkline points={trend.points} />
                <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums">
                  {Math.round(latest.value)}
                </span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
