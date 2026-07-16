import { MonitorSmartphone } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DeviceRow } from "@/components/settings/device-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import { ownDevices, toDeviceView } from "@/lib/desktop-devices";
import { formatRelativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Devices tab (Desktop Agent T2.4, spec §24.2). Everyone tab — a member manages
// THEIR OWN enrolled desktop devices. Self-view: the list is filtered to
// devices this user paired (config.pairedByUserId), so a member never sees
// another member's devices here.
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
            />
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
