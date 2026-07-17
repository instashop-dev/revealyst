import { Download, MonitorSmartphone } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DeviceRow } from "@/components/settings/device-row";
import { SyncAgentCard } from "@/components/sync-agent-card";
import {
  SyncTransparencyPanel,
  type LastSyncFacts,
} from "@/components/sync-transparency-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import { INTERNAL_TEST_BUILD_URL } from "@/lib/desktop-releases";
import { ownDevices, toDeviceView } from "@/lib/desktop-devices";
import { formatRelativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Devices tab (Desktop Agent T2.4, spec §24.2). Everyone tab — a member manages
// THEIR OWN enrolled desktop devices. Self-view: the list is filtered to
// devices this user paired (config.pairedByUserId), so a member never sees
// another member's devices here.
//
// ADR 0054: this is now the single home for usage sources. The
// command-line "Revealyst Agent" pairing + transparency panel moved here from
// the retired /connections page — the desktop agent is the usage-source model,
// so device pairing and local sync live together under Settings → Devices.
export default async function SettingsDevicesPage() {
  const ctx = await requireAppContext("/settings/devices");

  // Existing accessor only (no new read method): list the org's connections,
  // then filter to this user's own desktop devices in memory.
  const connections = await ctx.scope.connections.list();
  const now = new Date();
  const devices = ownDevices(connections, ctx.user.id)
    .map(toDeviceView)
    .map((device) => ({
      device,
      lastHeartbeatLabel: device.lastHeartbeatAt
        ? formatRelativeTime(device.lastHeartbeatAt, now)
        : null,
      enrolledLabel: formatRelativeTime(device.enrolledAt, now),
    }));

  // The command-line Revealyst Agent connection, if paired — a
  // `claude_code_local` connection distinct from the desktop-app devices above.
  // Derived from the already-fetched list; one extra single-row run lookup for
  // its last-sync transparency facts.
  const localAgent = connections.find((c) => c.vendor === "claude_code_local");
  const localAgentRun = localAgent
    ? await ctx.scope.connectorRuns.latest(localAgent.id)
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

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your devices</CardTitle>
          <CardDescription>
            Computers running the Revealyst desktop app, signed in as you.
            Rename one to tell them apart, or remove one you no longer use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <EmptyState
              icon={MonitorSmartphone}
              title="No devices yet"
              description="Install the Revealyst desktop app on your computer and sign in to add it here."
            >
              {/* Relative link: the worker 308s app.revealyst.com/download to
                  the marketing host (/download classifies as marketing). */}
              <Button nativeButton={false} render={<a href="/download" />}>
                <Download aria-hidden />
                Get the desktop app
              </Button>
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              {devices.map(({ device, lastHeartbeatLabel, enrolledLabel }) => (
                <DeviceRow
                  key={device.id}
                  id={device.id}
                  name={device.name}
                  platform={device.platform}
                  agentVersion={device.agentVersion}
                  lastHeartbeatLabel={lastHeartbeatLabel}
                  enrolledLabel={enrolledLabel}
                  revoked={device.revoked}
                />
              ))}
              <a
                href="/download"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Add another computer
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Command-line sync — the Revealyst Agent CLI you run yourself. Moved
          here from the retired /connections page (ADR 0054). It summarizes your
          local Claude Code sessions on your machine and pushes only aggregates
          — never prompt content. */}
      <div>
        <h2 className="mb-1 font-heading text-lg font-medium">
          Command-line sync
        </h2>
        <p className="mb-4 max-w-prose text-sm text-muted-foreground">
          Prefer the command line? The Revealyst Agent runs on your machine and
          pushes usage aggregates with a device token. You run one command
          whenever you want to refresh; nothing runs in the background.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <SyncAgentCard
            existingConnectionId={localAgent?.id ?? null}
            paired={Boolean(localAgent && localAgent.status !== "error")}
            lastSuccessAt={localAgent?.lastSuccessAt ?? null}
          />
          <SyncTransparencyPanel lastRun={lastSyncFacts} />
        </div>
      </div>

      {/* Internal test build — a signed-in-only affordance while the signed,
          notarized installers aren't published yet (D-DA-7). The public
          /download page stays "coming soon"; this is clearly labeled UNSIGNED
          so no one mistakes a test build for the shipped product. */}
      <Card>
        <CardHeader>
          <CardTitle>Internal test build</CardTitle>
          <CardDescription>
            An early, <strong>unsigned</strong> build for testing before the
            signed version ships. Because it isn&apos;t signed yet, your computer
            will warn that it&apos;s from an unidentified developer &mdash; that&apos;s
            expected. On macOS, right-click the app and choose <em>Open</em>; on
            Windows, click <em>More info</em> then <em>Run anyway</em>. Please
            don&apos;t share it outside the team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            nativeButton={false}
            render={
              <a
                href={INTERNAL_TEST_BUILD_URL}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <Download aria-hidden />
            Get the internal test build
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
