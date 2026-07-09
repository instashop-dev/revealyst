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
}: {
  status: SyncStatus;
  lastSuccessAt: Date | string | null;
  lastError?: string | null;
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
  return (
    <Badge variant="secondary">
      Synced {formatRelativeTime(lastSuccessAt)}
    </Badge>
  );
}
