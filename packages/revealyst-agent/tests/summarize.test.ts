import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSessionContent } from "../src/parse";
import { summarize } from "../src/summarize";
import type { MetricRecordInput } from "../src/types";

// The pure summarizer over the recorded-shape fixtures: known-truth sums,
// requestId dedup, sidechain inclusion, UTC day bucketing, window
// filtering, hour histograms + peak concurrency, and determinism.

const MAIN = readFileSync(
  "fixtures/vendor-payloads/claude-code-local/main-session.jsonl",
  "utf8",
);
const SIDE = readFileSync(
  "fixtures/vendor-payloads/claude-code-local/sidechain-session.jsonl",
  "utf8",
);

const SUBJECT = { kind: "person", externalId: "dev@example.com" } as const;
const OPTS = {
  subject: SUBJECT,
  attribution: "person" as const,
  window: { start: "2026-07-01", end: "2026-07-31" },
};

function allEvents() {
  return [
    ...parseSessionContent(MAIN).events,
    ...parseSessionContent(SIDE).events,
  ];
}

function value(
  records: MetricRecordInput[],
  metricKey: string,
  day: string,
  dim = "",
): number | undefined {
  return records.find(
    (r) => r.metricKey === metricKey && r.day === day && r.dim === dim,
  )?.value;
}

describe("summarize", () => {
  const summary = summarize(allEvents(), OPTS);

  it("computes known-truth token sums (dedup by requestId, sidechain included)", () => {
    // Day 1: main 1200+400 (streamed dup counted ONCE) + sidechain 2000.
    expect(value(summary.records, "tokens_input", "2026-07-01")).toBe(3600);
    expect(value(summary.records, "tokens_output", "2026-07-01")).toBe(900);
    expect(value(summary.records, "tokens_cache_read", "2026-07-01")).toBe(5100);
    expect(value(summary.records, "tokens_cache_write", "2026-07-01")).toBe(800);
    // Day 2.
    expect(value(summary.records, "tokens_input", "2026-07-02")).toBe(100);
    expect(value(summary.records, "tokens_output", "2026-07-02")).toBe(50);
  });

  it("counts sessions, prompts, and active days", () => {
    expect(value(summary.records, "sessions", "2026-07-01")).toBe(2); // main + sidechain
    expect(value(summary.records, "sessions", "2026-07-02")).toBe(1);
    expect(value(summary.records, "prompts", "2026-07-01")).toBe(1); // tool-result ≠ prompt
    expect(value(summary.records, "prompts", "2026-07-02")).toBe(1);
    expect(value(summary.records, "active_day", "2026-07-01")).toBe(1);
  });

  it("splits model mix into dims, one request per deduped turn", () => {
    expect(
      value(summary.records, "model_requests", "2026-07-01", "model=claude-fable-5"),
    ).toBe(1);
    expect(
      value(summary.records, "model_requests", "2026-07-01", "model=claude-sonnet-5"),
    ).toBe(1);
    expect(
      value(
        summary.records,
        "model_requests",
        "2026-07-01",
        "model=claude-haiku-4-5-20251001",
      ),
    ).toBe(1);
    expect(
      value(summary.records, "model_tokens", "2026-07-01", "model=claude-fable-5"),
    ).toBe(1500);
    expect(
      value(
        summary.records,
        "model_tokens",
        "2026-07-01",
        "model=claude-haiku-4-5-20251001",
      ),
    ).toBe(2500);
  });

  it("estimates spend from list prices (known truth, cents)", () => {
    // fable@opus 6.30 + sonnet 0.27 + haiku 0.451 = 7.021 → 7.02
    expect(
      value(summary.records, "spend_cents_estimated", "2026-07-01"),
    ).toBeCloseTo(7.02, 1);
    expect(summary.gaps.some((g) => g.detail?.includes("list prices"))).toBe(
      true,
    );
  });

  it("excludes events outside the window (no silent backfill leak)", () => {
    // The 2026-06-25 record carries 999999 tokens — any leak is loud.
    expect(summary.records.every((r) => r.day >= "2026-07-01")).toBe(true);
    expect(value(summary.records, "tokens_input", "2026-06-25")).toBeUndefined();
  });

  it("builds hour histograms and peak concurrency from event timestamps", () => {
    const day1 = summary.signals.find((s) => s.day === "2026-07-01")!;
    expect(day1.hours?.[9]).toBe(7); // 5 main + 2 sidechain events at 09:xx UTC
    expect(day1.hours?.[10]).toBe(1);
    expect(day1.hours?.reduce((a, b) => a + b, 0)).toBe(8);
    expect(day1.peakConcurrency).toBe(2); // main + sidechain overlap at 09:xx
    expect(day1.sourceGranularity).toBe("event");

    const day2 = summary.signals.find((s) => s.day === "2026-07-02")!;
    expect(day2.hours?.[8]).toBe(2);
    expect(day2.peakConcurrency).toBe(1);
  });

  it("stamps every record with the caller's subject and attribution", () => {
    expect(
      summary.records.every(
        (r) =>
          r.subject.externalId === SUBJECT.externalId &&
          r.attribution === "person",
      ),
    ).toBe(true);
  });

  it("is deterministic over the same events (pure)", () => {
    expect(summarize(allEvents(), OPTS)).toEqual(summary);
  });

  it("narrows correctly to a single-day window", () => {
    const single = summarize(allEvents(), {
      ...OPTS,
      window: { start: "2026-07-02", end: "2026-07-02" },
    });
    expect(single.signals).toHaveLength(1);
    expect(value(single.records, "tokens_input", "2026-07-02")).toBe(100);
    expect(value(single.records, "tokens_input", "2026-07-01")).toBeUndefined();
  });
});
