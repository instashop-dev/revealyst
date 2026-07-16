"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { TEAM_COST_VISIBILITY_SETTINGS_COPY } from "@/lib/manager-capability-copy";

/**
 * Per-team "managers can see individual costs" toggle (ADR 0045 spend half,
 * D-TCI-2). PATCHes /api/teams/:id/settings with `{ managersSeeIndividualCost }`
 * immediately on change (optimistic, reverts on failure) — mirroring the
 * team-manager control's no-separate-save pattern. Admin-only at the route; the
 * Settings page only renders this for admins. Default OFF.
 */
export function TeamCostVisibilityControl({
  teamId,
  teamName,
  initialEnabled,
}: {
  teamId: string;
  teamName: string;
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ managersSeeIndividualCost: next }),
        },
      );
      if (!res.ok) {
        setEnabled(previous);
        toast.error(
          res.status === 403
            ? "Only workspace admins can change this"
            : "Could not update cost visibility",
        );
        return;
      }
      toast.success(
        next
          ? "Managers can now see individual costs"
          : "Managers can no longer see individual costs",
      );
      router.refresh();
    } catch {
      setEnabled(previous);
      toast.error("Network error — cost visibility not changed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {busy ? <Spinner /> : null}
      <Checkbox
        checked={enabled}
        disabled={busy}
        onCheckedChange={(value) => toggle(value === true)}
        aria-label={TEAM_COST_VISIBILITY_SETTINGS_COPY.toggleLabel(teamName)}
      />
    </span>
  );
}
