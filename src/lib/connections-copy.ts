// Single source of truth for the /connections copy that separates the two
// "sync" mental models (Spec §10 / W5-G deliverable 3) and labels the
// transparency panel. G7 discipline: user-facing prose lives in one place,
// positive-first, and — critically — NEVER a staleness nag (G5: freshness
// is a badge, not a prompt). Pure and db-free.

/** One-click connector poll: vendors Revealyst pulls for you on a schedule,
 * plus a manual "Sync now". */
export const POLLED_SECTION = {
  title: "Connectors we poll for you",
  description:
    "API-key and app connectors (Anthropic, OpenAI, Cursor, GitHub Copilot). Revealyst pulls fresh data on a schedule — or hit Sync now for an immediate refresh. Nothing to run on your machine.",
} as const;

/** Run-a-CLI-command: the local agent the user runs themselves. */
export const LOCAL_SECTION = {
  title: "Local sync you run yourself",
  description:
    "The Revealyst Agent summarizes your local Claude Code sessions on your machine and pushes only aggregates — never prompt content. You run one command whenever you want to refresh; nothing runs in the background.",
} as const;

/** Honest label for the renewal-date field (W6-G). Invariant b: the date is
 * user-entered — no vendor reports renewal dates, so the copy states plainly
 * that Revealyst can't verify it and only reminds against what the user typed. */
export const RENEWAL_DATE_HINT =
  "You enter this date yourself — no vendor reports renewal dates, so Revealyst can't verify it. We'll email admins about 30 and 7 days before it.";

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
