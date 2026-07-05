import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIngestRequest } from "../src/index";

// THE tripwire suite (rule 7: no prompt-content ingestion). The fixtures
// carry SENTINEL_* strings in every content-bearing position a real
// transcript has — prompt text, completions, tool inputs/outputs,
// attachments, titles, queue payloads, cwd, git branch. If ANY sentinel
// (or any non-allowlisted key) survives into the outgoing payload, the
// privacy promise is broken and this suite fails loudly.

const MAIN = readFileSync(
  "fixtures/vendor-payloads/claude-code-local/main-session.jsonl",
  "utf8",
);
const SIDE = readFileSync(
  "fixtures/vendor-payloads/claude-code-local/sidechain-session.jsonl",
  "utf8",
);

const payload = buildIngestRequest({
  sessionContents: [MAIN, SIDE],
  window: { start: "2026-07-01", end: "2026-07-31" },
  identity: {
    descriptor: {
      kind: "person",
      externalId: "dev@example.com",
      email: "dev@example.com",
      displayName: "Dev",
    },
    attribution: "person",
  },
  agentVersion: "0.1.0",
});
const serialized = JSON.stringify(payload);

/** Every key the ingest payload may contain — anything else is a leak. */
const KEY_ALLOWLIST = new Set([
  "agentVersion",
  "summarizerVersion",
  "window",
  "start",
  "end",
  "subjects",
  "records",
  "signals",
  "gaps",
  "kind",
  "externalId",
  "email",
  "displayName",
  "subject",
  "metricKey",
  "day",
  "dim",
  "value",
  "attribution",
  "hours",
  "peakConcurrency",
  "sourceGranularity",
  "detail",
]);

function collectKeys(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, into);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, val] of Object.entries(node)) {
      into.add(key);
      collectKeys(val, into);
    }
  }
}

describe("privacy: nothing content-shaped leaves the machine", () => {
  it("fixture guard: the fixtures really do contain the sentinels", () => {
    // If the fixtures rot, the sentinel assertions below prove nothing.
    for (const s of [
      "SENTINEL_PROMPT_ALPHA",
      "SENTINEL_COMPLETION_BETA",
      "SENTINEL_TOOL_INPUT",
      "SENTINEL_TOOL_STDOUT",
      "SENTINEL_TOOL_RESULT_CONTENT",
      "SENTINEL_ATTACHMENT_CONTENT",
      "SENTINEL_QUEUE_CONTENT",
      "SENTINEL_TITLE",
      "SENTINEL_LAST_PROMPT",
      "SENTINEL_PROJECT_PATH",
      "SENTINEL_BRANCH",
      "SENTINEL_UNKNOWN_TYPE",
    ]) {
      expect(MAIN).toContain(s);
    }
    expect(SIDE).toContain("SENTINEL_SIDECHAIN_PROMPT");
    expect(SIDE).toContain("SENTINEL_SIDECHAIN_TEXT");
  });

  it("no sentinel survives into the outgoing payload", () => {
    expect(serialized).not.toContain("SENTINEL");
  });

  it("every key in the payload is on the allowlist", () => {
    const keys = new Set<string>();
    collectKeys(payload, keys);
    const offLimits = [...keys].filter((k) => !KEY_ALLOWLIST.has(k));
    expect(offLimits).toEqual([]);
  });

  it("no transcript-structural fields leak (session ids, paths, branches)", () => {
    for (const banned of [
      "sessionId",
      "cwd",
      "gitBranch",
      "uuid",
      "parentUuid",
      "requestId",
      "toolUseResult",
      "message",
      "content",
    ]) {
      expect(serialized).not.toContain(`"${banned}"`);
    }
  });

  it("dims are strictly model labels, never free text", () => {
    for (const record of payload.records) {
      expect(record.dim).toMatch(/^$|^model=[A-Za-z0-9._@:-]+$/);
    }
  });

  it("string values are confined to enums, days, model dims, and the identity", () => {
    // Beyond keys, check VALUES: the only free-ish strings allowed are the
    // subject identity fields, gap details, and the agent version.
    const allowedExact = new Set([
      payload.agentVersion,
      "dev@example.com",
      "Dev",
      "person",
      "event",
    ]);
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const dimRe = /^$|^model=[A-Za-z0-9._@:-]+$/;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (typeof node === "object" && node !== null) {
        for (const [key, val] of Object.entries(node)) {
          if (typeof val === "string") {
            // Gap details, metric keys, and subject kinds are the only
            // legal strings beyond identity/enum/day/dim values.
            const legal =
              allowedExact.has(val) ||
              dayRe.test(val) ||
              dimRe.test(val) ||
              key === "detail" ||
              key === "metricKey" ||
              key === "kind";
            expect(legal, `unexpected string at ${key}: ${val}`).toBe(true);
          } else {
            walk(val);
          }
        }
      }
    };
    walk(payload);
  });
});
