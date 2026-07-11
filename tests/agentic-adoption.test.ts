import { describe, expect, it } from "vitest";
import {
  AGENTIC_WINDOW_DAYS,
  computeAgenticAdoption,
  type AgenticMetricRow,
  type IdentityLinkLike,
} from "../src/lib/agentic-adoption";

// F1.4 agentic-adoption rate — pure derivation. No DB, hand-built metric rows
// and identity links. Date anchors: 2026-06-01 is a Monday, 2026-06-07 the
// following Sunday, 2026-06-08 the next Monday, 2026-06-14 the next Sunday.

function row(
  subjectId: string,
  day: string,
  value = 1,
  sourceConnector?: string,
): AgenticMetricRow {
  return { subjectId, day, value, sourceConnector };
}

function link(subjectId: string, personId: string): IdentityLinkLike {
  return { subjectId, personId };
}

/** Default: every sN subject resolves to its own person pN. */
const LINKS = [
  link("s1", "p1"),
  link("s2", "p2"),
  link("s3", "p3"),
  link("s4", "p4"),
];

// A Sunday, so every June week used in these tests is complete.
const SUNDAY = "2026-06-14";

describe("computeAgenticAdoption — empty / degraded states", () => {
  it("no rows at all → noActivity", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [],
      activeDayRows: [],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    expect(result).toEqual({ kind: "noActivity", unresolvedSubjects: 0 });
  });

  it("activity exists but NONE of it is linked to a person → noActivity with the unresolved count (its own honest state)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("key-a", "2026-06-02")],
      activeDayRows: [row("key-a", "2026-06-02"), row("key-b", "2026-06-03")],
      identityLinks: [], // nothing resolved
      windowTo: SUNDAY,
    });
    expect(result).toEqual({ kind: "noActivity", unresolvedSubjects: 2 });
  });

  it("resolved active days but ZERO agent rows → noAgenticData, never a measured 0%", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [],
      activeDayRows: [row("s1", "2026-06-01"), row("s2", "2026-06-01")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    expect(result).toEqual({
      kind: "noAgenticData",
      activeDays: 2,
      unresolvedSubjects: 0,
    });
  });

  it("agent flag value 0 is treated as absence", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01", 0)],
      activeDayRows: [row("s1", "2026-06-01")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    expect(result.kind).toBe("noAgenticData");
  });
});

describe("computeAgenticAdoption — person-day resolution (review F1)", () => {
  it("the Anthropic two-subject scenario: one human under an acct subject AND an email subject reads 100%, not 50%", () => {
    // usage_report path: active_day under the `acct:` subject.
    // claude_code path: active_day + agent_active under the email subject.
    // Both link to the same person — one 100%-agentic person-day.
    const result = computeAgenticAdoption({
      agentActiveRows: [row("subj-email", "2026-06-02")],
      activeDayRows: [
        row("subj-acct", "2026-06-02"),
        row("subj-email", "2026-06-02"),
      ],
      identityLinks: [
        link("subj-acct", "p-alice"),
        link("subj-email", "p-alice"),
      ],
      windowTo: SUNDAY,
    });
    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    expect(result.activeDays).toBe(1);
    expect(result.agenticDays).toBe(1);
    expect(result.ratePct).toBe(100);
  });

  it("unresolved subject-days are EXCLUDED from the rate and counted for disclosure", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-02")],
      activeDayRows: [
        row("s1", "2026-06-02"),
        // An api-key subject with no identity link — excluded, disclosed.
        row("key-x", "2026-06-02"),
        row("key-x", "2026-06-03"),
      ],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.activeDays).toBe(1);
    expect(result.ratePct).toBe(100);
    expect(result.unresolvedSubjects).toBe(1);
  });

  it("dedups multiple rows for the same person-day (counts the day once)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [
        row("s1", "2026-06-01", 1, "anthropic-console@1"),
        row("s1", "2026-06-01", 1, "cursor@1"),
      ],
      activeDayRows: [row("s1", "2026-06-01"), row("s1", "2026-06-01")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.agenticDays).toBe(1);
    expect(result.activeDays).toBe(1);
    expect(result.ratePct).toBe(100);
  });
});

describe("computeAgenticAdoption — rate math", () => {
  it("rate is distinct agentic person-days ÷ distinct AI-active person-days", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01"), row("s2", "2026-06-01")],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s2", "2026-06-01"),
        row("s3", "2026-06-01"),
        row("s4", "2026-06-01"),
      ],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.activeDays).toBe(4);
    expect(result.agenticDays).toBe(2);
    expect(result.ratePct).toBe(50);
  });

  it("denominator is the UNION: an agentic day without a co-emitted active flag still counts as an active day (review F4)", () => {
    const result = computeAgenticAdoption({
      // s1 d1: agent flag only (vendor didn't set isActive that day).
      // s1 d2: active only.
      agentActiveRows: [row("s1", "2026-06-01")],
      activeDayRows: [row("s1", "2026-06-02")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.activeDays).toBe(2); // union, not intersection
    expect(result.agenticDays).toBe(1);
    expect(result.ratePct).toBe(50);
  });

  it("rate can never exceed 100% (agentic ⊆ union by construction)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01"), row("s1", "2026-06-02")],
      activeDayRows: [row("s1", "2026-06-01")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.ratePct).toBe(100);
    expect(result.agenticDays).toBe(2);
    expect(result.activeDays).toBe(2);
  });

  it("rounds the rate to two decimals", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01")],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s2", "2026-06-01"),
        row("s3", "2026-06-01"),
      ],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.ratePct).toBeCloseTo(33.33, 2);
  });

  it("slices to the last AGENTIC_WINDOW_DAYS days ending at windowTo (review F7)", () => {
    const stale = "2026-01-05"; // far outside the 84-day window ending 2026-06-14
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", stale)],
      activeDayRows: [row("s1", stale), row("s2", "2026-06-02")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    // The stale agentic day is gone entirely — only s2's active day remains.
    expect(result).toEqual({
      kind: "noAgenticData",
      activeDays: 1,
      unresolvedSubjects: 0,
    });
    expect(AGENTIC_WINDOW_DAYS).toBe(84);
  });
});

describe("computeAgenticAdoption — per-vendor coverage", () => {
  it("counts distinct agentic person-days per source connector, sorted desc", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [
        row("s1", "2026-06-01", 1, "anthropic-console@1"),
        row("s1", "2026-06-02", 1, "anthropic-console@1"),
        row("s2", "2026-06-01", 1, "cursor@1"),
      ],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s1", "2026-06-02"),
        row("s2", "2026-06-01"),
      ],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.coveragePerVendor).toEqual([
      { sourceConnector: "anthropic-console@1", agenticDays: 2 },
      { sourceConnector: "cursor@1", agenticDays: 1 },
    ]);
  });
});

describe("computeAgenticAdoption — weekly trend, partial week, delta", () => {
  it("buckets complete Monday-anchored weeks and computes a per-week rate + delta", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [
        // Week 1 (Jun 1–7): 1 of 2 active person-days agentic → 50%.
        row("s1", "2026-06-01"),
        // Week 2 (Jun 8–14): 2 of 2 → 100%.
        row("s1", "2026-06-08"),
        row("s2", "2026-06-09"),
      ],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s2", "2026-06-02"),
        row("s1", "2026-06-08"),
        row("s2", "2026-06-09"),
      ],
      identityLinks: LINKS,
      windowTo: SUNDAY, // 2026-06-14 — both weeks complete
    });
    if (result.kind !== "measured") throw new Error("expected measured");

    expect(result.ratePct).toBe(75); // 3 of 4 overall
    expect(result.trend).toHaveLength(2);
    expect(result.trend[0]).toMatchObject({
      weekStart: "2026-06-01",
      label: "Jun 1–7",
      ratePct: 50,
      agenticDays: 1,
      activeDays: 2,
    });
    expect(result.trend[1]).toMatchObject({
      weekStart: "2026-06-08",
      ratePct: 100,
    });
    expect(result.weekToDate).toBeNull();
    expect(result.delta).toEqual({
      kind: "delta",
      current: 100,
      previous: 50,
      delta: 50,
      previousPeriodLabel: "Jun 1–7",
    });
  });

  it("splits the incomplete current week out of trend AND delta (review F3)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [
        // Two complete weeks at 100% and 50%...
        row("s1", "2026-06-01"),
        row("s1", "2026-06-08"),
        // ...then the current (incomplete) week has NO agent use yet.
      ],
      activeDayRows: [
        row("s1", "2026-06-01"),
        row("s1", "2026-06-08"),
        row("s2", "2026-06-09"),
        row("s1", "2026-06-15"), // current week, no agent activity yet
      ],
      identityLinks: LINKS,
      windowTo: "2026-06-16", // a Tuesday — week of Jun 15 is incomplete
    });
    if (result.kind !== "measured") throw new Error("expected measured");

    // Trend holds ONLY the two complete weeks — the 0%-so-far current week
    // never plots as a full-week plunge.
    expect(result.trend.map((p) => p.weekStart)).toEqual([
      "2026-06-01",
      "2026-06-08",
    ]);
    // Delta compares the complete weeks (100% → 50%), not the partial one.
    expect(result.delta).toMatchObject({
      kind: "delta",
      current: 50,
      previous: 100,
      delta: -50,
    });
    // The partial week is its own labeled point, spanning only elapsed days.
    expect(result.weekToDate).toMatchObject({
      weekStart: "2026-06-15",
      label: "Jun 15–16",
      ratePct: 0,
      agenticDays: 0,
      activeDays: 1,
    });
  });

  it("delta is `first` when fewer than two COMPLETE weeks exist, even with a week-to-date bucket", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-08"), row("s1", "2026-06-15")],
      activeDayRows: [row("s1", "2026-06-08"), row("s1", "2026-06-15")],
      identityLinks: LINKS,
      windowTo: "2026-06-16",
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend).toHaveLength(1);
    expect(result.weekToDate).not.toBeNull();
    expect(result.delta).toEqual({ kind: "first" });
  });

  it("omits weeks with no active person-days (never plots a 0% gap week)", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-01")],
      activeDayRows: [row("s1", "2026-06-01")],
      identityLinks: LINKS,
      windowTo: SUNDAY,
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend).toHaveLength(1);
    expect(result.delta).toEqual({ kind: "first" });
  });

  it("labels a cross-month week with both months", () => {
    const result = computeAgenticAdoption({
      agentActiveRows: [row("s1", "2026-06-30")],
      activeDayRows: [row("s1", "2026-06-30")],
      identityLinks: LINKS,
      windowTo: "2026-07-05", // Sunday — the Jun 29 week is complete
    });
    if (result.kind !== "measured") throw new Error("expected measured");
    expect(result.trend[0].weekStart).toBe("2026-06-29");
    expect(result.trend[0].label).toBe("Jun 29–Jul 5");
  });
});
