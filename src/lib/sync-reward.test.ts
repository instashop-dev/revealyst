import { describe, expect, it } from "vitest";

import { deriveSyncPositive } from "./sync-reward";

describe("deriveSyncPositive", () => {
  it("returns null on zero records (nothing to celebrate)", () => {
    expect(
      deriveSyncPositive({ records: 0, signals: 0, subjects: 1 }),
    ).toBeNull();
  });

  it("returns null on zero signals even with records present", () => {
    expect(
      deriveSyncPositive({ records: 12, signals: 0, subjects: 1 }),
    ).toBeNull();
  });

  it("returns null when more than one subject (active-days unattributable)", () => {
    expect(
      deriveSyncPositive({ records: 100, signals: 10, subjects: 2 }),
    ).toBeNull();
  });

  it("returns null on thin data below the consistency threshold (1-2 active days)", () => {
    expect(
      deriveSyncPositive({ records: 40, signals: 1, subjects: 1 }),
    ).toBeNull();
    expect(
      deriveSyncPositive({ records: 40, signals: 2, subjects: 1 }),
    ).toBeNull();
  });

  it("returns the consistency superlative at the threshold (>=3 active days, single subject)", () => {
    const result = deriveSyncPositive({ records: 340, signals: 3, subjects: 1 });
    expect(result).toBe(
      "Here's one thing you did well: 3 active days in this window — steady, consistent practice.",
    );
  });

  it("scales the count in the message for larger windows", () => {
    const result = deriveSyncPositive({ records: 900, signals: 12, subjects: 1 });
    expect(result).toBe(
      "Here's one thing you did well: 12 active days in this window — steady, consistent practice.",
    );
  });
});
