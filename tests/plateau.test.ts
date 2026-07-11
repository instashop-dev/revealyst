import { describe, expect, it } from "vitest";
import type { ConnectionChannelInput } from "../src/lib/onboarding-guide";
import { detectPlateau } from "../src/lib/plateau";
import { addUtcDays } from "../src/lib/raw-metric-delta";
import {
  computeUsageBaselines,
  materializeMeasuredZeroWeeks,
  type WeeklyActivePoint,
} from "../src/lib/usage-baselines";

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

  it("a collapse that flattens at ZERO still counts (F1 — …8 → 0 → 0 → 0 is the steepest fall of all)", () => {
    const result = detect([4, 10, 9, 8, 0, 0, 0]);
    expect(result.kind).toBe("plateau");
    if (result.kind !== "plateau") return;
    // Calendar weeks since the peak, zero weeks included (F7).
    expect(result.decliningWeeks).toBe(5);
    expect(result.declinePct).toBe(100);
    expect(result.latest.activePeople).toBe(0);
  });

  it("a TOTAL collapse right after the peak → plateau, never insufficient (F1 probe)", () => {
    const result = detect([4, 10, 0, 0, 0]);
    expect(result.kind).toBe("plateau");
    if (result.kind !== "plateau") return;
    expect(result.declinePct).toBe(100);
    expect(result.decliningWeeks).toBe(3);
  });

  it("a drop that then flattens at a lower level is a plateau (equal steps stay in the run)", () => {
    const result = detect([2, 10, 8, 8, 8]);
    expect(result.kind).toBe("plateau");
    if (result.kind !== "plateau") return;
    expect(result.declinePct).toBe(20);
    expect(result.decliningWeeks).toBe(3);
  });

  it("a noisy flat series (no sustained decline) → none", () => {
    expect(detect([4, 5, 4, 5, 4, 5]).kind).toBe("none");
  });

  it("an all-equal run after the peak (0% drop) → none (the decline floor gates it)", () => {
    expect(detect([4, 5, 5, 5, 5]).kind).toBe("none");
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

// ─── End-to-end probes over the REAL M8 pipeline (computeUsageBaselines →
// materializeMeasuredZeroWeeks → detectPlateau), pinning the review's two
// silent-failure scenarios (F1 collapse-to-zero, F4 truncated leading week).

type ActiveRow = { subjectId: string; day: string; value: number };

const IDENTITIES = Array.from({ length: 10 }, (_, i) => ({
  subjectId: `s${i + 1}`,
  personId: `p${i + 1}`,
}));

/** `count` distinct people active on the Monday `weekStart`. */
function weekActivity(weekStart: string, count: number): ActiveRow[] {
  return Array.from({ length: count }, (_, i) => ({
    subjectId: `s${i + 1}`,
    day: weekStart,
    value: 1,
  }));
}

describe("detectPlateau — end-to-end over computeUsageBaselines", () => {
  it("F1 probe: ramp 4→10→9→8 then silence, fresh syncing connection → PLATEAU (zero weeks are measured, not invisible)", () => {
    // Non-Monday request date, 12-week window → windowFrom 2026-04-08 (Wed).
    const today = "2026-06-30";
    const rows = [
      ...weekActivity("2026-04-13", 4),
      ...weekActivity("2026-04-20", 10),
      ...weekActivity("2026-04-27", 9),
      ...weekActivity("2026-05-04", 8),
      // …then everyone stops. No rows at all after May 10.
    ];
    const baselines = computeUsageBaselines({
      activeDayRows: rows,
      identityLinks: IDENTITIES,
      windowTo: today,
    });
    const weekly = materializeMeasuredZeroWeeks(baselines);
    // Trailing zero weeks materialized through the last complete week (Jun 22).
    expect(weekly[weekly.length - 1].weekStart).toBe("2026-06-22");
    expect(weekly[weekly.length - 1].activePeople).toBe(0);
    const result = detectPlateau({
      weeklyActive: weekly,
      connections: [freshConn()],
      today,
    });
    expect(result.kind).toBe("plateau");
    if (result.kind !== "plateau") return;
    expect(result.peak.activePeople).toBe(10);
    expect(result.latest.activePeople).toBe(0);
    expect(result.declinePct).toBe(100);
    // True calendar run length, zero weeks included (F7): Apr 20 → Jun 22.
    expect(result.decliningWeeks).toBe(9);
  });

  it("F4 probe: a monotonic-decline org on a NON-Monday request date → none (the truncated leading week can't fabricate a rise)", () => {
    const today = "2026-06-30"; // Tuesday → windowFrom 2026-04-08 (Wednesday)
    const rows = [
      // Partial activity inside the TRUNCATED leading week (Mon 2026-04-06):
      // only its in-window tail days are fetched, undercounting the real
      // week. Pre-fix this bucket read as a complete 2-person week — a
      // fabricated "rise into the peak" for a purely declining org.
      ...weekActivity("2026-04-09", 2).map((r, i) => ({ ...r, day: i === 0 ? "2026-04-09" : "2026-04-10" })),
      // Complete weeks: monotonic non-increasing from the start.
      ...weekActivity("2026-04-13", 10),
      ...weekActivity("2026-04-20", 9),
      ...weekActivity("2026-04-27", 8),
      ...weekActivity("2026-05-04", 7),
      ...weekActivity("2026-05-11", 6),
      ...weekActivity("2026-05-18", 5),
      ...weekActivity("2026-05-25", 4),
      ...weekActivity("2026-06-01", 4),
      ...weekActivity("2026-06-08", 4),
      ...weekActivity("2026-06-15", 4),
      ...weekActivity("2026-06-22", 4),
    ];
    const baselines = computeUsageBaselines({
      activeDayRows: rows,
      identityLinks: IDENTITIES,
      windowTo: today,
    });
    const weekly = materializeMeasuredZeroWeeks(baselines);
    // The truncated leading week is not in the series…
    expect(weekly[0].weekStart).toBe("2026-04-13");
    // …so the peak is the FIRST week and no plateau is declared.
    const result = detectPlateau({
      weeklyActive: weekly,
      connections: [freshConn()],
      today,
    });
    expect(result.kind).toBe("none");
  });
});
