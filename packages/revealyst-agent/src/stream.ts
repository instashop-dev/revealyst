// Streaming session-file reader: feeds JSONL lines into the allowlist
// parser without ever materializing a whole file as one string. Documented
// multi-GB session files (claude-code#18905/#22365) exceed V8's ~0.5 GB
// string ceiling, so `readFileSync` throws before parsing — a line stream
// has no such ceiling. Unreadable files are counted, never fatal (the
// lenient-by-design rule from parse.ts).

import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createSessionParser, type ParseResult } from "./parse";

export type StreamParseResult = {
  parsed: ParseResult;
  /** Files that could not be opened/read (permissions, races) — reported
   * in the sync summary, mirroring the old readFileSync catch. */
  unreadableFiles: number;
};

export async function parseSessionFilesStreaming(
  paths: string[],
): Promise<StreamParseResult> {
  // Per-file accounting is all-or-nothing, mirroring the old readFileSync
  // semantics: a file that errors mid-read (rotation, truncation, revoked
  // permission) contributes NOTHING — its already-read prefix must not
  // leak partial events into the batch while the file is simultaneously
  // reported unreadable.
  const merged: ParseResult = { events: [], skippedLines: 0, unknownTypes: 0 };
  let unreadableFiles = 0;

  for (const path of paths) {
    // Open explicitly first so ENOENT/EACCES surface here, not as a late
    // async 'error' event racing the line loop.
    let handle;
    try {
      handle = await open(path, "r");
    } catch {
      unreadableFiles++;
      continue;
    }
    const parser = createSessionParser();
    try {
      const rl = createInterface({
        input: handle.createReadStream({ encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      // for-await propagates mid-read stream errors into the catch below.
      for await (const line of rl) {
        parser.pushLine(line);
      }
    } catch {
      unreadableFiles++;
      continue;
    } finally {
      // autoClose usually closed it already; double-close is a no-op error.
      await handle.close().catch(() => {});
    }
    const result = parser.finish();
    // No spread here: a multi-million-event file would overflow the stack.
    for (const event of result.events) {
      merged.events.push(event);
    }
    merged.skippedLines += result.skippedLines;
    merged.unknownTypes += result.unknownTypes;
  }

  return { parsed: merged, unreadableFiles };
}
