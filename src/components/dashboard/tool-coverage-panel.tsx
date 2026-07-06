import type { ToolCoverage } from "@/lib/dashboard-read";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { vendorLabel } from "@/lib/vendor-labels";

const STATUS_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  active: "outline",
  pending: "secondary",
  paused: "secondary",
  error: "destructive",
};

/** Strips the `feature=` dim prefix for display (feature=mcp → mcp). */
function featureLabel(dim: string): string {
  return dim.replace(/^feature=/, "").replace(/_/g, " ");
}

/**
 * Tool coverage: which vendors are connected (with sync status) and which of
 * their features the team actually uses. Feature breadth is the same signal the
 * Fluency breadth component reads — surfaced here as the concrete list.
 */
export function ToolCoveragePanel({ coverage }: { coverage: ToolCoverage }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool coverage</CardTitle>
        <CardDescription>Connected AI tools and features in use.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {coverage.connections.length === 0 ? (
          <p className="text-muted-foreground">No tools connected yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {coverage.connections.map((connection) => (
              <li
                key={connection.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  {connection.displayName}
                  <span className="text-muted-foreground">
                    {" "}
                    · {vendorLabel(connection.vendor)}
                  </span>
                </span>
                <Badge
                  variant={STATUS_VARIANT[connection.status] ?? "secondary"}
                  className="capitalize"
                >
                  {connection.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            Features in use ({coverage.features.length})
          </span>
          {coverage.features.length === 0 ? (
            <p className="text-muted-foreground">
              No feature-level activity recorded yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {coverage.features.map((feature) => (
                <Badge key={feature} variant="secondary" className="capitalize">
                  {featureLabel(feature)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
