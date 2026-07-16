import { Cable, TriangleAlert } from "lucide-react";
// Populate the connector registry under plain `next dev` too (the worker
// entrypoint does this in production) — canSync below reads it.
import "@/connectors";
import { getConnector } from "@/connectors/registry";
import { scopeClaimsFor } from "@/connectors/scope-claims";
import { AddConnectionDialog } from "@/components/add-connection-dialog";
import { ConnectionCard } from "@/components/connection-card";
import { ConnectionRowActions } from "@/components/connection-row-actions";
import { EmptyState } from "@/components/empty-state";
import { GithubAppConnectCard } from "@/components/github-app-connect-card";
import { PageHeader } from "@/components/page-header";
import { SyncAgentCard } from "@/components/sync-agent-card";
import { SyncAllButton, SyncNowButton } from "@/components/sync-buttons";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import {
  SyncTransparencyPanel,
  type LastSyncFacts,
} from "@/components/sync-transparency-panel";
import { SYNC_STALE_AFTER_DAYS } from "@/lib/agent-sync";
import { LOCAL_SECTION, POLLED_SECTION } from "@/lib/connections-copy";
import {
  coverageSummaryLine,
  deriveConnectionIssues,
  latestGapKindsByConnection,
} from "@/lib/connections-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    ownership:
      "We couldn't confirm you're an admin of that GitHub organization. Connect from an account that administers the org where the Revealyst app is installed.",
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
  // Read shape — TWO sequential DB stages (this page is not on the perf-pinned
  // hot path): (1) list the connections, then (2) fetch each connection's TRUE
  // latest run in ONE Promise.all (N indexed single-row lookups, fired
  // concurrently — one round-trip stage). This deliberately replaces the old
  // single capped `connectorRuns.list()` (ORDER BY started_at DESC LIMIT 100
  // org-wide): with several hourly-polled connectors a busy connection's latest
  // run could fall off the top 100, which (a) reverted the local agent's
  // transparency panel to "never synced" and (b) dropped a gapped connection's
  // "limited coverage" badge into a plain "Synced" — both invariant-b overclaims.
  // Per-connection latest runs make that crowd-out structurally impossible.
  const connections = await ctx.scope.connections.list();
  const latestRuns = await Promise.all(
    connections.map((c) => ctx.scope.connectorRuns.latest(c.id)),
  );
  // The local Claude Code agent connection, if paired — it has its own card in
  // the "Local sync" section (never in the polled grid, to avoid showing it
  // twice). Derived from the already-fetched list; no extra query.
  const localAgent = connections.find((c) => c.vendor === "claude_code_local");
  const gapsByConnection = latestGapKindsByConnection(latestRuns);
  const localAgentRun = localAgent
    ? latestRuns.find((r) => r?.connectionId === localAgent.id) ?? null
    : null;
  const lastSyncFacts: LastSyncFacts | null =
    localAgentRun && localAgentRun.status === "success"
      ? {
          records: localAgentRun.recordsUpserted ?? 0,
          signals: localAgentRun.signalsUpserted ?? 0,
          subjects: localAgentRun.subjectsSeen ?? 0,
          windowStart: localAgentRun.windowStart,
          windowEnd: localAgentRun.windowEnd,
          syncedAt: localAgentRun.finishedAt ?? localAgentRun.startedAt,
        }
      : null;
  const banner = copilotConnectBanner(await searchParams);
  // Render-time env gate (ADR 0022): the Copilot connect card only offers the
  // GitHub App install when the App secrets are configured on this deployment.
  const copilotAvailable =
    readCopilotAppConfig(ctx.env as unknown as CopilotAppEnv) !== null;
  // Edit/delete are admin-only (ADR 0013); adding + sync are open to all
  // members (the connect flow already fires a poll for any member).
  const isAdmin = ctx.role === "admin";
  const canSync = (c: (typeof connections)[number]) =>
    !!getConnector(c.vendor) && (c.status === "active" || c.status === "error");
  const syncableIds = connections.filter(canSync).map((c) => c.id);

  // The polled grid: every connection EXCEPT the local agent (its own section).
  const gridConnections = connections.filter(
    (c) => c.vendor !== "claude_code_local",
  );
  const issues = deriveConnectionIssues({ connections });

  return (
    <>
      <PageHeader
        title="Connections"
        description="Your connected tools, what each one can and can't see, and how recently they synced."
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
          title="No tools connected yet"
          description="Connect a tool (Anthropic, OpenAI, or Cursor by API key — or Claude Code's local agent through onboarding) to start collecting your usage data."
        >
          <AddConnectionDialog />
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {coverageSummaryLine(connections)}
          </p>
          {gridConnections.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {gridConnections.map((connection) => {
                const label = vendorLabel(connection.vendor);
                const claims = scopeClaimsFor(connection.vendor);
                return (
                  <ConnectionCard
                    key={connection.id}
                    displayName={connection.displayName}
                    vendorLabel={label}
                    claims={claims ?? { measures: [], cannotMeasure: [] }}
                    statusBadge={
                      <SyncStatusBadge
                        status={connection.status}
                        lastSuccessAt={connection.lastSuccessAt}
                        lastError={connection.lastError}
                        gapKinds={gapsByConnection.get(connection.id)}
                      />
                    }
                    primaryAction={
                      canSync(connection) ? (
                        <SyncNowButton
                          connection={{
                            id: connection.id,
                            displayName: connection.displayName,
                          }}
                        />
                      ) : undefined
                    }
                    secondaryAction={
                      isAdmin ? (
                        <ConnectionRowActions
                          connection={{
                            id: connection.id,
                            vendor: connection.vendor,
                            displayName: connection.displayName,
                            status: connection.status,
                            renewalDate: connection.renewalDate ?? null,
                          }}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
          {!isAdmin && (
            <p className="mt-3 text-sm text-muted-foreground">
              You can refresh a connection with Sync now. To add, reconnect, or
              remove tools, ask a workspace admin.
            </p>
          )}
        </>
      )}

      {/* Two "sync" mental models on one page — separated in copy (Spec §10).
       * Model 1: connectors Revealyst polls for you (the grid above +
       * these connect cards). Model 2: the local CLI you run yourself. */}
      <section className="mt-10 flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-medium">
            {POLLED_SECTION.title}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {POLLED_SECTION.description}
          </p>
        </div>
        {GITHUB_APP_VENDORS.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {GITHUB_APP_VENDORS.map((v) => (
              <GithubAppConnectCard
                key={v.vendor}
                vendor={v}
                connected={connections.some((c) => c.vendor === v.vendor)}
                available={copilotAvailable}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-medium">
            {LOCAL_SECTION.title}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {LOCAL_SECTION.description}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SyncAgentCard
            existingConnectionId={localAgent?.id ?? null}
            paired={Boolean(localAgent && localAgent.status !== "error")}
            lastSuccessAt={localAgent?.lastSuccessAt ?? null}
          />
          <SyncTransparencyPanel lastRun={lastSyncFacts} />
        </div>
      </section>

      {issues.length > 0 && (
        <section className="mt-10">
          <Card className="border-amber-500/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TriangleAlert className="size-4 text-amber-500 dark:text-amber-400" />
                Needs attention
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3 text-sm">
                {issues.map((issue) => (
                  <li
                    key={`${issue.kind}:${issue.connectionId}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="font-medium">{issue.displayName}</span>
                    <span className="text-muted-foreground">
                      {issue.kind === "sync_error"
                        ? `Last sync failed: ${issue.message}`
                        : issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </>
  );
}
