import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  staleAfterDays,
}: {
  status: SyncStatus;
  lastSuccessAt: Date | string | null;
  lastError?: string | null;
  /** Opt-in staleness flag: when set and the last successful sync is older
   * than this many days, an active connection paints an amber "may be
   * incomplete" badge instead of the plain "Synced" one. Supplied ONLY for
   * `claude_code_local` rows (manual sync can silently go stale); polled
   * connectors pass nothing and are byte-identical to before. */
  staleAfterDays?: number;
}) {
  if (status === "error") {
    const badge = <Badge variant="destructive">Sync error</Badge>;
    if (!lastError) return badge;
    return (
      <Tooltip>
        {/* A bare <span> trigger is keyboard-unreachable — lastError would be
         * inaccessible without a mouse. Base UI's default Tooltip.Trigger
         * renders a <button> and opens on focus as well as hover; render a
         * focusable button here (matching ui/badge.tsx's focus-visible
         * idiom) instead of overriding it with a non-interactive span. */}
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          }
        >
          {badge}
        </TooltipTrigger>
        <TooltipContent>{lastError}</TooltipContent>
      </Tooltip>
    );
  }
  if (status === "paused") {
    return <Badge variant="outline">Paused</Badge>;
  }
  if (status === "pending" || !lastSuccessAt) {
    return <Badge variant="outline">Waiting for first sync</Badge>;
  }
  // Opt-in staleness (claude_code_local only): past the threshold, an active
  // connection's data may miss recent days, so say so rather than imply
  // freshness we can't prove (invariant b). No prop → unchanged behavior.
  if (staleAfterDays !== undefined && status === "active") {
    const lastMs = new Date(lastSuccessAt).getTime();
    const staleMs = staleAfterDays * 24 * 60 * 60 * 1000;
    if (!Number.isNaN(lastMs) && Date.now() - lastMs > staleMs) {
      return (
        <Badge
          variant="outline"
          className="border-amber-500/60 text-amber-700 dark:text-amber-400"
        >
          Synced {formatRelativeTime(lastSuccessAt)} — may be incomplete
        </Badge>
      );
    }
  }
  return (
    <Badge variant="secondary">
      Synced {formatRelativeTime(lastSuccessAt)}
    </Badge>
  );
}
