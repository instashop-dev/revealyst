import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import {
  HONESTY_GAP_GLOSSARY,
  type HonestyGapKind,
} from "@/lib/metrics-glossary";

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
  gapKinds,
  legacy,
}: {
  status: SyncStatus;
  lastSuccessAt: Date | string | null;
  lastError?: string | null;
  /** A retired polled connector (ADR 0056): polling was removed, so this
   * source's rows are frozen history and there is no place to reconnect it.
   * When set, the badge says "No longer syncing" plainly instead of a green
   * "Synced …" (which would imply it's still current) or an "error"/"paused"
   * badge (which would imply a transient, fixable state) — invariant b. Takes
   * precedence over every status-based rendering below. */
  legacy?: boolean;
  /** Opt-in staleness flag: when set and the last successful sync is older
   * than this many days, an active connection paints an amber "may be
   * incomplete" badge instead of the plain "Synced" one. Supplied ONLY for
   * `claude_code_local` rows (manual sync can silently go stale); polled
   * connectors pass nothing and are byte-identical to before. */
  staleAfterDays?: number;
  /** Honesty-gap kinds from the latest run's `connector_runs.gaps`. When a
   * successfully-synced connection carries known gaps, the badge says so —
   * "Working — can't see everything" — instead of a plain green "Synced"
   * that would imply complete coverage it doesn't have (invariant b). The
   * specific gaps are explained via HONESTY_GAP_GLOSSARY on hover/focus.
   * Empty/absent → unchanged behavior. */
  gapKinds?: HonestyGapKind[];
}) {
  // A retired connector's frozen status ("active"/"error"/"paused") is
  // misleading now that it never syncs — say what's actually true. Neutral,
  // not alarming: this is a settled state, not a problem to fix.
  if (legacy) {
    const badge = (
      <Badge variant="outline" className="text-muted-foreground">
        No longer syncing
      </Badge>
    );
    return (
      <Tooltip>
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
        <TooltipContent>
          This source stopped updating when Revealyst moved to the desktop
          agent. Its past numbers stay; nothing new comes in.
        </TooltipContent>
      </Tooltip>
    );
  }
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
  // Limited coverage: the connection synced fine, but the latest run reported
  // known honesty gaps (e.g. a vendor that only reports daily grain, or OAuth
  // users missing from a report). Never a plain green "Synced" when we know
  // we can't see everything — text + icon, with the gaps spelled out on
  // hover/focus. Distinct from an error: the sync worked, coverage is partial.
  const gaps = (gapKinds ?? []).filter((k) => k in HONESTY_GAP_GLOSSARY);
  if (gaps.length > 0) {
    const labels = [...new Set(gaps)].map((k) => HONESTY_GAP_GLOSSARY[k]);
    const badge = (
      <Badge
        variant="outline"
        className="border-amber-500/60 text-amber-700 dark:text-amber-400"
      >
        <Info data-icon="inline-start" aria-hidden="true" />
        Working — can&apos;t see everything
      </Badge>
    );
    return (
      <Tooltip>
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
        <TooltipContent>
          <span className="flex flex-col gap-1">
            <span>
              Synced {formatRelativeTime(lastSuccessAt)}. Some data this
              connector can&apos;t reach:
            </span>
            <span className="flex flex-col gap-0.5">
              {labels.map((l) => (
                <span key={l.label}>· {l.shortWhat}</span>
              ))}
            </span>
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Badge variant="secondary">
      Synced {formatRelativeTime(lastSuccessAt)}
    </Badge>
  );
}
