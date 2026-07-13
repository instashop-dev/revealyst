"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

/**
 * Monthly executive-memo opt-in toggle (W6-F). PATCH /api/settings/exec-report
 * with `{ enabled }` — a per-WORKSPACE setting (the memo is an org-level board
 * artifact sent to all admins), not a per-user preference. Admin-only at the
 * route; the Settings page only renders this for admins. `initialEnabled` is
 * read server-side from the org's exec_report_state row (absent → on by
 * default). A "Download this month" link previews the current one-pager.
 */
export function ExecReportPreferencesForm({
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
      const res = await fetch("/api/settings/exec-report", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "Only workspace admins can change the monthly memo"
            : "Could not update the monthly memo setting",
        );
        return;
      }
      toast.success(
        enabled ? "Monthly memo turned on" : "Monthly memo turned off",
      );
      router.refresh();
    } catch {
      toast.error("Network error — monthly memo setting not saved");
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
          Email workspace admins a monthly executive memo — a one-page,
          plain-English summary of AI-adoption maturity, spend, and coverage.
          Aggregate only, with the gaps named rather than estimated.
        </span>
      </label>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={busy || unchanged}>
          {busy && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
        <a
          href="/api/exec-report"
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          Download this month&rsquo;s memo
        </a>
      </div>
    </form>
  );
}
