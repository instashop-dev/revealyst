import type { VendorId } from "../contracts/attribution";
import { vendorLabel } from "./vendor-labels";

// F1.6 Onboarding-to-value bridge (C4). Pure data + pure functions, no React —
// the constants module for the interim state between "connected" and "first
// scores" (the wizard end-state + the dashboard's no-scores-yet branch).
//
// Copy discipline (G7 / invariant b — prose is a claim surface): the timing
// copy below states nothing the recompute paths can't keep, and never claims
// a data flow that isn't happening ("a connection row exists" ≠ "data is
// flowing"). Two channels feed scores with DIFFERENT latency, so the copy is
// channel-aware AND sync-state-aware:
//   • Poll connectors (every vendor except the local Agent) enqueue a same-day
//     recompute when a connect-flow poll lands, so the only latency is
//     backfill completion — and scores need usage to score, hence the "once we
//     see usage" qualifier (an org with zero vendor usage never resolves the
//     promise otherwise).
//   • The local manual-sync channel (`claude_code_local`) pushes metrics on
//     demand but has NO recompute enqueue yet (F1.6 risk note) — its scores
//     wait for the nightly 02:00 UTC cron. Never promise "today" to a
//     local-only org — and never claim its data "is in" until the agent has
//     actually synced. `markSynced` (src/db/org-scope.ts) sets status
//     "active" + lastSuccessAt together on the first successful push; a
//     token-issued-but-never-run agent connection stays "pending".
//   • `paused` is NOT usable: cron dispatch skips paused connections
//     (src/db/system.ts) and agent ingest 403s them — a paused connection is
//     not ingesting and can't promise scores. A `pending` POLL connection IS
//     usable (the connect flow kicks off its first poll immediately); a
//     `pending` LOCAL connection has never synced → the waiting state.
// A mixed org (both channels) gets the conservative combined message, phrased
// to hold for synced AND not-yet-synced agents — never implying the Agent's
// scores arrive on the poll channel's faster timeline.

/** The local manual-sync channel connector id. `satisfies VendorId` pins it
 * to the frozen vendor union (src/contracts/attribution.ts) at compile time —
 * a typo or contract rename fails typecheck instead of silently misrouting
 * the channel classification. */
export const LOCAL_CHANNEL_VENDOR = "claude_code_local" satisfies VendorId;

/** Which recompute latency an org's usable connections imply.
 * - `same_day`       — only poll connectors (same-day recompute on poll).
 * - `overnight`      — only the local Agent channel, and it HAS synced
 *                      (nightly 02:00 UTC cron).
 * - `awaiting_agent` — only the local Agent channel, and it has NEVER synced
 *                      (paired/token issued, agent not yet run): no data is
 *                      flowing, so no arrival claim — instructions instead.
 * - `mixed`          — poll + local (either sync state); copy stays
 *                      conservative about the Agent's timing.
 * - `none`           — no usable connection (nothing is or will be ingesting). */
export type ScoreTimingChannel =
  | "same_day"
  | "overnight"
  | "awaiting_agent"
  | "mixed"
  | "none";

/** Minimal connection shape the channel logic needs. Matches both the wizard's
 * `InitialConnection` (no lastSuccessAt — status carries the signal) and the
 * dashboard's `connections.list()` rows. */
export type ConnectionChannelInput = {
  vendor: string;
  status: "pending" | "active" | "paused" | "error";
  /** When the connection last completed a successful sync. Optional — the
   * wizard doesn't have it; `status === "active"` is an equivalent
   * "has synced" signal (markSynced writes both in one update). */
  lastSuccessAt?: string | Date | null;
};

/** Usable = could be ingesting. Errored connections aren't ingesting; paused
 * ones are skipped by cron dispatch and 403'd by agent ingest. Exported so
 * call sites gate the interim surface on the same definition the channel
 * classification uses. */
export function isUsableConnection(c: ConnectionChannelInput): boolean {
  return c.status !== "error" && c.status !== "paused";
}

function isLocalChannel(vendor: string): boolean {
  return vendor === LOCAL_CHANNEL_VENDOR;
}

/** Has this local-channel connection completed ≥1 successful sync? Either
 * signal suffices — markSynced sets both in the same update. */
function localHasSynced(c: ConnectionChannelInput): boolean {
  return c.status === "active" || c.lastSuccessAt != null;
}

/** Classify an org's score-timing channel from its connections. Pure. */
export function scoreTimingChannel(
  connections: readonly ConnectionChannelInput[],
): ScoreTimingChannel {
  const usable = connections.filter(isUsableConnection);
  const hasPoll = usable.some((c) => !isLocalChannel(c.vendor));
  const locals = usable.filter((c) => isLocalChannel(c.vendor));
  if (hasPoll && locals.length > 0) return "mixed";
  if (hasPoll) return "same_day";
  if (locals.some(localHasSynced)) return "overnight";
  if (locals.length > 0) return "awaiting_agent";
  return "none";
}

export type TimingCopy = {
  /** One short line — the wizard subtext + the interim card headline. */
  headline: string;
  /** Fuller explanation for the dashboard interim state. */
  detail: string;
  /** Short channel-true suffix for the "Connected: <tools>" line. "Backfill
   * in progress" is only ever claimed when a poll-channel vendor is present —
   * the local Agent is a one-shot client push with no backfill machinery.
   * Empty string = no suffix rendered. */
  connectionNote: string;
};

/** THE single source of truth for score-timing copy, keyed by channel.
 * Nothing here states a latency the recompute paths can't keep, or a data
 * flow that isn't happening (see the module header). */
export const SCORE_TIMING_COPY: Record<ScoreTimingChannel, TimingCopy> = {
  same_day: {
    headline: "Your first scores are on the way",
    detail:
      "We're backfilling your history now. Adoption, Fluency, and Efficiency are computed once we see usage — usually within a day.",
    connectionNote: "backfill in progress",
  },
  overnight: {
    headline: "Your first scores land after tonight's run",
    detail:
      "Your Revealyst Agent data is in. Scores are computed in the nightly run (around 02:00 UTC), so your first scores appear by tomorrow morning.",
    connectionNote: "data arrives when your agent syncs",
  },
  awaiting_agent: {
    headline: "Waiting for your agent's first sync",
    detail:
      "Your agent is paired but hasn't synced yet. Run the agent command on your machine to push your first metrics — once it syncs, scores land after the nightly run (around 02:00 UTC).",
    connectionNote: "waiting for the first sync",
  },
  mixed: {
    headline: "Your first scores are on the way",
    detail:
      "We're backfilling your connected tools now — their scores appear once we see usage, usually within a day. Revealyst Agent scores follow the nightly run (around 02:00 UTC) after your agent syncs.",
    connectionNote: "backfill in progress",
  },
  none: {
    headline: "Connect a source to see scores",
    detail:
      "Scores appear once a connected source has ingested data. Connect a tool to get started.",
    connectionNote: "",
  },
};

/** Distinct usable vendors that have completed ≥1 successful sync — the
 * honest "Tools synced" count. Deduped by vendor (two connections to the same
 * tool are one tool, matching how `connectedToolsLabel` dedupes) and filtered
 * to usable, so an errored or paused row never counts as "synced" evidence. */
export function syncedToolCount(
  connections: readonly ConnectionChannelInput[],
): number {
  return new Set(
    connections
      .filter((c) => isUsableConnection(c) && c.lastSuccessAt != null)
      .map((c) => c.vendor),
  ).size;
}

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
  /** Distinct usable vendors with ≥1 successful sync — use `syncedToolCount`. */
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
    new Set(
      connections.filter(isUsableConnection).map((c) => vendorLabel(c.vendor)),
    ),
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
    body: "Adoption, Fluency, and Efficiency appear once your data has landed and the next recompute runs.",
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
 * already exist (no interim needed) OR when the channel is `none` (nothing is
 * or will be ingesting — the caller's plain empty state is the honest surface
 * there, not a bridge that implies progress). Pure. */
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
  if (channel === "none") return null;
  return {
    channel,
    timing: SCORE_TIMING_COPY[channel],
    connectedLabel: connectedToolsLabel(input.connections),
    facts: ingestionFacts(input.ingestionEvidence),
  };
}
