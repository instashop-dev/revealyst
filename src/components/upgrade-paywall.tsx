"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/upgrade-button";
import { authClient } from "@/lib/auth-client";

// Free-band paywall (W3-M PR4). Rendered by the app shell in place of all
// content when an un-entitled workspace exceeds the free tracked-user band.
// Admins can upgrade in place; members are told to ask an admin. A sign-out
// escape hatch keeps a blocked user from being trapped (the sidebar is hidden).

export function UpgradePaywall({
  trackedUsers,
  limit,
  canUpgrade,
  clientConfig,
}: {
  trackedUsers: number;
  limit: number;
  canUpgrade: boolean;
  clientConfig: { clientToken: string; environment: "sandbox" | "production" } | null;
}) {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-6 p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-xl border bg-card p-8 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary font-heading text-lg font-bold text-primary-foreground">
          R
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            You&apos;ve outgrown the free plan
          </h1>
          <p className="text-sm text-muted-foreground">
            This workspace is tracking {trackedUsers} people. The free plan
            covers {limit}. Upgrade to Team to keep analyzing your fleet — you
            only pay for tracked users.
          </p>
        </div>
        {canUpgrade ? (
          clientConfig ? (
            <UpgradeButton
              clientToken={clientConfig.clientToken}
              environment={clientConfig.environment}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Billing isn&apos;t configured for this environment yet.
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask a workspace admin to upgrade to Team.
          </p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
