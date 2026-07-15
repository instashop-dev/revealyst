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
import type { CatalogRecommendation } from "./recommendation-catalog";
import {
  connectionAttentionInputs,
  deriveDelta,
  type AttentionItem,
  type ComponentDetailRow,
  type DeltaResult,
  deriveAttention,
} from "./score-insights";
import {
  detectMilestones,
  WEEKLY_CADENCE_MIN_WEEKS,
  type Milestone,
} from "./milestones";
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
  /** 1–3 task-focused items from the gated attention engine (aggregate-only).
   * Coaching recs get a RESERVED slot here (see `MAX_DIGEST_RECOMMENDATIONS` /
   * `RESERVED_COACHING_SLOTS`) so a week full of connection errors can't crowd
   * out every piece of guidance (errata §1.2(7)). */
  recommendations: AttentionItem[];
  /** W5-F Growth-Journey channel: the period's celebratory milestones (§8.4).
   * The digest is now the Growth-Journey delivery vehicle it's specced to be —
   * these render in their own section, visually distinct from the warn strip.
   * Empty when nothing crossed. Personal lane leads with them; team lane keeps
   * them aggregate (new-highs on org/team-level trends only). */
  milestones: Milestone[];
};

const PRESET_SLUGS = new Set<string>(DASHBOARD_SLUGS);
const MAX_DIGEST_RECOMMENDATIONS = 3;
/** At least this many of the digest's recommendation slots are HELD for coaching
 * recs (F1.1 guidance) — the errata §1.2(7) fix. Without a reserved slot the
 * flat `deriveAttention`-output-sliced-to-3 buried coaching (impact 1) under any
 * three higher-impact alerts (a connection error is impact 100), so a week with
 * connection trouble mailed zero guidance. The reserve guarantees ≥1 coaching
 * rec still ships whenever one exists — the W5-F acceptance test. */
const RESERVED_COACHING_SLOTS = 1;

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
  /** W6-C (ADR 0033) — the per-org recommendation catalog, read by the sender
   * (src/poller/digest.ts) in its ONE flat Promise.all and passed here so the
   * gated `deriveAttention` engine selects from catalog DATA, not the retired
   * static map. Empty/undefined → no coaching recs in the digest. */
  recommendations?: readonly CatalogRecommendation[];
  /** Rec ids the recipient has DISMISSED (W5-D, ADR 0028): a dismissed rec
   * never re-mails. The caller passes this ONLY for the personal lane (org of
   * one — these are the single owner's dismissals); undefined/empty leaves the
   * recommendation lane untouched (full backward-compat). */
  dismissedRecIds?: ReadonlySet<string>;
  /** W7-3 (now live): the personal-lane owner's eligibility context, forwarded
   * verbatim to `deriveAttention` so the digest and the dashboard select the
   * SAME recs. Personal lane only (team recs are org aggregates, not one
   * person's); omitted → no gating (backward-compatible). */
  connectedTools?: ReadonlySet<string>;
  masteredCapabilities?: ReadonlySet<string>;
  capabilityPrereqs?: ReadonlyMap<string, readonly string[]>;
  /** COACH-004 rotation signals, forwarded verbatim to `deriveAttention` so the
   * digest ranks recs identically to the dashboard: `fatigueRecIds` = recs the
   * owner already "tried" (mild penalty); `recentlyShownRecIds` = recs shown in
   * the exposure-log lookback (novelty 0). Personal lane only (team recs are org
   * aggregates, not one person's); omitted → every rec treated as fresh. */
  fatigueRecIds?: ReadonlySet<string>;
  recentlyShownRecIds?: ReadonlySet<string>;
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

  const dismissed = input.dismissedRecIds;
  const attention = deriveAttention({
    connections: connectionAttentionInputs(
      input.connections.map((c) => ({ vendor: c.vendor, status: c.status, id: "" })),
    ),
    gaps: [],
    sharedAccountCount: 0,
    scoreDrops,
    scoreComponents: input.scoreComponents,
    recommendations: input.recommendations,
    // W7-3 (now live): forward the personal-lane eligibility context so the
    // digest selects the SAME recs as the dashboard. Omitted → no gating.
    ...(input.connectedTools ? { connectedTools: input.connectedTools } : {}),
    ...(input.masteredCapabilities && input.capabilityPrereqs
      ? {
          masteredCapabilities: input.masteredCapabilities,
          capabilityPrereqs: input.capabilityPrereqs,
        }
      : {}),
    // COACH-004: forward the personal-lane rotation signals so the digest ranks
    // recs identically to the dashboard. Omitted → every rec fresh.
    ...(input.fatigueRecIds ? { fatigueRecIds: input.fatigueRecIds } : {}),
    ...(input.recentlyShownRecIds
      ? { recentlyShownRecIds: input.recentlyShownRecIds }
      : {}),
  })
    // W5-D: a dismissed coaching rec never re-mails. Filtered by the stable
    // rec id BEFORE the cap, so a dismissed rec can't occupy one of the 1–3
    // slots. Only recommendation items carry a recId; every other attention
    // item passes through untouched.
    .filter(
      (item) =>
        !(
          item.kind === "recommendation" &&
          item.recId !== undefined &&
          dismissed !== undefined &&
          dismissed.has(item.recId)
        ),
    );
  const recommendations = withReservedCoaching(attention);

  const personalBest =
    lane === "personal" ? (scores.find((s) => s.isNewBest) ?? null) : null;

  // W5-F Growth-Journey milestones. `new-best` rides the SAME strict `isNewBest`
  // the digest already computes per score line (`>`, prior points only), so a
  // flat/tied trend never celebrates. The weekly-consistency narrative fires
  // only on a genuinely sustained rhythm (activity in BOTH the current and prior
  // movement windows) and carries no counter — the no-streak decision (§8.4).
  const newBests = scores
    .filter((s) => s.isNewBest && s.currentValue !== null)
    .map((s) => ({ label: s.label, value: Math.round(s.currentValue!) }));
  const milestones = detectMilestones({
    newBests,
    activeWeeks: hasSustainedRhythm(input.movement)
      ? WEEKLY_CADENCE_MIN_WEEKS
      : null,
  });

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
    milestones,
  };
}

/**
 * Fill the digest's `MAX_DIGEST_RECOMMENDATIONS` slots while GUARANTEEING that
 * up to `RESERVED_COACHING_SLOTS` of them go to coaching recs whenever coaching
 * exists (errata §1.2(7)). `deriveAttention` returns action items first
 * (connection error impact 100), then info, then coaching (impact 1) LAST — a
 * naïve `.slice(0, 3)` therefore dropped all coaching on any week with ≥3
 * higher-impact alerts. Here: reserve coaching first, fill the rest by the
 * engine's own priority order, then render action-first with the reserved
 * coaching after — never exceeding the cap.
 */
function withReservedCoaching(items: AttentionItem[]): AttentionItem[] {
  const coaching = items.filter((i) => i.kind === "recommendation");
  const other = items.filter((i) => i.kind !== "recommendation");
  const reserved = coaching.slice(0, RESERVED_COACHING_SLOTS);
  const remaining = MAX_DIGEST_RECOMMENDATIONS - reserved.length;
  const chosenOther = other.slice(0, remaining);
  // Backfill any slots the non-coaching items didn't use with more coaching.
  const leftover = Math.max(0, remaining - chosenOther.length);
  const extraCoaching = coaching.slice(
    RESERVED_COACHING_SLOTS,
    RESERVED_COACHING_SLOTS + leftover,
  );
  // Action/early-warning first (unchanged priority), then the reserved guidance.
  return [...chosenOther, ...reserved, ...extraCoaching];
}

/** Sustained weekly rhythm (the weekly-cadence gate): active days present in the
 * current window AND a comparable prior window that also had activity. "With
 * forgiveness" — it never demands an unbroken run, only a rhythm that spans more
 * than one window. Grounded in the movement deltas already computed; no counter
 * is ever surfaced (no-streak decision, §8.4). */
function hasSustainedRhythm(movement: RecentMovement): boolean {
  const activeDays = movement.metrics.find((m) => m.key === "active_days");
  if (!activeDays || activeDays.current <= 0) return false;
  return activeDays.delta.kind === "delta" && activeDays.delta.previous > 0;
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
