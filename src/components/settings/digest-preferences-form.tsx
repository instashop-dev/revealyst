"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

/**
 * Weekly-digest opt-in toggle (F2.2). PATCH /api/settings/digest with
 * `{ enabled }` — a per-user preference within the org. Admin-only at the route;
 * the Settings page only renders this for admins. `initialEnabled` is read
 * server-side from the user's preference row (absent → the lane default the
 * sender uses: on for a personal owner, off for a team admin).
 */
export function DigestPreferencesForm({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const unchanged = enabled === initialEnabled;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/digest", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "Only workspace admins can change the digest"
            : "Could not update the digest preference",
        );
        return;
      }
      toast.success(
        enabled ? "Weekly digest turned on" : "Weekly digest turned off",
      );
      router.refresh();
    } catch {
      toast.error("Network error — digest preference not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex items-start gap-3">
        <Checkbox
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
          className="mt-0.5"
        />
        <span className="text-sm leading-relaxed">
          Email me a weekly digest of my workspace&rsquo;s AI-adoption trends,
          personal bests, and a few task-focused suggestions. Sent Monday
          mornings; suppressed when data is stale.
        </span>
      </label>
      <div>
        <Button type="submit" disabled={busy || unchanged}>
          {busy && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
