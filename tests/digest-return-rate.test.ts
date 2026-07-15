import { describe, expect, it } from "vitest";
import {
  computeDigestReturnRate,
  type DigestReturnRateRow,
} from "../src/lib/digest-return-rate";
import { isoWeekString } from "../src/lib/digest-content";

// Anchor "now" mid-week so trailing-window math can't accidentally pass by
// landing on a week boundary.
const NOW = new Date("2026-07-15T12:00:00Z"); // Wednesday
const wkOf = (isoDate: string) => isoWeekString(new Date(isoDate));

function row(
  event: string,
  wk: string,
  count: number,
): DigestReturnRateRow {
  return { event, wk, count };
}

describe("computeDigestReturnRate", () => {
  it("zero data: every week zero-filled, ratio null, overall ratio null", () => {
    const result = computeDigestReturnRate([], { weeks: 3, now: NOW });
    expect(result.weeks).toHaveLength(3);
    for (const w of result.weeks) {
      expect(w.digestReturns).toBe(0);
      expect(w.companionRevisits).toBe(0);
      expect(w.ratio).toBeNull();
    }
    expect(result.overall).toEqual({
      digestReturns: 0,
      companionRevisits: 0,
      ratio: null,
    });
    // Weeks are oldest-first and end at the week containing `now`.
    expect(result.weeks[result.weeks.length - 1]!.wk).toBe(wkOf("2026-07-15"));
  });

  it("digest-only week: companionRevisits 0 is a real measured zero, not null", () => {
    const thisWeek = wkOf("2026-07-15");
    const result = computeDigestReturnRate(
      [row("digest_return", thisWeek, 10)],
      { weeks: 1, now: NOW },
    );
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0]).toEqual({
      wk: thisWeek,
      digestReturns: 10,
      companionRevisits: 0,
      ratio: 0,
    });
    expect(result.overall.ratio).toBe(0);
  });

  it("companion-only week (no digest_return): honest null, never 0/0", () => {
    const thisWeek = wkOf("2026-07-15");
    const result = computeDigestReturnRate(
      [row("companion_revisit", thisWeek, 25)],
      { weeks: 1, now: NOW },
    );
    expect(result.weeks[0]).toEqual({
      wk: thisWeek,
      digestReturns: 0,
      companionRevisits: 25,
      ratio: null,
    });
    expect(result.overall.ratio).toBeNull();
  });

  it("normal ratio math per week and overall, summing duplicate rows for the same (event, wk)", () => {
    const w1 = wkOf("2026-07-01"); // two weeks back from NOW's week
    const w2 = wkOf("2026-07-08"); // one week back
    const w3 = wkOf("2026-07-15"); // current week
    const rows: DigestReturnRateRow[] = [
      row("digest_return", w1, 20),
      row("companion_revisit", w1, 5),
      row("digest_return", w2, 8),
      row("digest_return", w2, 2), // duplicate (event, wk) pair — must sum
      row("companion_revisit", w2, 10),
      row("digest_return", w3, 4),
      row("companion_revisit", w3, 12),
    ];
    const result = computeDigestReturnRate(rows, { weeks: 3, now: NOW });

    expect(result.weeks.map((w) => w.wk)).toEqual([w1, w2, w3]);
    expect(result.weeks[0]).toEqual({
      wk: w1,
      digestReturns: 20,
      companionRevisits: 5,
      ratio: 0.25,
    });
    expect(result.weeks[1]).toEqual({
      wk: w2,
      digestReturns: 10, // 8 + 2
      companionRevisits: 10,
      ratio: 1,
    });
    expect(result.weeks[2]).toEqual({
      wk: w3,
      digestReturns: 4,
      companionRevisits: 12,
      ratio: 3,
    });

    // overall: (5 + 10 + 12) / (20 + 10 + 4) = 27 / 34
    expect(result.overall.digestReturns).toBe(34);
    expect(result.overall.companionRevisits).toBe(27);
    expect(result.overall.ratio).toBeCloseTo(27 / 34);
  });

  it("window trimming: rows outside the trailing window are ignored entirely", () => {
    const inWindow = wkOf("2026-07-15");
    const wayBefore = wkOf("2025-01-06"); // long before the 2-week window
    const rows: DigestReturnRateRow[] = [
      row("digest_return", inWindow, 6),
      row("companion_revisit", inWindow, 3),
      // Out-of-window rows: must not leak into any week or the overall total.
      row("digest_return", wayBefore, 999),
      row("companion_revisit", wayBefore, 999),
    ];
    const result = computeDigestReturnRate(rows, { weeks: 2, now: NOW });

    expect(result.weeks.some((w) => w.wk === wayBefore)).toBe(false);
    expect(result.overall.digestReturns).toBe(6);
    expect(result.overall.companionRevisits).toBe(3);
    expect(result.overall.ratio).toBe(0.5);
  });

  it("ignores rows for unrelated event names sharing the same dataset", () => {
    const thisWeek = wkOf("2026-07-15");
    const result = computeDigestReturnRate(
      [
        row("landing_view", thisWeek, 500),
        row("share_card_view", thisWeek, 40),
        row("digest_return", thisWeek, 2),
        row("companion_revisit", thisWeek, 2),
      ],
      { weeks: 1, now: NOW },
    );
    expect(result.weeks[0]).toEqual({
      wk: thisWeek,
      digestReturns: 2,
      companionRevisits: 2,
      ratio: 1,
    });
  });

  it("unsorted input produces the same result as sorted input", () => {
    const w1 = wkOf("2026-07-01");
    const w2 = wkOf("2026-07-15");
    const sorted: DigestReturnRateRow[] = [
      row("digest_return", w1, 3),
      row("companion_revisit", w1, 1),
      row("digest_return", w2, 5),
      row("companion_revisit", w2, 5),
    ];
    const shuffled = [sorted[3]!, sorted[0]!, sorted[2]!, sorted[1]!];

    const resultSorted = computeDigestReturnRate(sorted, { weeks: 3, now: NOW });
    const resultShuffled = computeDigestReturnRate(shuffled, { weeks: 3, now: NOW });

    expect(resultShuffled).toEqual(resultSorted);
  });

  it("rejects a non-positive or non-integer weeks window", () => {
    expect(() => computeDigestReturnRate([], { weeks: 0, now: NOW })).toThrow(RangeError);
    expect(() => computeDigestReturnRate([], { weeks: -1, now: NOW })).toThrow(RangeError);
    expect(() => computeDigestReturnRate([], { weeks: 1.5, now: NOW })).toThrow(RangeError);
  });
});
