import { median } from "./shared-account/heuristics";

/**
 * §15 launch-funnel derivation (W3-P): pure functions from per-org row
 * summaries to funnel statistics. The rows come from existing frozen-schema
 * timestamps (no event table, no schema change); scripts/launch-metrics.ts
 * gathers them and prints the result for the founder.
 *
 * Honesty rules (review invariant b, applied to rates and timestamps):
 * - A rate with an empty denominator is `null` — "no data yet" is never
 *   reported as a measured 0.
 * - Time-to-first-insight uses the FIRST SUCCESSFUL BACKFILL RUN as its
 *   timestamp, not score_results.computed_at: the nightly recompute upsert
 *   rewrites computed_at (org-scope.ts upsertResults), so min(computed_at)
 *   measures the last recompute of the earliest period — days, not minutes —
 *   for any org older than a day. connector_runs rows are append-only per
 *   attempt and never overwritten, so first-success is stable. The first
 *   score computes in the same onboarding flow immediately after data lands,
 *   making this a tight, honest proxy for "signup → first insight".
 */

export type OrgFunnelRow = {
  orgId: string;
  kind: "personal" | "team";
  createdAt: Date;
  /** min(connections.created_at) for the org */
  firstConnectionAt: Date | null;
  /** min(connector_runs.finished_at) where kind='backfill' status='success' —
   *  append-only, so stable; also the time-to-first-insight anchor. */
  firstBackfillSuccessAt: Date | null;
  /** Whether any score_results row exists — activation. (Existence is
   *  stable; the row's computed_at is NOT — see module doc.) */
  hasScore: boolean;
  /** count(share_links) ever created (revoked links still counted as a share) */
  shareLinks: number;
  /** count(org_members) */
  members: number;
  invitesSent: number;
  invitesAccepted: number;
};

export type LaunchFunnel = {
  stages: {
    orgs: number;
    connected: number;
    backfilled: number;
    activated: number;
  };
  /** Signup → first successful backfill sync (proxy for first insight). */
  timeToFirstInsight: {
    samples: number;
    medianMinutes: number | null;
    p90Minutes: number | null;
    /** §15 criterion: share of synced orgs under 10 minutes. */
    under10MinRate: number | null;
  };
  shareCard: {
    activated: number;
    withShareLink: number;
    /** withShareLink / activated */
    rate: number | null;
  };
  personalToTeam: {
    personalOrgs: number;
    teamOrgs: number;
    personalWithInvites: number;
    personalWithAcceptedInvites: number;
    personalMultiMember: number;
  };
};

/** Nearest-rank percentile of an unsorted sample; null on empty input. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

export function deriveLaunchFunnel(rows: OrgFunnelRow[]): LaunchFunnel {
  const activated = rows.filter((r) => r.hasScore);
  const synced = rows.filter((r) => r.firstBackfillSuccessAt !== null);
  const ttfiMinutes = synced.map((r) =>
    minutesBetween(r.createdAt, r.firstBackfillSuccessAt as Date),
  );
  const under10 = ttfiMinutes.filter((m) => m < 10).length;
  const withShareLink = activated.filter((r) => r.shareLinks > 0).length;
  const personal = rows.filter((r) => r.kind === "personal");

  return {
    stages: {
      orgs: rows.length,
      connected: rows.filter((r) => r.firstConnectionAt !== null).length,
      backfilled: synced.length,
      activated: activated.length,
    },
    timeToFirstInsight: {
      samples: ttfiMinutes.length,
      // Averaged-midpoint median (reused from shared-account heuristics),
      // not nearest-rank p50 — nearest-rank is biased low on even n, which
      // would flatter exactly the metric §15 gates on.
      medianMinutes: ttfiMinutes.length ? median(ttfiMinutes) : null,
      p90Minutes: percentile(ttfiMinutes, 90),
      under10MinRate: rate(under10, ttfiMinutes.length),
    },
    shareCard: {
      activated: activated.length,
      withShareLink,
      rate: rate(withShareLink, activated.length),
    },
    personalToTeam: {
      personalOrgs: personal.length,
      teamOrgs: rows.filter((r) => r.kind === "team").length,
      personalWithInvites: personal.filter((r) => r.invitesSent > 0).length,
      personalWithAcceptedInvites: personal.filter(
        (r) => r.invitesAccepted > 0,
      ).length,
      personalMultiMember: personal.filter((r) => r.members >= 2).length,
    },
  };
}
