"use client";

import { useState } from "react";
import { UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

/**
 * Starts a Better Auth impersonation session for `userId` (server-side
 * gated + audited — this is just the trigger). On success we do a FULL
 * navigation, not router.push: the new session cookie must take effect,
 * which a client-side transition won't pick up.
 */
export function ImpersonateButton({
  userId,
  disabled,
  disabledReason,
}: {
  userId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function impersonate() {
    setBusy(true);
    const res = await authClient.admin.impersonateUser({ userId });
    if (res.error) {
      setBusy(false);
      toast.error(res.error.message ?? "Could not impersonate this user");
      return;
    }
    window.location.assign("/dashboard");
  }

  const button = (
    <Button
      variant="outline"
      size="sm"
      onClick={impersonate}
      disabled={disabled || busy}
    >
      {busy ? <Spinner data-icon="inline-start" /> : <UserCog data-icon="inline-start" />}
      Impersonate
    </Button>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-block" />}>
          {button}
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
