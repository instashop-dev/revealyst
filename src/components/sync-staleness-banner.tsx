import { Clock } from "lucide-react";
import { Banner } from "@/components/banner";
import { AGENT_SYNC_COMMAND, SYNC_STALE_AFTER_DAYS } from "@/lib/agent-sync";
import { formatRelativeTime } from "@/lib/format";

// Dashboard staleness counterweight for the manual local agent (plan §5, §13
// PR3). Because a definition consuming no rows yields no score row and plain
// metrics floor to 0, an unsynced stretch would silently paint as
// measured-zero — so when the user's Claude Code agent hasn't synced within
// SYNC_STALE_AFTER_DAYS, the dashboard says "data as of your last sync" rather
// than let the numbers imply freshness (invariant b). Copy NEVER implies the
// user stopped using AI — only that we haven't received a recent push.
//
// Derived entirely from the already-fetched connections list (zero new
// queries) — the badge and this banner share the one SYNC_STALE_AFTER_DAYS
// constant so they can't disagree.

// The minimal shape both dashboard views already have per connection.
type SyncConnection = {
  vendor: string;
  lastSuccessAt: Date | string | null;
};

export function SyncStalenessBanner({
  connections,
}: {
  connections: SyncConnection[];
}) {
  const local = connections.filter((c) => c.vendor === "claude_code_local");
  // No local agent paired → nothing to nag about; this banner is agent-only.
  if (local.length === 0) return null;

  // Freshest successful push across any paired local agent (a user may pair
  // more than one machine — only nag when even the most recent is stale).
  const successMs = local
    .map((c) => (c.lastSuccessAt ? new Date(c.lastSuccessAt).getTime() : null))
    .filter((t): t is number => t !== null && !Number.isNaN(t));
  const freshest = successMs.length > 0 ? Math.max(...successMs) : null;

  const staleMs = SYNC_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  // Fresh enough → render nothing (no empty shell). Stale iff elapsed is
  // STRICTLY greater than the threshold — the same predicate direction as
  // SyncStatusBadge, so the two surfaces agree even at the exact boundary.
  if (freshest !== null && Date.now() - freshest <= staleMs) return null;

  const neverSynced = freshest === null;
  return (
    <Banner tone="warning" icon={Clock} title="Data as of your last sync">
      <p>
        {neverSynced ? (
          <>
            Waiting for your first sync. Run{" "}
            <code>{AGENT_SYNC_COMMAND}</code> on your machine to bring in your
            Claude Code usage.
          </>
        ) : (
          <>
            Last synced {formatRelativeTime(new Date(freshest))}. Run{" "}
            <code>{AGENT_SYNC_COMMAND}</code> to refresh — some recent days may
            not be reflected yet.
          </>
        )}
      </p>
    </Banner>
  );
}
