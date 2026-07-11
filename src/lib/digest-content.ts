import { DASHBOARD_SLUGS } from "./dashboard-read";
import {
  DIGEST_COPY,
  DIGEST_PREHEADER,
  DIGEST_SUBJECT,
  digestDate,
} from "./digest-copy";
import type { ScoreTrend } from "./dashboard-trends";
import { isUsableConnection } from "./onboarding-guide";
import type { ScoreSlug } from "./metrics-glossary";
import type { RecentMovement } from "./recent-movement";
import {
  connectionAttentionInputs,
  deriveDelta,
  type AttentionItem,
  type ComponentDetailRow,
  type DeltaResult,
  deriveAttention,
} from "./score-insights";
import { vendorLabel } from "./vendor-labels";

// PURE weekly-digest assembly (F2.2). Zero I/O — the sender (src/poller/digest.ts)
// reads via forOrg in ONE flat Promise.all (G10) and hands the rows here. Two
// lanes: `personal` (own trends + personal best) and `team` (AGGREGATE-ONLY —
// no named individuals; the same org/team-level aggregates the team dashboard
// shows). Neither lane ever contains a person name, pseudonym, or per-person
// value: movement is org-level counts, score lines are org/team-level trend
// values, and recommendations reuse the gated `deriveAttention` engine (generic
// task guidance + connection/gap alerts, never person-scoped).

export type DigestLane = "personal" | "team";

/** Staleness gate (G5): if no usable connection has synced within this many
 * days, the whole send is suppressed; a channel stale past it is annotated.
 * Freshness comes from `connections.last_success_at` ONLY — never score
 * `computed_at` (rewritten nightly) and never metric-row absence. */
export const DIGEST_STALE_AFTER_DAYS = 7;

/** Days of history the digest reads — wide enough for the 2×28d recent-movement
 * comparison AND a multi-week score trend / personal-best lookback. */
export const DIGEST_WINDOW_DAYS = 180;

/** Minimal connection shape the digest needs (a subset of connections.list()). */
export type DigestConnection = {
  vendor: string;
  status: "pending" | "active" | "paused" | "error";
  lastSuccessAt: Date | string | null;
};

export type DigestScoreLine = {
  slug: string;
  label: string;
  currentValue: number | null;
  delta: DeltaResult;
  /** Highest recorded value across the stored trend (personal best). */
  best: number | null;
  /** Current value equals the recorded best AND there's more than one point. */
  isNewBest: boolean;
};

export type DigestContent = {
  lane: DigestLane;
  /** True → the sender must NOT send (logs a skip). Set when no usable
   * connection has synced within DIGEST_STALE_AFTER_DAYS. */
  suppressed: boolean;
  suppressReason?: string;
  subject: string;
  preheader: string;
  intro: string;
  /** Freshest successful sync date (YYYY-MM-DD) across usable connections, or
   * null when nothing has synced. Always rendered as the "data as of" line. */
  dataAsOfDate: string | null;
  /** Per-channel "hasn't synced since …" notes (G5) — grounded in
   * last_success_at, empty when everything is fresh. */
  staleAnnotations: string[];
  movement: RecentMovement;
  scores: DigestScoreLine[];
  /** Personal lane only: the score that just hit a new personal best, if any. */
  personalBest: DigestScoreLine | null;
  /** 1–3 task-focused items from the gated attention engine (aggregate-only). */
  recommendations: AttentionItem[];
};

const PRESET_SLUGS = new Set<string>(DASHBOARD_SLUGS);
const MAX_DIGEST_RECOMMENDATIONS = 3;

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function slugLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Freshness (G5): the freshest successful sync across USABLE connections
 * (errored/paused don't count), whether that is stale past the threshold, and a
 * per-channel annotation for every usable connection that is stale or has never
 * synced. Pure — `now` is injected so tests are deterministic.
 */
export function digestFreshness(
  connections: readonly DigestConnection[],
  now: Date,
): { freshest: Date | null; suppressed: boolean; annotations: string[] } {
  const usable = connections.filter((c) => isUsableConnection(c));
  const cutoff = now.getTime() - DIGEST_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  let freshest: Date | null = null;
  const annotations: string[] = [];
  for (const c of usable) {
    const synced = toDate(c.lastSuccessAt);
    const tool = vendorLabel(c.vendor);
    if (!synced) {
      annotations.push(DIGEST_COPY.channelNeverSynced(tool));
      continue;
    }
    if (!freshest || synced > freshest) freshest = synced;
    if (synced.getTime() < cutoff) {
      annotations.push(
        DIGEST_COPY.channelStale(tool, digestDate(synced)),
      );
    }
  }
  const suppressed = freshest === null || freshest.getTime() < cutoff;
  return { freshest, suppressed, annotations };
}

function scoreLine(trend: ScoreTrend): DigestScoreLine {
  const points = trend.points;
  const current = points.length > 0 ? points[points.length - 1].value : null;
  const best = points.length > 0
    ? points.reduce((m, p) => (p.value > m ? p.value : m), points[0].value)
    : null;
  // "New best" is STRICT: the current point must exceed the max of the PRIOR
  // points only. Comparing against a max that includes the current point
  // (`current >= best`) would claim "new personal best" every single week on
  // a flat trend — a fabricated repeated achievement (invariant b). A tie
  // with the prior max is not a NEW best either, so `>`, never `>=`.
  const priorBest =
    points.length > 1
      ? points
          .slice(0, -1)
          .reduce((m, p) => (p.value > m ? p.value : m), points[0].value)
      : null;
  const isNewBest =
    current !== null && priorBest !== null && current > priorBest;
  return {
    slug: trend.slug,
    label: slugLabel(trend.slug),
    currentValue: current,
    delta: deriveDelta(points),
    best,
    isNewBest,
  };
}

/**
 * Assemble the honest, lane-aware digest content from already-fetched rows.
 * Pure. The caller decides the lane from org member count (single-member =
 * personal, multi-member = team) and passes aggregate inputs only — this
 * function never receives a person identifier.
 */
export function assembleDigest(input: {
  lane: DigestLane;
  now: Date;
  connections: readonly DigestConnection[];
  movement: RecentMovement;
  trends: readonly ScoreTrend[];
  /** Per-preset-slug component rows (from `formatComponentDetail`) for the
   * gated coaching recommendations — measured-and-weak gating lives inside
   * `deriveAttention`. */
  scoreComponents: { slug: ScoreSlug; components: ComponentDetailRow[] }[];
}): DigestContent {
  const { lane, now } = input;
  const fresh = digestFreshness(input.connections, now);

  const scores = input.trends
    .filter((t) => PRESET_SLUGS.has(t.slug))
    .map(scoreLine);

  // Honest score drops for the attention engine: only genuine same-grain
  // decreases (deriveDelta's `delta` kind), typed to the preset slug union.
  const scoreDrops = scores
    .filter(
      (s): s is DigestScoreLine & { delta: Extract<DeltaResult, { kind: "delta" }> } =>
        s.delta.kind === "delta" && s.delta.delta < 0,
    )
    .map((s) => ({ slug: s.slug as ScoreSlug, delta: s.delta.delta }));

  const recommendations = deriveAttention({
    connections: connectionAttentionInputs(
      input.connections.map((c) => ({ vendor: c.vendor, status: c.status, id: "" })),
    ),
    gaps: [],
    sharedAccountCount: 0,
    scoreDrops,
    scoreComponents: input.scoreComponents,
  }).slice(0, MAX_DIGEST_RECOMMENDATIONS);

  const personalBest =
    lane === "personal" ? (scores.find((s) => s.isNewBest) ?? null) : null;

  return {
    lane,
    suppressed: fresh.suppressed,
    suppressReason: fresh.suppressed
      ? "no usable connection synced within the staleness window"
      : undefined,
    subject: DIGEST_SUBJECT,
    preheader: DIGEST_PREHEADER,
    intro: DIGEST_COPY.intro[lane],
    dataAsOfDate: fresh.freshest ? fresh.freshest.toISOString().slice(0, 10) : null,
    staleAnnotations: fresh.annotations,
    movement: input.movement,
    scores,
    personalBest,
    recommendations,
  };
}

/**
 * ISO-8601 week string (e.g. "2026-W28") for the send-idempotency key. Weeks
 * run Monday–Sunday; the week number is derived from the Thursday of the target
 * week, matching the ISO definition. Pure, UTC.
 */
export function isoWeekString(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Shift to the Thursday of this week (ISO weeks are keyed on Thursday).
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
