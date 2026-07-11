import { describe, expect, it } from "vitest";
import {
  MIN_PEOPLE_FOR_DISTRIBUTION,
  percentile,
  resolvePerPersonUsage,
  summarizeUsageConcentration,
  summarizeUsageDistribution,
} from "../src/lib/usage-distribution";

// Pure-function suite (F1.2 / M3 + M4): no DB, no I/O.

function active(subjectId: string, day: string) {
  return { subjectId, day, value: 1 };
}
function prompt(subjectId: string, value: number) {
  return { subjectId, day: "2026-06-10", value };
}

describe("resolvePerPersonUsage", () => {
  it("resolves active days per person from their linked subjects (distinct days)", () => {
    const usage = resolvePerPersonUsage({
      activeDayRows: [
        active("s1", "2026-06-01"),
        active("s1", "2026-06-02"),
        active("s2", "2026-06-01"), // s2 is the SAME person p1's second tool
      ],
      promptRows: [],
      identities: [
        { subjectId: "s1", personId: "p1" },
        { subjectId: "s2", personId: "p1" },
      ],
    });
    expect(usage).toHaveLength(1);
    // p1: days {06-01, 06-02} across both subjects = 2 distinct days.
    expect(usage[0].activeDays).toBe(2);
  });

  it("EXCLUDES subjects with no identity link (never guessed into a person)", () => {
    const usage = resolvePerPersonUsage({
      activeDayRows: [active("linked", "2026-06-01"), active("orphan", "2026-06-01")],
      promptRows: [prompt("orphan", 500)],
      identities: [{ subjectId: "linked", personId: "p1" }],
    });
    expect(usage).toHaveLength(1);
    expect(usage[0].activeDays).toBe(1);
    expect(usage[0].prompts).toBe(0); // the orphan's 500 prompts are dropped
  });

  it("a shared subject (many identities) contributes to each linked person", () => {
    const usage = resolvePerPersonUsage({
      activeDayRows: [active("shared", "2026-06-01")],
      promptRows: [prompt("shared", 100)],
      identities: [
        { subjectId: "shared", personId: "p1" },
        { subjectId: "shared", personId: "p2" },
      ],
    });
    expect(usage).toHaveLength(2);
    expect(usage.every((u) => u.activeDays === 1 && u.prompts === 100)).toBe(true);
  });

  it("sums prompt volume per person", () => {
    const usage = resolvePerPersonUsage({
      activeDayRows: [],
      promptRows: [prompt("s1", 30), prompt("s1", 70)],
      identities: [{ subjectId: "s1", personId: "p1" }],
    });
    expect(usage[0].prompts).toBe(100);
  });
});

describe("percentile", () => {
  it("empty → 0; single → that value", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 90)).toBe(7);
  });
  it("interpolates within the org's own sample", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([0, 10], 90)).toBe(9);
  });
});

describe("summarizeUsageDistribution", () => {
  const periodDays = 28;

  it("honest empty state below the resolved-people floor", () => {
    const usage = Array.from({ length: MIN_PEOPLE_FOR_DISTRIBUTION - 1 }, () => ({
      activeDays: 5,
      prompts: 0,
    }));
    const dist = summarizeUsageDistribution(usage, periodDays);
    expect(dist.available).toBe(false);
    expect(dist.resolvedPeople).toBe(MIN_PEOPLE_FOR_DISTRIBUTION - 1);
  });

  it("people with zero active days are NOT resolved (excluded from the count)", () => {
    const usage = [
      { activeDays: 0, prompts: 0 },
      { activeDays: 0, prompts: 0 },
      { activeDays: 5, prompts: 0 },
      { activeDays: 6, prompts: 0 },
    ];
    // Only 2 have >0 active days → below floor → empty.
    const dist = summarizeUsageDistribution(usage, periodDays);
    expect(dist.available).toBe(false);
    expect(dist.resolvedPeople).toBe(2);
  });

  it("bands split the period into quarters and tally people (28-day boundaries)", () => {
    // q1=7, q2=14, q3=21. One person squarely in each band.
    const usage = [
      { activeDays: 3, prompts: 0 }, // occasional (1–7)
      { activeDays: 10, prompts: 0 }, // regular (8–14)
      { activeDays: 18, prompts: 0 }, // frequent (15–21)
      { activeDays: 27, prompts: 0 }, // near_daily (22–28)
    ];
    const dist = summarizeUsageDistribution(usage, periodDays);
    expect(dist.available).toBe(true);
    if (!dist.available) return;
    expect(dist.bands.map((b) => [b.key, b.count])).toEqual([
      ["occasional", 1],
      ["regular", 1],
      ["frequent", 1],
      ["near_daily", 1],
    ]);
    // Band boundaries are inclusive/adjacent (7 → occasional, 8 → regular).
    expect(dist.bands[0]).toMatchObject({ lowDays: 1, highDays: 7 });
    expect(dist.bands[1]).toMatchObject({ lowDays: 8, highDays: 14 });
    expect(dist.bands[3]).toMatchObject({ lowDays: 22, highDays: 28 });
    expect(dist.maxActiveDays).toBe(27);
    expect(dist.medianActiveDays).toBe(14); // median of [3,10,18,27]
  });
});

describe("summarizeUsageConcentration", () => {
  it("honest empty below the floor", () => {
    const usage = [
      { activeDays: 1, prompts: 10 },
      { activeDays: 1, prompts: 10 },
      { activeDays: 1, prompts: 10 },
    ];
    expect(summarizeUsageConcentration(usage).available).toBe(false);
  });

  it("ratio honesty: zero total prompts → not shown (no denominator)", () => {
    const usage = Array.from({ length: 6 }, () => ({ activeDays: 3, prompts: 0 }));
    const c = summarizeUsageConcentration(usage);
    expect(c.available).toBe(false);
    expect(c.resolvedPeople).toBe(0);
  });

  it("computes top-decile shares over prompt volume", () => {
    // 10 people: one heavy (1000), nine light (10 each = 90). Total 1090.
    const usage = [
      { activeDays: 1, prompts: 1000 },
      ...Array.from({ length: 9 }, () => ({ activeDays: 1, prompts: 10 })),
    ];
    const c = summarizeUsageConcentration(usage);
    expect(c.available).toBe(true);
    if (!c.available) return;
    expect(c.totalPrompts).toBe(1090);
    // top 10% = ceil(10*0.1)=1 person → the 1000 → ~91.7%.
    expect(c.top10Count).toBe(1);
    expect(Math.round(c.top10SharePct)).toBe(92);
    // top 25% = ceil(10*0.25)=3 people → 1000+10+10=1020 → ~93.6%.
    expect(c.top25Count).toBe(3);
    expect(Math.round(c.top25SharePct)).toBe(94);
  });

  it("always includes at least one person in the top slice (ceil, never 0)", () => {
    const usage = Array.from({ length: 4 }, (_, i) => ({
      activeDays: 1,
      prompts: (i + 1) * 10,
    }));
    const c = summarizeUsageConcentration(usage);
    if (!c.available) throw new Error("expected available");
    expect(c.top10Count).toBeGreaterThanOrEqual(1);
  });
});
