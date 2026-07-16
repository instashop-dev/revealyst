"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MANAGER_INSIGHTS_COPY } from "@/lib/team-insights-glossary";

// Dismiss one aggregate manager insight (TCI Phase 2-F, ADR 0050). The API
// re-checks that the caller may dismiss (org admin OR a team manager — a plain
// member 403s), so this button never encodes the authorization itself. On
// success the server row is `dismissed`, so we refresh the route to re-render
// from the new server truth (the nightly reducer keeps it dismissed — sticky).
// No local optimistic state: the count-only feed is small and a refresh is
// honest about what the server now holds.
export function TeamInsightDismissButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/team-insights/${encodeURIComponent(id)}/dismiss`,
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error("Couldn't dismiss — please try again.");
        return;
      }
      toast.success("Dismissed — you won't see this again.");
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      // U5: reach the ≥44px touch-target floor without ballooning chrome.
      className="min-h-11"
      disabled={busy}
      onClick={dismiss}
    >
      {busy ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}
      {MANAGER_INSIGHTS_COPY.dismiss}
    </Button>
  );
}
