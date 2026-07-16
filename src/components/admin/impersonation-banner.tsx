"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/banner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

/**
 * Persistent bar shown for the duration of an admin impersonation session
 * (ADR 0016, PR5/Feature 6). Impersonated writes are live — no read-only
 * mode in MVP — so this must stay visible on every authenticated page,
 * including the paywall branch of `(app)/layout.tsx`.
 */
export function ImpersonationBanner({
  name,
  impersonatedUserId,
}: {
  name: string;
  impersonatedUserId: string;
}) {
  const [busy, setBusy] = useState(false);

  async function endImpersonation() {
    setBusy(true);
    const { error } = await authClient.admin.stopImpersonating();
    if (error) {
      setBusy(false);
      toast.error(error.message ?? "Could not end impersonation");
      return;
    }
    // Full navigation, not router.push: the session cookie flips back to
    // the admin's own session and every cached app-shell context (org,
    // role, isPlatformAdmin) must be re-derived from scratch.
    window.location.assign(`/admin/users/${impersonatedUserId}`);
  }

  return (
    <Banner
      tone="critical"
      persistent
      title={<>Viewing as {name} — actions are real</>}
      action={
        <Button
          size="xs"
          variant="destructive"
          onClick={endImpersonation}
          disabled={busy}
        >
          {busy && <Spinner />}
          End impersonation
        </Button>
      }
    />
  );
}
