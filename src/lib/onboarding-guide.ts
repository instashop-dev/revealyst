import { vendorLabel } from "./vendor-labels";

// F1.6 Onboarding-to-value bridge (C4). Pure data + pure functions, no React —
// the constants module for the interim state between "connected" and "first
// scores" (the wizard end-state + the dashboard's no-scores-yet branch).
//
// Copy discipline (G7 / invariant b — prose is a claim surface): the timing
// copy below states nothing the recompute paths can't keep. Two channels feed
// scores with DIFFERENT latency, so the copy is channel-aware:
//   • Poll connectors (every vendor except the local Agent) enqueue a same-day
//     recompute when a poll lands, so the only latency is backfill completion
//     ("usually within a day").
//   • The local manual-sync channel (`claude_code_local`) pushes metrics on
//     demand but has NO recompute enqueue yet (F1.6 risk note) — its scores
//     wait for the nightly 02:00 UTC cron. Never promise "today" to a
//     local-only org.
// A mixed org (both) gets the conservative combined message: never imply the
// Agent's scores arrive on the poll channel's faster timeline.

/** The local manual-sync channel connector id (`claude_code_local` in
 * `VENDOR_IDS`, src/contracts/attribution.ts). Its scores wait for the nightly
 * cron until its recompute-enqueue fix ships — see the module header. */
export const LOCAL_CHANNEL_VENDOR = "claude_code_local";

/** Which recompute latency an org's usable connections imply.
 * - `same_day`  — only poll connectors (same-day recompute on poll).
 * - `overnight` — only the local Agent channel (nightly 02:00 UTC cron).
 * - `mixed`     — both; copy stays conservative about the Agent's timing.
 * - `none`      — no usable connection (nothing is ingesting). */
export type ScoreTimingChannel = "same_day" | "overnight" | "mixed" | "none";

/** Minimal connection shape the channel logic needs. A connection counts only
 * when usable (status !== "error") — an errored connection isn't ingesting, so
 * it can't promise scores. Matches both the wizard's `InitialConnection` and
 * the dashboard's `connections.list()` rows. */
export type ConnectionChannelInput = {
  vendor: string;
  status: "pending" | "active" | "paused" | "error";
};

function isUsable(c: ConnectionChannelInput): boolean {
  return c.status !== "error";
}

function isLocalChannel(vendor: string): boolean {
  return vendor === LOCAL_CHANNEL_VENDOR;
}

/** Classify an org's score-timing channel from its connections. Pure. */
export function scoreTimingChannel(
  connections: readonly ConnectionChannelInput[],
): ScoreTimingChannel {
  const usable = connections.filter(isUsable);
  const hasPoll = usable.some((c) => !isLocalChannel(c.vendor));
  const hasLocal = usable.some((c) => isLocalChannel(c.vendor));
  if (hasPoll && hasLocal) return "mixed";
  if (hasPoll) return "same_day";
  if (hasLocal) return "overnight";
  return "none";
}

export type TimingCopy = {
  /** One short line — the wizard subtext + the interim card headline. */
  headline: string;
  /** Fuller explanation for the dashboard interim state. */
  detail: string;
};

/** THE single source of truth for score-timing copy, keyed by channel.
 * Nothing here states a latency the recompute paths can't keep (see header). */
export const SCORE_TIMING_COPY: Record<ScoreTimingChannel, TimingCopy> = {
  same_day: {
    headline: "Your first scores are on the way",
    detail:
      "We're backfilling your history now. Adoption, Fluency, and Efficiency are computed as the backfill lands — usually within a day.",
  },
  overnight: {
    headline: "Your first scores land after tonight's run",
    detail:
      "Your Revealyst Agent data is in. Scores are computed in the nightly run (around 02:00 UTC), so your first scores appear by tomorrow morning.",
  },
  mixed: {
    headline: "Your first scores are on the way",
    detail:
      "We're backfilling now. Scores from your connected tools appear within a day; scores from the Revealyst Agent follow after the nightly run (around 02:00 UTC).",
  },
  none: {
    headline: "Connect a source to see scores",
    detail:
      "Scores appear once a connected source has ingested data. Connect a tool to get started.",
  },
};

/** What we've ingested so far, from data already fetched at the call site — no
 * new reads. All optional; a field is shown only when it's a real, non-zero
 * count (G4: never a teaser number). */
export type IngestionEvidence = {
  /** Identity-resolved people seen active in the window
   * (`DashboardData.activePeople`). */
  activePeople?: number;
  /** Key/account subjects seen but not yet linked to a person
   * (`DashboardData.unresolvedSubjects`). */
  unresolvedSubjects?: number;
  /** Connections that have completed at least one successful sync
   * (`lastSuccessAt` set). */
  connectionsSynced?: number;
};

/** One honest fact chip in the interim summary — a label and a rendered value.
 * Only ever built from a real count. */
export type InterimFact = { key: string; label: string; value: string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Build the ingestion-evidence facts, omitting any zero/absent count. Returns
 * [] when nothing has landed yet — the UI then leans on the backfill copy
 * instead of showing a fabricated "0" (G4). Pure. */
export function ingestionFacts(ev?: IngestionEvidence): InterimFact[] {
  if (!ev) return [];
  const facts: InterimFact[] = [];
  if ((ev.connectionsSynced ?? 0) > 0) {
    facts.push({
      key: "connectionsSynced",
      label: "Tools synced",
      value: plural(ev.connectionsSynced!, "tool", "tools"),
    });
  }
  if ((ev.activePeople ?? 0) > 0) {
    facts.push({
      key: "activePeople",
      label: "People active",
      value: plural(ev.activePeople!, "person", "people"),
    });
  }
  if ((ev.unresolvedSubjects ?? 0) > 0) {
    facts.push({
      key: "unresolvedSubjects",
      label: "Subjects seen (not yet linked)",
      value: plural(ev.unresolvedSubjects!, "subject", "subjects"),
    });
  }
  return facts;
}

/** A short human label for the connected tools, e.g. "Anthropic Console and
 * Revealyst Agent". Deduped and vendor-labeled; usable connections only. */
export function connectedToolsLabel(
  connections: readonly ConnectionChannelInput[],
): string {
  const labels = Array.from(
    new Set(connections.filter(isUsable).map((c) => vendorLabel(c.vendor))),
  );
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/** A first-week checklist step. `adminOnly` steps point at admin-gated surfaces
 * (Reconcile, budget in Settings — see the dashboard's admin gating) and are
 * filtered out for non-admin members so a step never dead-ends. */
export type ChecklistStep = {
  key: string;
  title: string;
  body: string;
  href?: string;
  cta?: string;
  adminOnly?: boolean;
};

/** Static first-week guided sequence (G6 — static content, no engine). Order is
 * the intended path: attribute usage → govern spend → return for scores →
 * understand the method. */
export const FIRST_WEEK_CHECKLIST: readonly ChecklistStep[] = [
  {
    key: "resolveIdentities",
    title: "Resolve identities",
    body: "Link API keys and accounts to the people who own them, so usage is attributed to a person instead of an anonymous subject.",
    href: "/reconcile",
    cta: "Go to Reconcile",
    adminOnly: true,
  },
  {
    key: "setBudget",
    title: "Set a monthly budget",
    body: "Add a spend limit and Revealyst will flag when your AI spend crosses a threshold.",
    href: "/settings",
    cta: "Set a budget",
    adminOnly: true,
  },
  {
    key: "checkBackScores",
    title: "Check back for your first scores",
    body: "Adoption, Fluency, and Efficiency appear once your backfill completes and the next recompute runs.",
  },
  {
    key: "exploreMethodology",
    title: "Explore the methodology",
    body: "See exactly how each score is calculated — every number traces back to real, attributed metrics.",
    href: "/methodology",
    cta: "How scores work",
  },
];

/** The checklist filtered for a viewer: members don't see admin-only steps. */
export function checklistForViewer(isAdmin: boolean): ChecklistStep[] {
  return FIRST_WEEK_CHECKLIST.filter((s) => isAdmin || !s.adminOnly);
}

/** The composed interim summary the dashboard renders when usable connections
 * exist but no scores have been computed yet. Returns `null` when scores
 * already exist (no interim needed) — so a caller can pass it through
 * unconditionally. Pure; derives everything from data already in hand. */
export type OnboardingInterim = {
  channel: ScoreTimingChannel;
  timing: TimingCopy;
  connectedLabel: string;
  facts: InterimFact[];
};

export function buildOnboardingInterim(input: {
  connections: readonly ConnectionChannelInput[];
  scoresExist: boolean;
  ingestionEvidence?: IngestionEvidence;
}): OnboardingInterim | null {
  if (input.scoresExist) return null;
  const channel = scoreTimingChannel(input.connections);
  return {
    channel,
    timing: SCORE_TIMING_COPY[channel],
    connectedLabel: connectedToolsLabel(input.connections),
    facts: ingestionFacts(input.ingestionEvidence),
  };
}
