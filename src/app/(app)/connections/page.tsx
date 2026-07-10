import { Cable } from "lucide-react";
// Populate the connector registry under plain `next dev` too (the worker
// entrypoint does this in production) — canSync below reads it.
import "@/connectors";
import { getConnector } from "@/connectors/registry";
import { AddConnectionDialog } from "@/components/add-connection-dialog";
import { ConnectionRowActions } from "@/components/connection-row-actions";
import { EmptyState } from "@/components/empty-state";
import { GithubAppConnectCard } from "@/components/github-app-connect-card";
import { PageHeader } from "@/components/page-header";
import { SyncAllButton, SyncNowButton } from "@/components/sync-buttons";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAppContext } from "@/lib/api-context";
import {
  type CopilotAppEnv,
  readCopilotAppConfig,
} from "@/lib/github-app-config";
import { GITHUB_APP_VENDORS } from "@/lib/vendor-connect-meta";
import { vendorLabel } from "@/lib/vendor-labels";

export const dynamic = "force-dynamic";

/** Honest feedback for the GitHub App connect redirect — the setup/callback
 * routes bounce back here with a reason, so the "Connect via GitHub App"
 * button is never a silent dead-end (including the current founder-gated
 * "not configured" state before the App secrets are synced). */
function copilotConnectBanner(
  params: Record<string, string | string[] | undefined>,
): { variant: "default" | "destructive"; message: string } | null {
  if (params.connected === "github_copilot") {
    return {
      variant: "default",
      message: params.reused
        ? "GitHub Copilot is already connected for that installation."
        : "GitHub Copilot connected. First metrics will land on the next sync.",
    };
  }
  if (params.copilot_pending) {
    return {
      variant: "default",
      message:
        "Almost there — a GitHub organization owner still needs to approve the Revealyst app installation.",
    };
  }
  const error = typeof params.copilot_error === "string" ? params.copilot_error : null;
  if (!error) return null;
  const messages: Record<string, string> = {
    not_configured:
      "GitHub Copilot isn't available on this deployment yet — the GitHub App credentials are still being set up.",
    state: "That Copilot connect request expired or didn't match. Please start again.",
    install_lookup: "We couldn't read your GitHub installation. Please try connecting again.",
    create_failed: "Something went wrong finishing the connection. Please try again.",
  };
  return { variant: "destructive", message: messages[error] ?? "Couldn't connect GitHub Copilot. Please try again." };
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAppContext();
  const connections = await ctx.scope.connections.list();
  const banner = copilotConnectBanner(await searchParams);
  // Render-time env gate (ADR 0022): the Copilot connect card only offers the
  // GitHub App install when the App secrets are configured on this deployment
  // — same check the setup route enforces, so the card can never be a button
  // that dead-ends. Flips automatically when the secrets sync.
  const copilotAvailable =
    readCopilotAppConfig(ctx.env as unknown as CopilotAppEnv) !== null;
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
      {banner && (
        <Alert variant={banner.variant} className="mb-4">
          <AlertTitle>{banner.message}</AlertTitle>
        </Alert>
      )}
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

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {GITHUB_APP_VENDORS.map((v) => (
          <GithubAppConnectCard
            key={v.vendor}
            vendor={v}
            connected={connections.some((c) => c.vendor === v.vendor)}
            available={copilotAvailable}
          />
        ))}
      </section>
    </>
  );
}
