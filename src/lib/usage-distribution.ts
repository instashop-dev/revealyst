// Within-org usage distribution (F1.2 / M3) and concentration (M4). Pure
// aggregation over metric_records rows the dashboard view already fetched,
// identity-resolved in JS from `identities.all()` — NEVER from person-level
// score rows (Team orgs don't have them). No React, no I/O.
//
// Aggregate-only by construction (invariant / §7 team-surface rule): every
// output is a count, a band tally, or an org-relative percentile — there are
// NO person ids, pseudonyms, names, or per-named-person values anywhere in
// these types, so nothing here can become a leaderboard and nothing changes
// what `assertTeamOnlyPseudonymized` must inspect.
//
// Honesty rules:
//  - Subjects with no identity link are EXCLUDED from all per-person math
//    (never guessed into a person). A subject linked to several people (a
//    shared account) contributes to each — the same "resolved identities only"
//    posture the tracked_user primitive takes.
//  - Fewer than MIN_PEOPLE_FOR_DISTRIBUTION resolved people → the honest
//    "not enough people to show a distribution" state, never a two-person
//    "distribution".
//  - Concentration thresholds (top 10% / 25%) are UNCALIBRATED and directional
//    — the copy says so; nothing here is billed or ranked by name.

/** A per-person usage row — an anonymous quantity bag, no identity. */
type PersonUsage = { activeDays: number; prompts: number };

/** Below this many resolved people, a distribution/concentration is not shown
 * — too few points for a band tally or a top-decile share to mean anything,
 * and small groups risk de-anonymizing individuals. */
export const MIN_PEOPLE_FOR_DISTRIBUTION = 4;

type MetricRow = { subjectId: string; day: string; value: number };
type IdentityLink = { subjectId: string; personId: string };

/**
 * Resolves per-person usage quantities over ONE period from already-fetched
 * rows. `activeDayRows` are `active_day` metric_records (value 1 per active
 * UTC day); `promptRows` are `prompts` metric_records (interaction counts).
 * Both are assumed pre-filtered to the period. A person's active-day count is
 * the number of DISTINCT days across all subjects linked to them; their prompt
 * count is the summed prompt volume across those subjects. Subjects with no
 * link are dropped. Returns one bag per person that had ANY resolved subject
 * activity in the period.
 */
export function resolvePerPersonUsage(args: {
  activeDayRows: MetricRow[];
  promptRows: MetricRow[];
  identities: IdentityLink[];
}): PersonUsage[] {
  const subjectToPeople = new Map<string, string[]>();
  for (const link of args.identities) {
    const list = subjectToPeople.get(link.subjectId);
    if (list) list.push(link.personId);
    else subjectToPeople.set(link.subjectId, [link.personId]);
  }

  const activeDaysByPerson = new Map<string, Set<string>>();
  for (const row of args.activeDayRows) {
    const people = subjectToPeople.get(row.subjectId);
    if (!people) continue; // unresolved subject — excluded, never guessed
    for (const personId of people) {
      let set = activeDaysByPerson.get(personId);
      if (!set) {
        set = new Set();
        activeDaysByPerson.set(personId, set);
      }
      set.add(row.day);
    }
  }

  const promptsByPerson = new Map<string, number>();
  for (const row of args.promptRows) {
    const people = subjectToPeople.get(row.subjectId);
    if (!people) continue;
    for (const personId of people) {
      promptsByPerson.set(personId, (promptsByPerson.get(personId) ?? 0) + row.value);
    }
  }

  const personIds = new Set<string>([
    ...activeDaysByPerson.keys(),
    ...promptsByPerson.keys(),
  ]);
  const out: PersonUsage[] = [];
  for (const personId of personIds) {
    out.push({
      activeDays: activeDaysByPerson.get(personId)?.size ?? 0,
      prompts: promptsByPerson.get(personId) ?? 0,
    });
  }
  return out;
}

/**
 * Linear-interpolated percentile (0–100) over a numeric sample. Empty sample
 * → 0. Single value → that value. Not a benchmark — a descriptive percentile
 * of the org's OWN sample.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** One engagement band of the active-days distribution — a descriptive
 * bucket of the org's own data (a fraction of the period length), NOT a
 * calibrated cutoff. */
export type DistributionBand = {
  key: "occasional" | "regular" | "frequent" | "near_daily";
  label: string;
  /** Inclusive active-day bounds for this band over the period. */
  lowDays: number;
  highDays: number;
  count: number;
};

export type UsageDistribution =
  | { available: false; resolvedPeople: number; periodDays: number }
  | {
      available: true;
      resolvedPeople: number;
      periodDays: number;
      medianActiveDays: number;
      p90ActiveDays: number;
      maxActiveDays: number;
      bands: DistributionBand[];
    };

const BAND_LABELS: Record<DistributionBand["key"], string> = {
  occasional: "Occasional",
  regular: "Regular",
  frequent: "Frequent",
  near_daily: "Near-daily",
};

/**
 * Distribution of active days per person over a period of `periodDays` days
 * (M3). Bands split the period into quarters by fraction of its length
 * (≤25% / ≤50% / ≤75% / >75% of days), so the buckets are window-length
 * agnostic and describe THIS org's spread, not an outside norm. Only people
 * with ≥1 active day count as resolved. Fewer than
 * {@link MIN_PEOPLE_FOR_DISTRIBUTION} → `available: false` (honest empty
 * state). Median and p90 are of the org's own active-day sample.
 */
export function summarizeUsageDistribution(
  usage: readonly PersonUsage[],
  periodDays: number,
): UsageDistribution {
  const active = usage.map((u) => u.activeDays).filter((d) => d > 0);
  const resolvedPeople = active.length;
  if (resolvedPeople < MIN_PEOPLE_FOR_DISTRIBUTION) {
    return { available: false, resolvedPeople, periodDays };
  }
  const q1 = Math.max(1, Math.floor(periodDays * 0.25));
  const q2 = Math.max(q1, Math.floor(periodDays * 0.5));
  const q3 = Math.max(q2, Math.floor(periodDays * 0.75));
  const edges: Array<{ key: DistributionBand["key"]; low: number; high: number }> = [
    { key: "occasional", low: 1, high: q1 },
    { key: "regular", low: q1 + 1, high: q2 },
    { key: "frequent", low: q2 + 1, high: q3 },
    { key: "near_daily", low: q3 + 1, high: periodDays },
  ];
  const bands: DistributionBand[] = edges.map((e) => ({
    key: e.key,
    label: BAND_LABELS[e.key],
    lowDays: e.low,
    highDays: e.high,
    count: active.filter((d) => d >= e.low && d <= e.high).length,
  }));
  return {
    available: true,
    resolvedPeople,
    periodDays,
    medianActiveDays: percentile(active, 50),
    p90ActiveDays: percentile(active, 90),
    maxActiveDays: Math.max(...active),
    bands,
  };
}

export type UsageConcentration =
  | { available: false; resolvedPeople: number }
  | {
      available: true;
      resolvedPeople: number;
      /** Total prompt volume across resolved people (the denominator). */
      totalPrompts: number;
      /** Share of total prompts generated by the top 10% / 25% of people by
       * prompt volume. Directional — thresholds are uncalibrated. */
      top10SharePct: number;
      top25SharePct: number;
      /** People counts behind each share, so the copy can say "the top N". */
      top10Count: number;
      top25Count: number;
    };

function topShare(sortedDesc: readonly number[], total: number, fraction: number) {
  const count = Math.max(1, Math.ceil(sortedDesc.length * fraction));
  const sum = sortedDesc.slice(0, count).reduce((a, b) => a + b, 0);
  return { count, sharePct: total > 0 ? (sum / total) * 100 : 0 };
}

/**
 * Usage concentration (M4): what share of total prompt volume comes from the
 * heaviest-using slice of people. Computed over prompt volume per person
 * (the volume quantity, not the active-day flag). Fewer than
 * {@link MIN_PEOPLE_FOR_DISTRIBUTION} people with any prompts, or zero total
 * prompts, → `available: false` (ratio honesty — no denominator, no ratio).
 * Directional label required in the UI: the 10%/25% cut points are
 * uncalibrated.
 */
export function summarizeUsageConcentration(
  usage: readonly PersonUsage[],
): UsageConcentration {
  const prompts = usage.map((u) => u.prompts).filter((p) => p > 0);
  const resolvedPeople = prompts.length;
  const total = prompts.reduce((a, b) => a + b, 0);
  if (resolvedPeople < MIN_PEOPLE_FOR_DISTRIBUTION || total <= 0) {
    return { available: false, resolvedPeople };
  }
  const sortedDesc = [...prompts].sort((a, b) => b - a);
  const t10 = topShare(sortedDesc, total, 0.1);
  const t25 = topShare(sortedDesc, total, 0.25);
  return {
    available: true,
    resolvedPeople,
    totalPrompts: total,
    top10SharePct: t10.sharePct,
    top25SharePct: t25.sharePct,
    top10Count: t10.count,
    top25Count: t25.count,
  };
}
