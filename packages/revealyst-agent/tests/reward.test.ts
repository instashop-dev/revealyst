import { describe, expect, it } from "vitest";
import {
  composeSyncReward,
  summarizeBatchHighlights,
  transparencyUrl,
} from "../src/reward";
import type { AgentIngestRequest, MetricRecordInput } from "../src/types";

// W5-G deliverable 1: the same-click reward, composed from the server's
// echoed counts + one honesty-gated superlative from the just-built batch.
// The critical property is the HONESTY GATE: thin data yields no positive.

const personSubject = { kind: "person" as const, externalId: "dev@example.com" };

function record(
  day: string,
  metricKey: MetricRecordInput["metricKey"],
  dim = "",
): MetricRecordInput {
  return {
    subject: personSubject,
    metricKey,
    day,
    dim,
    value: 1,
    attribution: "person",
  };
}

function batch(records: MetricRecordInput[]): AgentIngestRequest {
  const days = [...new Set(records.map((r) => r.day))].sort();
  return {
    agentVersion: "0.0.0-test",
    summarizerVersion: 1,
    window: { start: days[0] ?? "2026-07-01", end: days.at(-1) ?? "2026-07-01" },
    subjects: [{ ...personSubject, email: "dev@example.com", displayName: null }],
    records,
    signals: days.map((day) => ({
      subject: personSubject,
      day,
      hours: null,
      peakConcurrency: 2,
      sourceGranularity: "event" as const,
    })),
    gaps: [],
  };
}

describe("summarizeBatchHighlights", () => {
  it("counts active days, distinct models, busiest day, peak concurrency", () => {
    const b = batch([
      record("2026-07-01", "active_day"),
      record("2026-07-01", "model_requests", "model=claude-opus-4-8"),
      record("2026-07-02", "active_day"),
      record("2026-07-02", "model_requests", "model=claude-haiku-4-5"),
      record("2026-07-02", "prompts"),
    ]);
    const h = summarizeBatchHighlights(b);
    expect(h.activeDays).toBe(2);
    expect(h.distinctModels).toBe(2);
    expect(h.busiestDay).toBe("2026-07-02"); // 3 records vs 2
    expect(h.peakConcurrency).toBe(2);
  });

  it("resolves a busiest-day tie to the earliest day, deterministically", () => {
    const b = batch([
      record("2026-07-02", "active_day"),
      record("2026-07-01", "active_day"),
    ]);
    expect(summarizeBatchHighlights(b).busiestDay).toBe("2026-07-01");
  });
});

describe("composeSyncReward headline (always factual)", () => {
  it("reports the echoed record count and active-day span with the window", () => {
    const b = batch([
      record("2026-07-01", "active_day"),
      record("2026-07-02", "active_day"),
    ]);
    const reward = composeSyncReward({
      records: 340,
      signals: 12,
      subjects: 1,
      window: b.window,
      highlights: summarizeBatchHighlights(b),
    });
    expect(reward.headline).toContain("captured 340 records");
    expect(reward.headline).toContain("2 active days");
    expect(reward.headline).toContain("2026-07-01 → 2026-07-02");
  });

  it("pluralizes a single record / single day correctly", () => {
    const b = batch([record("2026-07-01", "active_day")]);
    const reward = composeSyncReward({
      records: 1,
      signals: 0,
      subjects: 1,
      window: b.window,
      highlights: summarizeBatchHighlights(b),
    });
    expect(reward.headline).toContain("captured 1 record across 1 active day");
  });
});

describe("composeSyncReward positive (honesty gate)", () => {
  it("celebrates breadth when two or more models were used", () => {
    const b = batch([
      record("2026-07-01", "model_requests", "model=claude-opus-4-8"),
      record("2026-07-01", "model_requests", "model=claude-haiku-4-5"),
    ]);
    const reward = composeSyncReward({
      records: 2,
      signals: 1,
      subjects: 1,
      window: b.window,
      highlights: summarizeBatchHighlights(b),
    });
    expect(reward.positive).toContain("2 different models");
  });

  it("celebrates consistency at three or more active days (one model)", () => {
    const b = batch([
      record("2026-07-01", "active_day", ""),
      record("2026-07-01", "model_requests", "model=claude-opus-4-8"),
      record("2026-07-02", "active_day", ""),
      record("2026-07-02", "model_requests", "model=claude-opus-4-8"),
      record("2026-07-03", "active_day", ""),
      record("2026-07-03", "model_requests", "model=claude-opus-4-8"),
    ]);
    const reward = composeSyncReward({
      records: 6,
      signals: 3,
      subjects: 1,
      window: b.window,
      highlights: summarizeBatchHighlights(b),
    });
    expect(reward.positive).toContain("3 active days");
  });

  it("falls back to busiest-day when two days but one model", () => {
    const b = batch([
      record("2026-07-01", "active_day", ""),
      record("2026-07-01", "model_requests", "model=claude-opus-4-8"),
      record("2026-07-02", "active_day", ""),
      record("2026-07-02", "model_requests", "model=claude-opus-4-8"),
    ]);
    const reward = composeSyncReward({
      records: 4,
      signals: 2,
      subjects: 1,
      window: b.window,
      highlights: summarizeBatchHighlights(b),
    });
    expect(reward.positive).toContain("most active day");
  });

  it("emits NO positive on thin data: a single day with a single model", () => {
    const b = batch([
      record("2026-07-01", "active_day", ""),
      record("2026-07-01", "model_requests", "model=claude-opus-4-8"),
    ]);
    const reward = composeSyncReward({
      records: 2,
      signals: 1,
      subjects: 1,
      window: b.window,
      highlights: summarizeBatchHighlights(b),
    });
    expect(reward.positive).toBeNull();
    // The headline is still present and honest.
    expect(reward.headline).toContain("captured 2 records across 1 active day");
  });

  it("emits NO positive when the server echoed zero records", () => {
    const reward = composeSyncReward({
      records: 0,
      signals: 0,
      subjects: 1,
      window: { start: "2026-07-01", end: "2026-07-01" },
      highlights: {
        activeDays: 0,
        distinctModels: 0,
        busiestDay: null,
        peakConcurrency: null,
      },
    });
    expect(reward.positive).toBeNull();
  });
});

describe("transparencyUrl", () => {
  it("points at /connections on the configured API origin, trimming slashes", () => {
    expect(transparencyUrl("https://app.revealyst.com")).toBe(
      "https://app.revealyst.com/connections",
    );
    expect(transparencyUrl("https://custom.test/")).toBe(
      "https://custom.test/connections",
    );
  });
});
