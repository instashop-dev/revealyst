import type { DashboardScore } from "@/lib/dashboard-read";
import { AttributionBadge } from "@/components/dashboard/attribution-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Human labels for the preset component keys (breadth/depth/effectiveness etc.). */
const COMPONENT_LABELS: Record<string, string> = {
  active_days: "Active days",
  tool_coverage: "Tool coverage",
  breadth: "Breadth",
  depth: "Depth",
  effectiveness: "Effectiveness",
  output_per_spend: "Output per spend",
  engagement_per_spend: "Engagement per spend",
};

function label(key: string): string {
  return COMPONENT_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * One org-level score card: the 0–100 value, its attribution honesty badge, and
 * a contribution bar per component (the drill-down — for Fluency this is
 * breadth / depth / effectiveness). Components are rendered exactly as stored:
 * an omitted component was NOT measured (no data on a side), never shown as 0.
 */
export function ScoreCard({
  title,
  description,
  score,
  footer,
}: {
  title: string;
  description: string;
  score: DashboardScore | null;
  footer?: React.ReactNode;
}) {
  if (!score) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough data yet — this score appears once connected tools have
            synced enough activity.
          </p>
        </CardContent>
      </Card>
    );
  }

  const components = Object.entries(score.components);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <AttributionBadge attribution={score.attribution} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tabular-nums">
            {Math.round(score.value)}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>
        <ul className="flex flex-col gap-2">
          {components.map(([key, component]) => (
            <li key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span>{label(key)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(component.normalized)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.max(0, Math.min(100, component.normalized))}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        {footer ? (
          <div className="border-t pt-3 text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
