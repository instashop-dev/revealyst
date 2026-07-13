import { describe, expect, it } from "vitest";
import {
  daysUntilRenewal,
  dueRenewalThreshold,
  RENEWAL_REMINDER_THRESHOLDS,
} from "../src/lib/renewal-reminders";

// Pure renewal-reminder window logic (W6-G). Strict per-threshold equality: a
// date EXACTLY 30 or 7 days out fires; 29/8/31 (and any past date) does not.

describe("daysUntilRenewal", () => {
  it("counts whole UTC calendar days, DST-safe", () => {
    expect(daysUntilRenewal("2026-07-13", "2026-08-12")).toBe(30);
    expect(daysUntilRenewal("2026-07-13", "2026-07-20")).toBe(7);
    expect(daysUntilRenewal("2026-07-13", "2026-07-13")).toBe(0);
    // Spans a US DST boundary (Nov 1, 2026) — still whole days.
    expect(daysUntilRenewal("2026-10-15", "2026-11-14")).toBe(30);
  });

  it("is negative once the renewal date has passed", () => {
    expect(daysUntilRenewal("2026-07-13", "2026-07-06")).toBe(-7);
  });
});

describe("dueRenewalThreshold", () => {
  const today = "2026-07-13";

  it("fires at exactly 30 days out", () => {
    expect(dueRenewalThreshold(today, "2026-08-12")).toBe(30);
  });

  it("fires at exactly 7 days out", () => {
    expect(dueRenewalThreshold(today, "2026-07-20")).toBe(7);
  });

  it("does NOT fire at 29, 31, or 8 days out", () => {
    expect(dueRenewalThreshold(today, "2026-08-11")).toBeNull(); // 29
    expect(dueRenewalThreshold(today, "2026-08-13")).toBeNull(); // 31
    expect(dueRenewalThreshold(today, "2026-07-21")).toBeNull(); // 8
    expect(dueRenewalThreshold(today, "2026-07-19")).toBeNull(); // 6
  });

  it("does NOT fire on the day itself or a past date", () => {
    expect(dueRenewalThreshold(today, "2026-07-13")).toBeNull(); // 0
    expect(dueRenewalThreshold(today, "2026-07-06")).toBeNull(); // -7
  });

  it("exposes both lead times high-to-low", () => {
    expect(RENEWAL_REMINDER_THRESHOLDS).toEqual([30, 7]);
  });
});
