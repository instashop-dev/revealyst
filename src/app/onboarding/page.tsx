import { OnboardingWizard } from "@/components/onboarding-wizard";
import { requireAppContext } from "@/lib/api-context";

// Standalone authed route (root layout, no sidebar) — a focused connect flow.
// New personal orgs land here from the dashboard until they connect a source.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await requireAppContext("/onboarding");
  const connections = await ctx.scope.connections.list();

  return (
    <main className="flex min-h-dvh flex-col justify-center p-6">
      <OnboardingWizard
        initialConnections={connections.map((c) => ({
          id: c.id,
          vendor: c.vendor,
          status: c.status,
        }))}
      />
    </main>
  );
}
