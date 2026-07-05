import Link from "next/link";
import { Cable, Gauge } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import { vendorLabel } from "@/lib/vendor-labels";

export const dynamic = "force-dynamic";

const VISIBILITY_LABELS = {
  private: "Private — team-level, pseudonymized",
  managed: "Managed visibility",
  full: "Full visibility",
} as const;

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const connections = await ctx.scope.connections.list();

  return (
    <>
      <PageHeader
        title="Overview"
        description="Who's using AI, how well, and what it costs — across your tools."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              {ctx.org.kind === "personal"
                ? "Personal workspace — an org of one."
                : "Team workspace."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Organization</span>
              <span className="truncate font-medium">{ctx.org.name}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Your role</span>
              <Badge variant="outline" className="capitalize">
                {ctx.role}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Privacy mode</span>
              <span className="text-right">
                {VISIBILITY_LABELS[ctx.org.visibilityMode]}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>
              Vendor integrations feeding your metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {connections.length === 0 ? (
              <p className="text-muted-foreground">
                No connections yet. Metrics start flowing once the first
                vendor is connected.
              </p>
            ) : (
              connections.slice(0, 4).map((connection) => (
                <div
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
                  <SyncStatusBadge
                    status={connection.status}
                    lastSuccessAt={connection.lastSuccessAt}
                    lastError={connection.lastError}
                  />
                </div>
              ))
            )}
            <div>
              <Button variant="outline" size="sm" render={<Link href="/connections" />}>
                <Cable data-icon="inline-start" />
                {connections.length === 0 ? "View connections" : "Manage connections"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <EmptyState
        icon={Gauge}
        title="No scores yet"
        description="Adoption, Fluency, and Efficiency scores appear after your first connection syncs data. Nothing here is estimated — scores only ever come from real, attributed metrics."
      />
    </>
  );
}
