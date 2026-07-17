import { describe, expect, it } from "vitest";

import { formatLastSync } from "./format";

const NOW = 1_767_000_000_000; // fixed reference so the buckets are deterministic

describe("formatLastSync", () => {
  it("returns the honest dash when never synced", () => {
    expect(formatLastSync(null, NOW)).toBe("—");
    expect(formatLastSync(undefined, NOW)).toBe("—");
  });

  it("says 'just now' for the last few seconds", () => {
    expect(formatLastSync(NOW, NOW)).toBe("just now");
    expect(formatLastSync(NOW - 30_000, NOW)).toBe("just now");
  });

  it("clamps a future timestamp to 'just now' (clock skew)", () => {
    expect(formatLastSync(NOW + 60_000, NOW)).toBe("just now");
  });

  it("formats minutes with correct pluralization", () => {
    expect(formatLastSync(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(formatLastSync(NOW - 3 * 60_000, NOW)).toBe("3 minutes ago");
  });

  it("formats hours", () => {
    expect(formatLastSync(NOW - 60 * 60_000, NOW)).toBe("1 hour ago");
    expect(formatLastSync(NOW - 5 * 60 * 60_000, NOW)).toBe("5 hours ago");
  });

  it("formats yesterday and recent days", () => {
    expect(formatLastSync(NOW - 24 * 60 * 60_000, NOW)).toBe("yesterday");
    expect(formatLastSync(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3 days ago");
  });

  it("falls back to a locale date for anything older than a week", () => {
    const old = NOW - 30 * 24 * 60 * 60_000;
    expect(formatLastSync(old, NOW)).toBe(new Date(old).toLocaleDateString());
  });
});
