import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../src/lib/format";

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-05T12:00:00Z");

  it.each([
    ["2026-07-05T11:59:30Z", "just now"],
    ["2026-07-05T11:45:00Z", "15m ago"],
    ["2026-07-05T10:00:00Z", "2h ago"],
    ["2026-07-02T12:00:00Z", "3d ago"],
    ["2026-05-01T12:00:00Z", "2mo ago"],
    ["2024-06-01T12:00:00Z", "2y ago"],
  ])("%s → %s", (when, expected) => {
    expect(formatRelativeTime(when, now)).toBe(expected);
  });

  it("never claims the future — clock skew reads as just now", () => {
    expect(formatRelativeTime("2026-07-05T12:05:00Z", now)).toBe("just now");
  });
});
