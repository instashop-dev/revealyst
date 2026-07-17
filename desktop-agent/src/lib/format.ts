// Small presentational helpers for the status UI. Pure + unit-tested — the
// screens stay declarative and the relative-time logic is asserted once here.

/**
 * Format a "last sync" epoch-ms into a short, plain-English relative label:
 * "just now", "3 minutes ago", "2 hours ago", "yesterday", "4 days ago", or a
 * locale date for anything older. `null`/`undefined` (never synced) → "—", the
 * same honest placeholder the rest of the status screen uses.
 */
export function formatLastSync(
  ms: number | null | undefined,
  now: number = Date.now(),
): string {
  if (ms === null || ms === undefined) return "—";

  const diffMs = Math.max(0, now - ms);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(ms).toLocaleDateString();
}
