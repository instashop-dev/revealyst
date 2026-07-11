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
    const { perPerson } = resolvePerPersonUsage({
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
    expect(perPerson).toHaveLength(1);
    // p1: days {06-01, 06-02} across both subjects = 2 distinct days.
    expect(perPerson[0].activeDays).toBe(2);
  });

  it("EXCLUDES subjects with no identity link (never guessed) and tallies their volume", () => {
    const { perPerson, excluded } = resolvePerPersonUsage({
      activeDayRows: [active("linked", "2026-06-01"), active("orphan", "2026-06-01")],
      promptRows: [prompt("orphan", 500)],
      identities: [{ subjectId: "linked", personId: "p1" }],
    });
    expect(perPerson).toHaveLength(1);
    expect(perPerson[0].activeDays).toBe(1);
    expect(perPerson[0].prompts).toBe(0); // the orphan's 500 prompts are dropped...
    expect(excluded.unresolvedSubjects).toBe(1); // ...but disclosed, not hidden
    expect(excluded.unresolvedPrompts).toBe(500);
  });

  it("EXCLUDES shared (multi-person) subjects from per-person math — volume is never multiplied per linked person", () => {
    // The duplication probe: 900 prompts on one account linked to 3 people
    // must NOT become 2,700 attributed prompts (nor be split by a guess).
    const { perPerson, excluded } = resolvePerPersonUsage({
      activeDayRows: [active("shared", "2026-06-01")],
      promptRows: [prompt("shared", 900)],
      identities: [
        { subjectId: "shared", personId: "p1" },
        { subjectId: "shared", personId: "p2" },
        { subjectId: "shared", personId: "p3" },
      ],
    });
    expect(perPerson).toHaveLength(0); // nobody credited — excluded, never guessed
    expect(excluded.sharedSubjects).toBe(1);
    expect(excluded.sharedPrompts).toBe(900); // counted ONCE
  });

  it("shared-subject exclusion applies to DAYS too — a person's own subjects still count", () => {
    const { perPerson, excluded } = resolvePerPersonUsage({
      activeDayRows: [
        active("own", "2026-06-01"), // p1's exclusive account
        active("shared", "2026-06-02"), // linked to p1 AND p2
      ],
      promptRows: [prompt("own", 50), prompt("shared", 900)],
      identities: [
        { subjectId: "own", personId: "p1" },
        { subjectId: "shared", personId: "p1" },
        { subjectId: "shared", personId: "p2" },
      ],
    });
    // p1 keeps ONLY their exclusive subject's day+volume; the shared day is
    // not added to p1 or p2 (distribution and concentration read the same
    // population).
    expect(perPerson).toHaveLength(1);
    expect(perPerson[0].activeDays).toBe(1);
    expect(perPerson[0].prompts).toBe(50);
    expect(excluded.sharedPrompts).toBe(900);
  });

  it("sums prompt volume per person", () => {
    const { perPerson } = resolvePerPersonUsage({
      activeDayRows: [],
      promptRows: [prompt("s1", 30), prompt("s1", 70)],
      identities: [{ subjectId: "s1", personId: "p1" }],
    });
    expect(perPerson[0].prompts).toBe(100);
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

  it("ratio honesty: zero attributed prompts → not shown (no denominator)", () => {
    const usage = Array.from({ length: 6 }, () => ({ activeDays: 3, prompts: 0 }));
    const c = summarizeUsageConcentration(usage);
    expect(c.available).toBe(false);
    expect(c.resolvedPeople).toBe(0);
  });

  it("carries excludedPrompts through BOTH variants (the unresolved-heavy-key probe)", () => {
    // 4 light resolved users + a 10,000-prompt unresolved key: the shares
    // cover only the 70 attributed prompts, and the surface must be able to
    // say the 10,000 were left out.
    const usage = [
      { activeDays: 1, prompts: 10 },
      { activeDays: 1, prompts: 15 },
      { activeDays: 1, prompts: 20 },
      { activeDays: 1, prompts: 25 },
    ];
    const c = summarizeUsageConcentration(usage, 10_000);
    expect(c.available).toBe(true);
    if (!c.available) return;
    expect(c.totalPrompts).toBe(70); // attributed only — NOT 10,070
    expect(c.excludedPrompts).toBe(10_000); // disclosed alongside
    // And when unavailable, the disclosure still rides along.
    const empty = summarizeUsageConcentration([], 10_000);
    expect(empty.available).toBe(false);
    expect(empty.excludedPrompts).toBe(10_000);
  });

  it("computes top-decile shares over attributed prompt volume", () => {
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
    // With 4 people the nominal 10% and 25% cohorts collapse to the same
    // single person — the UI then renders ONE figure labeled by the actual
    // cohort share (25%), never "top 10%" for 1-of-4.
    expect(c.top10Count).toBe(c.top25Count);
  });
});
