import { OnboardingCompanionPitch } from "@/components/onboarding-companion-pitch";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { requireAppContext } from "@/lib/api-context";
import {
  type CopilotAppEnv,
  readCopilotAppConfig,
} from "@/lib/github-app-config";

// Standalone authed route (root layout, no sidebar) — a focused connect flow.
// New personal orgs land here from the dashboard until they connect a source.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await requireAppContext("/onboarding");
  const connections = await ctx.scope.connections.list();

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-10 p-6 py-12">
      {/* Onboarding inversion (errata §1.2(2)): the companion pitch leads, the
       * connect cards follow — "meet your companion" before "connect your
       * tools". */}
      <OnboardingCompanionPitch />
      <OnboardingWizard
        initialConnections={connections.map((c) => ({
          id: c.id,
          vendor: c.vendor,
          status: c.status,
        }))}
        // Render-time env gate (ADR 0022): Copilot's GitHub App connect is
        // offered only when the App secrets exist on this deployment.
        copilotAvailable={
          readCopilotAppConfig(ctx.env as unknown as CopilotAppEnv) !== null
        }
      />
    </main>
  );
}
