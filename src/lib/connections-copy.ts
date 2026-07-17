// Copy for the desktop-agent "what this sync sends" transparency panel, shown
// on Settings → Devices. G7 discipline: user-facing prose lives in one place,
// positive-first, and — critically — NEVER a staleness nag (G5: freshness is a
// badge, not a prompt). Pure and db-free.
//
// The polled-connector + renewal-date copy that used to live here was removed
// with the pivot to the desktop-agent usage-source model (ADR 0056): there is
// no /connections page and no connector connect flow anymore.

/** Copy for the "what this sync sent" transparency panel. */
export const TRANSPARENCY_PANEL = {
  title: "What this sync sends",
  description:
    "The agent reads only these structural fields from your local logs. Two values leave your machine as-is — the model id and token counts; everything else is reduced to counts and day buckets before anything is sent.",
  sentHeading: "Values that leave your machine",
  onDeviceHeading: "Read on your machine only (never transmitted)",
  neverHeading: "Never read at all",
  /** Shown above the last-sync counts when a run exists. */
  lastSyncHeading: "Your last sync",
  /** Honest neutral line when there is no run yet (invariant b). */
  noRunYet:
    "No sync yet — the field list below is exactly what the agent will read when you run it.",
} as const;
