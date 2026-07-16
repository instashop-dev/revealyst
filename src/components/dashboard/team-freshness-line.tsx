import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

/**
 * Data-freshness indicator (P2c / TCI-FE-002) for the team overview header. A
 * small "Data as of …" line so a manager reads how current the whole surface is
 * without scrolling to the maturity banner. The signal is REUSED verbatim from
 * `maturity.dataAsOf` (the freshest successful sync across connections, already
 * fetched in the team page's single flat Promise.all) — no new query, no new
 * freshness source that could drift from the banner's. Honest by construction:
 * renders nothing when nothing has synced yet (the empty states own that
 * message), and appends a terse note when the freshest sync predates the current
 * period (the maturity banner carries the full stale explanation). Server-safe —
 * pure props, no person data.
 */
export function TeamFreshnessLine({
  dataAsOf,
  stale,
}: {
  /** Freshest successful sync, ISO string, or null when nothing has synced. */
  dataAsOf: string | null;
  /** Freshest sync predates the whole window (maturity `stale`). */
  stale: boolean;
}) {
  if (!dataAsOf) return null;
  const formatted = new Date(dataAsOf).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {TEAM_OVERVIEW_COPY.freshness.asOf(formatted)}
      {stale ? ` · ${TEAM_OVERVIEW_COPY.freshness.staleSuffix}` : ""}
    </p>
  );
}
