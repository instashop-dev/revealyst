import { Cable } from "lucide-react";
import { AddConnectionDialog } from "@/components/add-connection-dialog";
import { ConnectionRowActions } from "@/components/connection-row-actions";
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
  // Edit/delete are admin-only (ADR 0013); adding is open to all members.
  const isAdmin = ctx.role === "admin";

  return (
    <>
      <PageHeader
        title="Connections"
        description="Vendor integrations and their sync health."
      >
        <AddConnectionDialog />
      </PageHeader>
      {connections.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No connections yet"
          description="Connect a vendor (Anthropic, OpenAI, or Cursor by API key — or the Claude Code local agent via onboarding) to start ingesting usage metrics."
        >
          <AddConnectionDialog />
        </EmptyState>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Sync status</TableHead>
                {isAdmin && <TableHead className="w-10" />}
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
                  {isAdmin && (
                    <TableCell className="text-right">
                      <ConnectionRowActions
                        connection={{
                          id: connection.id,
                          vendor: connection.vendor,
                          displayName: connection.displayName,
                          status: connection.status,
                        }}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
