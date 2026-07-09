import { Cable } from "lucide-react";
// Populate the connector registry under plain `next dev` too (the worker
// entrypoint does this in production) — canSync below reads it.
import "@/connectors";
import { getConnector } from "@/connectors/registry";
import { AddConnectionDialog } from "@/components/add-connection-dialog";
import { ConnectionRowActions } from "@/components/connection-row-actions";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SyncAllButton, SyncNowButton } from "@/components/sync-buttons";
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
  // Sync now/all is open to all members too — the poll route isn't
  // admin-only (the connect flow already fires it for any member).
  const isAdmin = ctx.role === "admin";
  // Syncable = a vendor we can actually poll (the local agent pushes, it
  // isn't polled) in a pollable state: pending has no credential yet and
  // a paused connection's run would just skip itself.
  const canSync = (c: (typeof connections)[number]) =>
    !!getConnector(c.vendor) && (c.status === "active" || c.status === "error");
  const syncableIds = connections.filter(canSync).map((c) => c.id);
  // The trailing column exists only when it has something to hold — admins
  // always (manage menu), members only when at least one row is syncable.
  const showActions = isAdmin || syncableIds.length > 0;

  return (
    <>
      <PageHeader
        title="Connections"
        description="Vendor integrations and their sync health."
      >
        {syncableIds.length > 0 && <SyncAllButton connectionIds={syncableIds} />}
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
                {showActions && <TableHead className="w-24" />}
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
                  {showActions && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canSync(connection) && (
                          <SyncNowButton
                            connection={{
                              id: connection.id,
                              displayName: connection.displayName,
                            }}
                          />
                        )}
                        {isAdmin && (
                          <ConnectionRowActions
                            connection={{
                              id: connection.id,
                              vendor: connection.vendor,
                              displayName: connection.displayName,
                              status: connection.status,
                            }}
                          />
                        )}
                      </div>
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
