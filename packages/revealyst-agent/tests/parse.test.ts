import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSessionContent } from "../src/parse";

// Structural parser over the recorded-shape fixtures. Lenient: corrupted
// lines and unknown record types are counted, never fatal (format drift is
// the #1 operational risk for a local log reader).

const MAIN = readFileSync(
  "fixtures/vendor-payloads/claude-code-local/main-session.jsonl",
  "utf8",
);
const SIDE = readFileSync(
  "fixtures/vendor-payloads/claude-code-local/sidechain-session.jsonl",
  "utf8",
);

describe("parseSessionContent", () => {
  it("extracts events, counts corrupted and unknown lines", () => {
    const result = parseSessionContent(MAIN);
    // prompt, assistant, assistant(stream-dup), tool-result activity,
    // attachment activity, assistant, day-2 prompt+assistant, out-of-window
    // assistant = 9; titles/mode/queue ignored silently.
    expect(result.events).toHaveLength(9);
    expect(result.skippedLines).toBe(1); // the corrupted line
    expect(result.unknownTypes).toBe(1); // x-future-record
  });

  it("classifies human prompts vs tool-result carriers", () => {
    const result = parseSessionContent(MAIN);
    const prompts = result.events.filter((e) => e.kind === "prompt");
    const activity = result.events.filter((e) => e.kind === "activity");
    expect(prompts).toHaveLength(2); // one per day — tool_result user is NOT a prompt
    expect(activity).toHaveLength(2); // tool-result carrier + attachment
  });

  it("extracts assistant usage numbers, model, and a stream-stable dedup key", () => {
    const result = parseSessionContent(MAIN);
    const assistants = result.events.filter((e) => e.kind === "assistant");
    expect(assistants).toHaveLength(5);

    const streamed = assistants.filter(
      (a) => a.kind === "assistant" && a.dedupKey === "req-main-1",
    );
    expect(streamed).toHaveLength(2); // split turn shares the requestId
    // Parse keeps BOTH streamed lines verbatim (last-wins dedup is the
    // summarizer's job): the first is a partial, the last carries the
    // cumulative totals.
    if (streamed[0].kind === "assistant" && streamed[1].kind === "assistant") {
      expect(streamed[0].model).toBe("claude-fable-5");
      expect(streamed[0].usage).toEqual({
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
      });
      expect(streamed[1].usage).toEqual({
        input: 1200,
        output: 300,
        cacheRead: 5000,
        cacheWrite: 800,
      });
    }
  });

  it("sanitizes the model to a safe charset/length (no content smuggling)", () => {
    const hostile = JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-07-01T10:00:00.000Z",
      requestId: "r1",
      message: {
        id: "m1",
        model: "claude fable 5 <SENTINEL rotate AWS key>",
        usage: { input_tokens: 1 },
      },
    });
    const [event] = parseSessionContent(hostile).events;
    if (event.kind === "assistant") {
      // Bounding, not letter-stripping: no spaces/punctuation, safe charset,
      // length-capped. (A bare alphanumeric word survives — that residual is
      // documented; the model field is §5-allowlisted.)
      expect(event.model).not.toContain(" ");
      expect(event.model).not.toContain("<");
      expect(event.model!.length).toBeLessThanOrEqual(64);
      expect(event.model).toMatch(/^[A-Za-z0-9._:-]+$/);
    }
  });

  it("marks sidechain user records as activity, never prompts", () => {
    const result = parseSessionContent(SIDE);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].kind).toBe("activity");
    expect(result.events[0].isSidechain).toBe(true);
    expect(result.events[1].kind).toBe("assistant");
  });

  it("never carries content into parsed events (the privacy line)", () => {
    const serialized = JSON.stringify([
      ...parseSessionContent(MAIN).events,
      ...parseSessionContent(SIDE).events,
    ]);
    expect(serialized).not.toContain("SENTINEL");
  });

  it("handles empty and whitespace-only input", () => {
    expect(parseSessionContent("")).toEqual({
      events: [],
      skippedLines: 0,
      unknownTypes: 0,
    });
    expect(parseSessionContent("\n\n  \n").events).toHaveLength(0);
  });
});
