import { Cable } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAppContext } from "@/lib/api-context";
import { vendorLabel } from "@/lib/vendor-labels";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const ctx = await requireAppContext();
  const connections = await ctx.scope.connections.list();

  return (
    <>
      <PageHeader
        title="Connections"
        description="Vendor integrations and their sync health."
      />
      {connections.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No connections yet"
          description="Connect a vendor (Anthropic, Copilot, Cursor, OpenAI, or the Claude Code local agent) to start ingesting usage metrics. Connecting arrives with the onboarding flow."
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Sync status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell className="font-medium">
                    {connection.displayName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {vendorLabel(connection.vendor)}
                  </TableCell>
                  <TableCell>
                    <SyncStatusBadge
                      status={connection.status}
                      lastSuccessAt={connection.lastSuccessAt}
                      lastError={connection.lastError}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
