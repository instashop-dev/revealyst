import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeOtelMetrics } from "../src/lib/otel-ingest";

// W7-8: the OTLP decoder, exercised against the REAL founder-captured fixtures
// (rule 2 — build/test against recorded payloads, not synthetic). Proves the
// JSON-mapping quirks (string ints, nano timestamps) are handled and that only
// the recognized markers are emitted, aggregated per subject/marker/day.

function loadCaptured(prefix: string) {
  return readdirSync("fixtures/otel")
    .filter((f) => new RegExp(`^${prefix}-\\d+\\.captured\\.json$`).test(f))
    .map((f) => JSON.parse(readFileSync(`fixtures/otel/${f}`, "utf8")));
}

describe("decodeOtelMetrics — real captured fixtures", () => {
  const all = loadCaptured("metrics").flatMap(decodeOtelMetrics);

  it("emits otel_active_time records from the real active-time metric", () => {
    const active = all.filter((r) => r.metricKey === "otel_active_time");
    expect(active.length).toBeGreaterThan(0);
    for (const r of active) {
      expect(r.subjectKey.length).toBeGreaterThan(0);
      expect(r.day).toMatch(/^\d{4}-\d{2}-\d{2}$/); // valid UTC day
      expect(r.value).toBeGreaterThan(0); // whole seconds, summed
      expect(Number.isInteger(r.value)).toBe(true);
    }
  });

  it("aggregates within a payload — one row per (subject, marker, day)", () => {
    // Each fixture is one POST; the decoder aggregates within it (cross-POST
    // aggregation is the metric_records upsert's job, not the decoder's).
    for (const payload of loadCaptured("metrics")) {
      const recs = decodeOtelMetrics(payload);
      const keys = recs.map((r) => `${r.subjectKey}|${r.metricKey}|${r.day}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("only emits recognized marker keys (never fabricates)", () => {
    const allowed = new Set(["otel_active_time", "otel_edit_accepted", "otel_edit_rejected"]);
    expect(all.every((r) => allowed.has(r.metricKey))).toBe(true);
  });
});

describe("decodeOtelMetrics — quirks + robustness", () => {
  it("handles the string-int value quirk and delta summation", () => {
    const payload = {
      resourceMetrics: [
        {
          resource: { attributes: [{ key: "user.id", value: { stringValue: "u1" } }] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.active_time.total",
                  sum: {
                    aggregationTemporality: 1,
                    dataPoints: [
                      { asDouble: 5.2, timeUnixNano: "1784033220000000000" },
                      { asInt: "10", timeUnixNano: "1784033230000000000" }, // string int
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const out = decodeOtelMetrics(payload);
    // Both points are the same UTC day → summed: round(5.2)=5 + 10 = 15.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ subjectKey: "u1", metricKey: "otel_active_time", value: 15 });
  });

  it("splits code-edit decisions into accepted / rejected", () => {
    const dp = (decision: string) => ({
      asInt: "1",
      timeUnixNano: "1784033220000000000",
      attributes: [{ key: "decision", value: { stringValue: decision } }],
    });
    const out = decodeOtelMetrics({
      resourceMetrics: [
        {
          resource: { attributes: [{ key: "user.id", value: { stringValue: "u1" } }] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.code_edit_tool.decision",
                  sum: { aggregationTemporality: 1, dataPoints: [dp("accept"), dp("accept"), dp("reject")] },
                },
              ],
            },
          ],
        },
      ],
    });
    const accepted = out.find((r) => r.metricKey === "otel_edit_accepted");
    const rejected = out.find((r) => r.metricKey === "otel_edit_rejected");
    expect(accepted?.value).toBe(2);
    expect(rejected?.value).toBe(1);
  });

  it("returns [] for empty / unrecognized payloads (never throws, never fabricates)", () => {
    expect(decodeOtelMetrics({})).toEqual([]);
    expect(decodeOtelMetrics({ resourceMetrics: [] })).toEqual([]);
    expect(
      decodeOtelMetrics({
        resourceMetrics: [
          { scopeMetrics: [{ metrics: [{ name: "claude_code.token.usage", sum: { dataPoints: [] } }] }] },
        ],
      }),
    ).toEqual([]);
  });
});
