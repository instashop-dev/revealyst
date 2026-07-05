import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";

type SyncStatus = "pending" | "active" | "paused" | "error";

/**
 * Honest sync state for a connection, straight from the frozen
 * connectionSchema fields: never claims freshness it can't prove —
 * "pending" until a first successful sync exists, the real error text
 * on failure.
 */
export function SyncStatusBadge({
  status,
  lastSuccessAt,
  lastError,
}: {
  status: SyncStatus;
  lastSuccessAt: Date | string | null;
  lastError?: string | null;
}) {
  if (status === "error") {
    return (
      <Badge variant="destructive" title={lastError ?? undefined}>
        Sync error
      </Badge>
    );
  }
  if (status === "paused") {
    return <Badge variant="outline">Paused</Badge>;
  }
  if (status === "pending" || !lastSuccessAt) {
    return <Badge variant="outline">Waiting for first sync</Badge>;
  }
  return (
    <Badge variant="secondary">
      Synced {formatRelativeTime(lastSuccessAt)}
    </Badge>
  );
}
