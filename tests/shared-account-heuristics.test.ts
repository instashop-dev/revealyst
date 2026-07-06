import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countTrackedUsers } from "../src/contracts/tracked-user";
import { fixtureGraphSchema } from "../src/db/fixtures";
import {
  DEFAULT_SHARED_ACCOUNT_CONFIG,
  detectSharedAccounts,
  median,
  type SubjectDaySignal,
} from "../src/lib/shared-account/heuristics";

// Gate-critical suite (W2-K exit gate: "flags fire on seeded test patterns").
// Pure — no DB, no I/O. Builds against a seeded fixture whose subjects each
// exhibit ONE shared-account pattern, plus a normal baseline and a Copilot
// subject with source_granularity "none" that must degrade to volume-only.

const fixture = fixtureGraphSchema.parse(
  JSON.parse(
    readFileSync("fixtures/metric-records/shared-account-patterns.json", "utf8"),
  ),
);

// For the pure function the fixture `key` IS the subject id.
const signals: SubjectDaySignal[] = fixture.signals.map((s) => ({
  subjectId: s.subject,
  hours: s.hours,
  peakConcurrency: s.peakConcurrency,
  sourceGranularity: s.sourceGranularity,
}));

const volumeBySubject = new Map<string, number>();
for (const r of fixture.records) {
  if (r.metricKey === "tokens_input") {
    volumeBySubject.set(r.subject, (volumeBySubject.get(r.subject) ?? 0) + r.value);
  }
}

describe("detectSharedAccounts — seeded patterns fire", () => {
  const flags = detectSharedAccounts({ signals, volumeBySubject });
  const byId = new Map(flags.map((f) => [f.subjectId, f]));

  it("flags exactly the five seeded shared accounts, none of the normal subjects", () => {
    expect(flags.map((f) => f.subjectId)).toEqual([
      "shared-concurrent",
      "shared-copilot",
      "shared-power",
      "shared-roundclock",
      "shared-volume",
    ]);
    // Normal single-user subjects never flag.
    for (const id of ["alice-key", "bob-key", "carol-key"]) {
      expect(byId.has(id)).toBe(false);
    }
  });

  it("round-the-clock activity flags as round_the_clock (medium)", () => {
    expect(byId.get("shared-roundclock")).toEqual({
      subjectId: "shared-roundclock",
      reasons: ["round_the_clock"],
      confidence: "medium",
      callout: "adoption likely undercounted",
    });
  });

  it("overlapping sessions flag as concurrent_usage (medium)", () => {
    expect(byId.get("shared-concurrent")).toEqual({
      subjectId: "shared-concurrent",
      reasons: ["concurrent_usage"],
      confidence: "medium",
      callout: "adoption likely undercounted",
    });
  });

  it("volume many times the team median flags as volume_exceeds_team_median (low)", () => {
    expect(byId.get("shared-volume")).toEqual({
      subjectId: "shared-volume",
      reasons: ["volume_exceeds_team_median"],
      confidence: "low",
      callout: "adoption likely undercounted",
    });
  });

  it("a subject exhibiting all three patterns is high confidence", () => {
    expect(byId.get("shared-power")).toEqual({
      subjectId: "shared-power",
      reasons: ["round_the_clock", "concurrent_usage", "volume_exceeds_team_median"],
      confidence: "high",
      callout: "adoption likely undercounted",
    });
  });

  it("degrades for source_granularity 'none': Copilot subject flags on volume only, never fabricates hours/concurrency", () => {
    const copilot = byId.get("shared-copilot");
    expect(copilot?.reasons).toEqual(["volume_exceeds_team_median"]);
    // The seeded row has hours: null / peakConcurrency: null — the intra-day
    // heuristics must stay silent rather than invent a pattern.
    expect(copilot?.reasons).not.toContain("round_the_clock");
    expect(copilot?.reasons).not.toContain("concurrent_usage");
  });
});

describe("detectSharedAccounts — a flag is metadata, never people (invariant b)", () => {
  it("leaves countTrackedUsers untouched: flagged shared accounts add zero tracked persons", () => {
    const trackedInput = {
      identities: fixture.identities.map((i) => ({
        subjectId: i.subject,
        personId: i.person,
      })),
      activeSubjectDays: fixture.records.map((r) => ({
        subjectId: r.subject,
        day: r.day,
      })),
      period: { start: "2026-06-01", end: "2026-06-30" },
    };
    const before = countTrackedUsers(trackedInput);
    const flags = detectSharedAccounts({ signals, volumeBySubject });
    const after = countTrackedUsers(trackedInput);

    // Detection is side-effect-free on the billing primitive.
    expect(after).toEqual(before);
    // Only the three resolved people are tracked — the shared accounts are
    // NOT promoted to people by being flagged.
    expect(before.trackedPersonIds).toEqual(["alice", "bob", "carol"]);
    // Every flagged subject is an unresolved subject, surfaced not billed.
    for (const flag of flags) {
      expect(before.unresolvedSubjectIds).toContain(flag.subjectId);
    }
  });
});

describe("detectSharedAccounts — thresholds and edges", () => {
  it("fires at the threshold, not below it", () => {
    const cfg = DEFAULT_SHARED_ACCOUNT_CONFIG;
    const atConcurrency = detectSharedAccounts({
      signals: [
        { subjectId: "s", hours: null, peakConcurrency: cfg.concurrencyMin, sourceGranularity: "1h" },
      ],
      volumeBySubject: new Map(),
    });
    expect(atConcurrency.map((f) => f.subjectId)).toEqual(["s"]);

    const belowConcurrency = detectSharedAccounts({
      signals: [
        { subjectId: "s", hours: null, peakConcurrency: cfg.concurrencyMin - 1, sourceGranularity: "1h" },
      ],
      volumeBySubject: new Map(),
    });
    expect(belowConcurrency).toEqual([]);
  });

  it("does not flag on volume when the team median is zero", () => {
    const flags = detectSharedAccounts({
      signals: [],
      volumeBySubject: new Map([["a", 0], ["b", 0], ["c", 500]]),
    });
    // median is 0 → no volume comparison possible → no flags.
    expect(flags).toEqual([]);
  });

  it("a null-signal subject with no volume produces no flag (no data, no fabrication)", () => {
    const flags = detectSharedAccounts({
      signals: [{ subjectId: "s", hours: null, peakConcurrency: null, sourceGranularity: "none" }],
      volumeBySubject: new Map([["s", 1]]),
    });
    expect(flags).toEqual([]);
  });

  it("median handles even and odd lengths", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 10, 10, 100])).toBe(10);
  });
});
