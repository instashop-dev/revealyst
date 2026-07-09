"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText, postJson } from "@/lib/client-fetch";

// Manual sync (per row + header "Sync all") over the frozen connectionsPoll
// route: enqueues an immediate poll so fresh vendor data + recomputed scores
// land without waiting for the next cron tick. Visible to all members — the
// route isn't admin-only, and a duplicate poll is cheap and idempotent by
// design, so the only guard needed is disabling while a request is in
// flight. The server page renders these only for syncable connections (a
// registered connector, not pending/paused).

const QUEUED_COPY = "fresh data lands in a minute or two";

function requestPoll(connectionId: string) {
  return postJson(`/api/connections/${connectionId}/poll`);
}

export function SyncNowButton({
  connection,
}: {
  connection: { id: string; displayName: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function syncNow() {
    setBusy(true);
    try {
      const res = await requestPoll(connection.id);
      if (!res.ok) {
        toast.error(errorText(res.payload, `Sync failed (${res.status})`));
        return;
      }
      toast.success(`${connection.displayName} sync queued — ${QUEUED_COPY}`);
      router.refresh();
    } catch {
      toast.error("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={busy}
      onClick={syncNow}
      aria-label={`Sync ${connection.displayName} now`}
      title="Sync now"
    >
      {busy ? <Spinner /> : <RefreshCw />}
    </Button>
  );
}

/**
 * Fans out one requestPoll per syncable connection client-side — no batch
 * API route exists (adding one would change the frozen route contracts).
 * Each successful poll chains its own org recompute; that duplication is
 * bounded (orgs hold a handful of connections) and idempotent.
 */
export function SyncAllButton({ connectionIds }: { connectionIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function syncAll() {
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        connectionIds.map((id) => requestPoll(id)),
      );
      const failures = results.filter(
        (r) => r.status === "rejected" || !r.value.ok,
      );
      const queued = connectionIds.length - failures.length;
      // Surface the server's actual reason for the first failure — a 402
      // (over the free band) or 400 is not fixed by "try again".
      const firstFailure = failures[0];
      const reason =
        firstFailure?.status === "fulfilled"
          ? errorText(firstFailure.value.payload, "request failed")
          : "network error";
      if (queued === 0) {
        toast.error(`Sync failed — ${reason}`);
      } else if (failures.length > 0) {
        toast.warning(
          `Sync queued for ${queued} of ${connectionIds.length} connections — ${reason}`,
        );
      } else {
        toast.success(
          `Sync queued for ${queued} connection${queued === 1 ? "" : "s"} — ${QUEUED_COPY}`,
        );
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" disabled={busy} onClick={syncAll}>
      {busy ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RefreshCw data-icon="inline-start" />
      )}
      Sync all
    </Button>
  );
}
