import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseSessionContent } from "../src/parse";
import { parseSessionFilesStreaming } from "../src/stream";

const dir = mkdtempSync(join(tmpdir(), "rva-stream-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const LINES = [
  JSON.stringify({
    type: "user",
    sessionId: "s1",
    timestamp: "2026-07-03T09:00:00.000Z",
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    timestamp: "2026-07-03T09:01:00.000Z",
    requestId: "req-1",
    message: {
      model: "claude-fable-5",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  }),
  "not json at all",
  JSON.stringify({ type: "mystery", sessionId: "s1", timestamp: "2026-07-03T09:02:00.000Z" }),
  "",
];

describe("streaming session-file parser", () => {
  it("is line-for-line equivalent to the whole-string parser (LF and CRLF)", async () => {
    const lf = join(dir, "a.jsonl");
    const crlf = join(dir, "b.jsonl");
    writeFileSync(lf, LINES.join("\n"));
    writeFileSync(crlf, LINES.join("\r\n"));

    const expected = parseSessionContent(LINES.join("\n"));
    for (const path of [lf, crlf]) {
      const { parsed, unreadableFiles } = await parseSessionFilesStreaming([
        path,
      ]);
      expect(unreadableFiles).toBe(0);
      expect(parsed).toEqual(expected);
    }
    // Sanity: the fixture actually exercises all three counters.
    expect(expected.events.length).toBeGreaterThan(0);
    expect(expected.skippedLines).toBe(1);
    expect(expected.unknownTypes).toBe(1);
  });

  it("accumulates across files and counts unreadable ones without failing", async () => {
    const one = join(dir, "one.jsonl");
    writeFileSync(one, LINES.join("\n"));
    const { parsed, unreadableFiles } = await parseSessionFilesStreaming([
      one,
      join(dir, "does-not-exist.jsonl"),
      one,
    ]);
    expect(unreadableFiles).toBe(1);
    const single = parseSessionContent(LINES.join("\n"));
    expect(parsed.events).toHaveLength(single.events.length * 2);
    expect(parsed.skippedLines).toBe(single.skippedLines * 2);
    expect(parsed.unknownTypes).toBe(single.unknownTypes * 2);
  });
});
