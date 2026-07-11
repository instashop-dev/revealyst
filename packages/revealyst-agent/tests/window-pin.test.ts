// Fix 1 (plan R2): the declared window is authoritative server-side
// (delete-then-upsert), so buildIngestRequest must pin window.start to the
// earliest surviving event day — a lookback wider than local log retention
// must never declare (and thereby erase) days it has no evidence for.

import { describe, expect, it } from "vitest";
import { buildIngestRequest, type BuildOptions } from "../src/index";

const IDENTITY: BuildOptions["identity"] = {
  descriptor: {
    kind: "account",
    externalId: "device:abcdef0123456789",
    email: null,
    displayName: null,
  },
  attribution: "account",
};

function promptLine(day: string, session = "s1"): string {
  return JSON.stringify({
    type: "user",
    sessionId: session,
    timestamp: `${day}T09:00:00.000Z`,
  });
}

function build(contents: string[], window: { start: string; end: string }) {
  return buildIngestRequest({
    sessionContents: contents,
    window,
    identity: IDENTITY,
    agentVersion: "0.0.0-test",
  });
}

describe("window pinning", () => {
  it("pins start to the earliest surviving event day when the lookback is wider", () => {
    const batch = build([promptLine("2026-06-20"), promptLine("2026-06-22")], {
      start: "2026-05-25",
      end: "2026-06-22",
    });
    expect(batch.window).toEqual({ start: "2026-06-20", end: "2026-06-22" });
    // Everything summarized falls inside the pinned window.
    for (const record of batch.records) {
      expect(record.day >= batch.window.start).toBe(true);
      expect(record.day <= batch.window.end).toBe(true);
    }
    expect(batch.records.length).toBeGreaterThan(0);
  });

  it("leaves the window alone when evidence reaches back past the requested start", () => {
    const batch = build([promptLine("2026-05-01"), promptLine("2026-06-22")], {
      start: "2026-06-01",
      end: "2026-06-22",
    });
    expect(batch.window).toEqual({ start: "2026-06-01", end: "2026-06-22" });
  });

  it("passes the requested window through with zero events (caller must not push)", () => {
    const batch = build([], { start: "2026-06-01", end: "2026-06-22" });
    expect(batch.window).toEqual({ start: "2026-06-01", end: "2026-06-22" });
    expect(batch.records).toHaveLength(0);
  });

  it("clamps to end when every surviving event is after the window end", () => {
    const batch = build([promptLine("2026-07-05")], {
      start: "2026-06-01",
      end: "2026-06-22",
    });
    expect(batch.window).toEqual({ start: "2026-06-22", end: "2026-06-22" });
    // Nothing falls inside → empty batch; the CLI aborts rather than push.
    expect(batch.records).toHaveLength(0);
  });

  it("accepts pre-parsed events (streaming path) identically to sessionContents", () => {
    const contents = [promptLine("2026-06-20")];
    const viaStrings = build(contents, {
      start: "2026-05-25",
      end: "2026-06-22",
    });
    const viaParsed = buildIngestRequest({
      parsed: {
        events: [
          {
            kind: "prompt",
            sessionId: "s1",
            timestampMs: Date.parse("2026-06-20T09:00:00.000Z"),
            isSidechain: false,
          },
        ],
        skippedLines: 0,
        unknownTypes: 0,
      },
      window: { start: "2026-05-25", end: "2026-06-22" },
      identity: IDENTITY,
      agentVersion: "0.0.0-test",
    });
    expect(viaParsed.window).toEqual(viaStrings.window);
    expect(viaParsed.records).toEqual(viaStrings.records);
    expect(viaParsed.signals).toEqual(viaStrings.signals);
  });
});
