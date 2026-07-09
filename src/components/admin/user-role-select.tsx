"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { inputClassName } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

type Role = "user" | "admin";

/**
 * Inline platform-role control (better-auth admin plugin — server-side
 * gated + audited, ADR 0016). Fires on change, no separate save step:
 * this is a single, low-risk toggle, unlike ban (which needs a reason).
 */
export function UserRoleSelect({
  userId,
  platformAdmin,
  disabled,
  disabledReason,
}: {
  userId: string;
  platformAdmin: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const role: Role = platformAdmin ? "admin" : "user";

  async function onChange(next: Role) {
    if (next === role) return;
    setBusy(true);
    const res = await authClient.admin.setRole({ userId, role: next });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "Could not change this user's role");
      return;
    }
    toast.success(
      next === "admin"
        ? "Granted platform admin access"
        : "Platform admin access revoked",
    );
    router.refresh();
  }

  const control = (
    <div className="flex items-center gap-2">
      {busy ? <Spinner /> : null}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via htmlFor/id */}
      <select
        id={`role-select-${userId}`}
        aria-label="Platform role"
        className={inputClassName}
        value={role}
        disabled={disabled || busy}
        onChange={(e) => onChange(e.target.value as Role)}
      >
        <option value="user">User</option>
        <option value="admin">Platform admin</option>
      </select>
    </div>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-block" />}>
          {control}
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }

  return control;
}
