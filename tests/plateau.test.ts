import { describe, expect, it } from "vitest";
import type { ConnectionChannelInput } from "../src/lib/onboarding-guide";
import { detectPlateau } from "../src/lib/plateau";
import { addUtcDays } from "../src/lib/raw-metric-delta";
import type { WeeklyActivePoint } from "../src/lib/usage-baselines";

const TODAY = "2026-07-01";

function freshConn(): ConnectionChannelInput {
  return {
    vendor: "anthropic_console",
    status: "active",
    lastSuccessAt: new Date(`${TODAY}T12:00:00.000Z`),
  };
}

/** Complete weekly retention points from active-people counts. Only
 * activePeople / weekStart / label are read by the detector. */
function weeklyPoints(counts: number[]): WeeklyActivePoint[] {
  const start = "2026-04-06"; // a Monday
  return counts.map((activePeople, i) => {
    const weekStart = addUtcDays(start, i * 7);
    return {
      weekStart,
      label: weekStart,
      activePeople,
      activePersonDays: activePeople,
      complete: true,
    };
  });
}

function detect(counts: number[], connections: ConnectionChannelInput[] = [freshConn()]) {
  return detectPlateau({ weeklyActive: weeklyPoints(counts), connections, today: TODAY });
}

describe("detectPlateau", () => {
  it("a rise then a 3-week fall → plateau, with the measured decline", () => {
    const result = detect([2, 3, 5, 4, 3, 2]); // peak 5, then 4→3→2
    expect(result.kind).toBe("plateau");
    if (result.kind !== "plateau") return;
    expect(result.decliningWeeks).toBe(3);
    expect(result.declinePct).toBe(60); // (5 − 2) / 5
    expect(result.peak.activePeople).toBe(5);
    expect(result.latest.activePeople).toBe(2);
  });

  it("a noisy flat series (no sustained decline) → none", () => {
    expect(detect([4, 5, 4, 5, 4, 5]).kind).toBe("none");
  });

  it("a recovery within the run breaks the plateau → none", () => {
    // peak 5, declines to 4→3, then rises back to 5.
    expect(detect([2, 5, 4, 3, 5]).kind).toBe("none");
  });

  it("fewer than the minimum weeks → insufficient", () => {
    const result = detect([5, 4, 3]); // only 3 complete weeks
    expect(result.kind).toBe("insufficient");
    if (result.kind !== "insufficient") return;
    expect(result.completeWeeks).toBe(3);
  });

  it("a peak in the very first week (no rise into it) → none", () => {
    expect(detect([5, 4, 3, 2]).kind).toBe("none");
  });

  it("a real decline but too shallow (below the total-decline floor) → none", () => {
    // peak 100, then 99→98→97 — three declining weeks but only ~3% total.
    expect(detect([40, 100, 99, 98, 97]).kind).toBe("none");
  });

  it("a peak cohort below the people floor → none (too small to read a trend)", () => {
    // 3 declining weeks and 100% drop, but the peak is only 3 people.
    expect(detect([2, 3, 2, 1, 0]).kind).toBe("none");
  });

  it("G5: a stale channel suppresses the warning", () => {
    const result = detect(
      [2, 3, 5, 4, 3, 2],
      [
        {
          vendor: "anthropic_console",
          status: "active",
          lastSuccessAt: new Date(`${addUtcDays(TODAY, -10)}T00:00:00.000Z`),
        },
      ],
    );
    expect(result.kind).toBe("suppressed");
    if (result.kind !== "suppressed") return;
    expect(result.reason).toBe("stale");
  });
});
