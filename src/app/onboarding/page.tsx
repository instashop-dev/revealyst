import { OnboardingFlow } from "@/components/onboarding-flow";
import { invitesForOrg, orgMembersList } from "@/db/invites";
import { requireAppContext } from "@/lib/api-context";
import {
  type CopilotAppEnv,
  readCopilotAppConfig,
} from "@/lib/github-app-config";
import { isUsableConnection } from "@/lib/onboarding-guide";
import {
  deriveInitialStepIndex,
  derivePrivacyResolved,
  type OrgKindFlavor,
} from "@/lib/onboarding-stepper";

// Standalone authed route (root layout, no sidebar) — a focused connect flow.
// New personal orgs land here from the dashboard until they connect a source.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await requireAppContext("/onboarding");
  const connections = await ctx.scope.connections.list();

  const orgKind: OrgKindFlavor =
    ctx.org.kind === "personal" ? "personal" : "team";
  const isAdmin = ctx.role === "admin";
  const hasUsableConnection = connections.some((c) =>
    isUsableConnection({ vendor: c.vendor, status: c.status }),
  );

  // Privacy/people step is "resolved" (skippable at resume) when the org has
  // another member (an accepted invite becomes an org_members row) OR a pending
  // invite is outstanding OR visibility was moved off the default private. A
  // member has nothing to set here, so it is resolved for them. Personal orgs
  // never have the step. These reads are admin+team only (two batched queries
  // on a cold onboarding path, not a hot page) — never for personal/members.
  //
  // Fix 2: `listPending()` alone dropped ACCEPTED invites, bouncing a
  // successful admin back to the privacy step — the member count captures the
  // accepted case that listPending() cannot see.
  let privacyResolved = true;
  if (orgKind === "team" && isAdmin) {
    const [members, pending] = await Promise.all([
      orgMembersList(ctx.db, ctx.org.id),
      invitesForOrg(ctx.db, ctx.org.id).listPending(),
    ]);
    privacyResolved = derivePrivacyResolved({
      otherMemberCount: members.filter((m) => m.userId !== ctx.user.id).length,
      pendingInviteCount: pending.length,
      visibilityChanged: ctx.org.visibilityMode !== "private",
    });
  }

  const initialStepIndex = deriveInitialStepIndex({
    kind: orgKind,
    hasUsableConnection,
    privacyResolved,
  });

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-10 p-6 py-12">
      <OnboardingFlow
        orgKind={orgKind}
        isAdmin={isAdmin}
        visibilityMode={ctx.org.visibilityMode}
        copilotAvailable={
          // Render-time env gate (ADR 0022): Copilot's GitHub App connect is
          // offered only when the App secrets exist on this deployment.
          readCopilotAppConfig(ctx.env as unknown as CopilotAppEnv) !== null
        }
        initialConnections={connections.map((c) => ({
          id: c.id,
          vendor: c.vendor,
          status: c.status,
        }))}
        initialStepIndex={initialStepIndex}
        privacyResolved={privacyResolved}
      />
    </main>
  );
}
