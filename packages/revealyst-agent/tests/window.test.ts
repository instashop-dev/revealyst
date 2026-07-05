import { describe, expect, it } from "vitest";
import { trailingWindow } from "../src/window";

describe("trailingWindow", () => {
  it("builds an inclusive trailing UTC window ending today", () => {
    expect(trailingWindow(new Date("2026-07-05T10:00:00Z"), 30)).toEqual({
      start: "2026-06-06",
      end: "2026-07-05",
    });
  });

  it("days=1 is just today", () => {
    expect(trailingWindow(new Date("2026-07-05T23:59:59Z"), 1)).toEqual({
      start: "2026-07-05",
      end: "2026-07-05",
    });
  });

  it("uses UTC days regardless of local timezone offsets", () => {
    // 00:30 UTC — local time on this dev machine (UTC+5:30) is already the
    // 5th; the window must still be UTC-based.
    expect(trailingWindow(new Date("2026-07-05T00:30:00Z"), 2)).toEqual({
      start: "2026-07-04",
      end: "2026-07-05",
    });
  });

  it("rejects non-positive or fractional day counts", () => {
    expect(() => trailingWindow(new Date(), 0)).toThrow();
    expect(() => trailingWindow(new Date(), 1.5)).toThrow();
  });
});
