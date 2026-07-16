import { PageHeader } from "@/components/page-header";
import { SettingsTabRail } from "@/components/settings/settings-tab-rail";
import { requireAppContext } from "@/lib/api-context";
import { settingsTabsFor } from "@/lib/settings-nav";

// Authenticated shell segment: session + Cloudflare env exist only at request
// time (same as every (app) page).
export const dynamic = "force-dynamic";

/**
 * SettingsShell (U3): one control surface wrapping the nested `/settings/*`
 * routes with a role-filtered tab rail. The rail is deliberately gated by role
 * (a member sees only Profile + Notifications), but each admin tab page keeps
 * its own authoritative server-side check — a member deep-linking an admin tab
 * gets an in-place explanation, never a hidden route with no trace.
 */
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await requireAppContext("/settings");
  const tabs = settingsTabsFor(ctx.role);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Manage your profile, workspace, and preferences."
      />
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <SettingsTabRail tabs={tabs} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
