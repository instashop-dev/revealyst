import { isoWeekString } from "./digest-content";

/**
 * T1.7 — OQ-001 exit-gate metric: pure trailing-N-week digest→companion
 * return-ratio math, mirroring the pure/shell split in `launch-funnel.ts`
 * (this module is the pure half; `scripts/digest-return-rate.ts` is the
 * founder-run shell that fetches rows from the Workers Analytics Engine SQL
 * API and prints the result — never wired into CI).
 *
 * Inputs are `digest_return` / `companion_revisit` events, both written at
 * the `src/worker.ts` edge seam via `writeLaunchEvent` (see
 * `src/lib/launch-events.ts`). **Verified layout** (read at implementation
 * time, not assumed): `writeLaunchEvent` writes `blobs: [name, dim ?? "",
 * host ?? ""]` — i.e. blob1 = event name, blob2 = dim, blob3 = host — with
 * `indexes: [name]` (index1 = event name) and `doubles: [1]`. `digest_return`
 * carries the digest's send week as its `dim` (blob2, e.g. "2026-W28").
 * **`companion_revisit` carries NO dim at all** (`writeLaunchEvent(...,
 * "companion_revisit", undefined, ...)` in `src/worker.ts`) — so blob2 is
 * always `""` for that event. Grouping straight off blob2 would therefore
 * collapse every `companion_revisit` row into one bucket and make a
 * per-week ratio impossible. The fix lives in the script: it derives `wk`
 * for BOTH event types from the Analytics Engine row's own `timestamp`
 * column (`toStartOfWeek(timestamp, 1)`, Monday-start to match
 * isoWeekString's ISO-8601 weeks), never from blob2 — this module is
 * agnostic to that and just aggregates whatever `wk` string it's given, so
 * it stays honest even if the upstream bucketing strategy changes.
 *
 * Ratio semantics ("digest→companion return ratio", per the Closure
 * Execution Plan T1.7 wording): `companionRevisits / digestReturns` for a
 * given week — how much companion-surface engagement shows up per
 * digest click-through that week. This is a coarse, aggregate index, NOT a
 * per-user funnel: the two event streams carry no identity (by privacy
 * design, see launch-events.ts) and can't be joined, so the ratio can only
 * ever say "in weeks with more digest_return clicks, was there more
 * companion_revisit traffic too" — not "did this specific click return".
 * Callers (the exit-gate script, and whoever reads its output) must not
 * overstate it as more than that.
 *
 * Honesty rule (review invariant b): a week with zero `digest_return` events
 * gets `ratio: null` — never a fabricated `0/0`. A week with `digest_return`
 * events but zero `companion_revisit` events is a real measured zero
 * (`ratio: 0`), which is allowed since the denominator is non-empty.
 */

export interface DigestReturnRateRow {
  /** Event name (blob1). Only "digest_return" and "companion_revisit" are
   * counted; anything else is ignored (forward-compatible with future
   * events sharing the same Analytics Engine dataset). */
  event: string;
  /** ISO-8601 week string, e.g. "2026-W28" — see `isoWeekString` (this
   * module imports it so the format can never drift from the app's own
   * digest-send-week formatter). The caller derives this per-row; see the
   * module doc comment above for why it must NOT simply be blob2 for
   * `companion_revisit` rows. */
  wk: string;
  /** Event count for this (event, wk) pair. The caller is responsible for
   * correcting for Analytics Engine sampling (`SUM(_sample_interval)`)
   * before calling in — this module treats `count` as already
   * sample-corrected and simply sums it if the same (event, wk) pair
   * appears more than once (e.g. if the caller grouped by an extra column
   * such as host). */
  count: number;
}

export interface WeekReturnRate {
  wk: string;
  digestReturns: number;
  companionRevisits: number;
  /** companionRevisits / digestReturns for this week, or `null` when this
   * week had zero `digest_return` events (honest-null, never 0/0). */
  ratio: number | null;
}

export interface DigestReturnRateOverall {
  digestReturns: number;
  companionRevisits: number;
  /** Sum(companionRevisits) / Sum(digestReturns) across the whole trailing
   * window, or `null` when the window had zero `digest_return` events. */
  ratio: number | null;
}

export interface DigestReturnRateResult {
  /** One entry per week in the trailing window, oldest first, zero-filled
   * for weeks with no matching rows at all (both counts 0, ratio null). */
  weeks: WeekReturnRate[];
  overall: DigestReturnRateOverall;
}

export interface DigestReturnRateOptions {
  /** Trailing window size in ISO weeks, inclusive of the week containing
   * `now`. Must be a positive integer. */
  weeks: number;
  /** Clock-injection (house style — never `Date.now()`/`new Date()` inline):
   * the instant anchoring the trailing window. The window is the `weeks`
   * ISO weeks ending in the week containing `now`. */
  now: Date;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Computes the trailing-N-week digest→companion return ratio, per week and
 * overall. Rows outside the trailing window (by `wk`) are ignored; rows for
 * event names other than "digest_return"/"companion_revisit" are ignored.
 * Input order does not matter.
 */
export function computeDigestReturnRate(
  rows: readonly DigestReturnRateRow[],
  options: DigestReturnRateOptions,
): DigestReturnRateResult {
  if (!Number.isInteger(options.weeks) || options.weeks < 1) {
    throw new RangeError(
      `computeDigestReturnRate: weeks must be a positive integer, got ${options.weeks}`,
    );
  }

  // Trailing window week labels, oldest first. Stepping back in fixed 7-day
  // increments from `now` always lands one ISO week earlier regardless of
  // which day of the week `now` is (ISO weeks are calendar-aligned, 7-day
  // periods), so this enumerates exactly `weeks` distinct, consecutive ISO
  // weeks ending in the week containing `now`.
  const windowWeeks: string[] = [];
  for (let i = options.weeks - 1; i >= 0; i--) {
    windowWeeks.push(isoWeekString(new Date(options.now.getTime() - i * MS_PER_WEEK)));
  }
  const windowSet = new Set(windowWeeks);

  const digestByWeek = new Map<string, number>();
  const revisitByWeek = new Map<string, number>();
  for (const row of rows) {
    if (!windowSet.has(row.wk)) continue; // window trimming
    if (row.event === "digest_return") {
      digestByWeek.set(row.wk, (digestByWeek.get(row.wk) ?? 0) + row.count);
    } else if (row.event === "companion_revisit") {
      revisitByWeek.set(row.wk, (revisitByWeek.get(row.wk) ?? 0) + row.count);
    }
    // Any other event name sharing this dataset is silently ignored.
  }

  const weeks: WeekReturnRate[] = windowWeeks.map((wk) => {
    const digestReturns = digestByWeek.get(wk) ?? 0;
    const companionRevisits = revisitByWeek.get(wk) ?? 0;
    return {
      wk,
      digestReturns,
      companionRevisits,
      ratio: digestReturns > 0 ? companionRevisits / digestReturns : null,
    };
  });

  const totalDigestReturns = weeks.reduce((sum, w) => sum + w.digestReturns, 0);
  const totalCompanionRevisits = weeks.reduce((sum, w) => sum + w.companionRevisits, 0);

  return {
    weeks,
    overall: {
      digestReturns: totalDigestReturns,
      companionRevisits: totalCompanionRevisits,
      ratio: totalDigestReturns > 0 ? totalCompanionRevisits / totalDigestReturns : null,
    },
  };
}
