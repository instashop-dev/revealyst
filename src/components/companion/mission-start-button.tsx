"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MISSION_COPY } from "@/lib/capability-glossary";

// Opt-in "Start" affordance for ONE mission (W7-5). Rendered only on the
// personal self-view, so it is always the signed-in person starting a mission
// for THEMSELVES — the API resolves the tracked person from the session
// regardless. On success the server has a started row, so we refresh to render
// from the new server truth. There is no "complete" action by design:
// completion is a measured capability crossing, not a click.
export function MissionStartButton({ missionSlug }: { missionSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/missions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionSlug }),
      });
      if (!res.ok) {
        toast.error("Couldn't start — please try again.");
        return;
      }
      toast.success(MISSION_COPY.startedToast);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" className="mt-3" onClick={start} disabled={busy}>
      {busy ? <Spinner className="size-4" /> : null}
      {MISSION_COPY.startAction}
    </Button>
  );
}
