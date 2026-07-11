// Locks the R2-critical CLI invariant end-to-end: a push is NEVER
// attempted for an empty batch (zero events, or none within the window) —
// the declared window is authoritative server-side, so an empty push
// would erase captured history. Also locks the env-token dry-run rules.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { saveConfig } from "../src/config";
import type { PushResult } from "../src/push";
import { runSync, type SyncDeps } from "../src/sync-run";

const bareHome = mkdtempSync(join(tmpdir(), "rva-sync-none-"));
const loggedInHome = mkdtempSync(join(tmpdir(), "rva-sync-file-"));
saveConfig(loggedInHome, {
  token: "rva1.org.conn.filesecret",
  apiBaseUrl: "https://file.test",
  consentIdentity: false,
});
afterAll(() => {
  rmSync(bareHome, { recursive: true, force: true });
  rmSync(loggedInHome, { recursive: true, force: true });
});

const NOW = new Date("2026-07-11T12:00:00.000Z");

function promptEvent(day: string, session = "s1") {
  return {
    kind: "prompt" as const,
    sessionId: session,
    timestampMs: Date.parse(`${day}T09:00:00.000Z`),
    isSidechain: false,
  };
}

type Harness = {
  deps: SyncDeps;
  pushes: Array<{ apiBaseUrl: string; token: string; windowStart: string }>;
  logs: string[];
  warns: string[];
};

function harness(overrides: Partial<SyncDeps> = {}): Harness {
  const pushes: Harness["pushes"] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  const deps: SyncDeps = {
    homeDir: bareHome,
    env: {},
    defaultApi: "https://default.test",
    agentVersion: "0.0.0-test",
    deviceSeed: "host:test",
    now: () => NOW,
    listFiles: () => [{ path: "a.jsonl", sizeBytes: 1, mtimeMs: 0 }],
    parseFiles: async () => ({
      parsed: { events: [], skippedLines: 0, unknownTypes: 0 },
      unreadableFiles: 0,
    }),
    push: async (apiBaseUrl, token, batch): Promise<PushResult> => {
      pushes.push({ apiBaseUrl, token, windowStart: batch.window.start });
      return {
        ok: true,
        subjects: batch.subjects.length,
        records: batch.records.length,
        signals: batch.signals.length,
      };
    },
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    ...overrides,
  };
  return { deps, pushes, logs, warns };
}

const ENV_TOKEN = { REVEALYST_TOKEN: "rva1.org.conn.envsecret" };

describe("runSync push guards", () => {
  it("zero parseable events → no push, friendly message", async () => {
    const h = harness({ env: ENV_TOKEN });
    const outcome = await runSync({ days: 30, dryRun: false }, h.deps);
    expect(outcome).toEqual({ kind: "ok" });
    expect(h.pushes).toHaveLength(0);
    expect(h.logs.join("\n")).toContain("No parseable Claude Code activity");
  });

  it("events exist but none within the window → no push, nothing deleted", async () => {
    const h = harness({
      env: ENV_TOKEN,
      parseFiles: async () => ({
        parsed: {
          events: [promptEvent("2026-01-05")],
          skippedLines: 0,
          unknownTypes: 0,
        },
        unreadableFiles: 0,
      }),
    });
    const outcome = await runSync({ days: 30, dryRun: false }, h.deps);
    expect(outcome).toEqual({ kind: "ok" });
    expect(h.pushes).toHaveLength(0);
    expect(h.logs.join("\n")).toContain("nothing was deleted or pushed");
  });

  it("happy path pushes once with the PINNED window", async () => {
    const h = harness({
      env: ENV_TOKEN,
      parseFiles: async () => ({
        parsed: {
          events: [promptEvent("2026-07-01"), promptEvent("2026-07-10", "s2")],
          skippedLines: 0,
          unknownTypes: 0,
        },
        unreadableFiles: 0,
      }),
    });
    const outcome = await runSync({ days: 30, dryRun: false }, h.deps);
    expect(outcome).toEqual({ kind: "ok" });
    expect(h.pushes).toEqual([
      {
        apiBaseUrl: "https://default.test",
        token: "rva1.org.conn.envsecret",
        // Requested start would be 2026-06-12 (30d before NOW); the
        // earliest surviving event day wins.
        windowStart: "2026-07-01",
      },
    ]);
    expect(h.logs.join("\n")).toContain("Window pinned to 2026-07-01");
  });

  it("dry run builds the summary but never pushes", async () => {
    const h = harness({
      homeDir: loggedInHome,
      parseFiles: async () => ({
        parsed: {
          events: [promptEvent("2026-07-10")],
          skippedLines: 0,
          unknownTypes: 0,
        },
        unreadableFiles: 0,
      }),
    });
    const outcome = await runSync({ days: 30, dryRun: true }, h.deps);
    expect(outcome).toEqual({ kind: "ok" });
    expect(h.pushes).toHaveLength(0);
    expect(h.logs.join("\n")).toContain("Dry run — nothing pushed.");
  });
});

describe("runSync credential rules", () => {
  it("no credentials and not a dry run → fail before any I/O matters", async () => {
    const h = harness();
    const outcome = await runSync({ days: 30, dryRun: false }, h.deps);
    expect(outcome.kind).toBe("fail");
    expect(h.pushes).toHaveLength(0);
  });

  it("dry run needs no credentials at all", async () => {
    const h = harness();
    const outcome = await runSync({ days: 30, dryRun: true }, h.deps);
    expect(outcome).toEqual({ kind: "ok" });
  });

  it("malformed REVEALYST_TOKEN: fails a real sync, warns through a dry run", async () => {
    const bad = { REVEALYST_TOKEN: "not-a-token" };
    const real = harness({ env: bad });
    expect((await runSync({ days: 30, dryRun: false }, real.deps)).kind).toBe(
      "fail",
    );

    const dry = harness({ env: bad });
    const outcome = await runSync({ days: 30, dryRun: true }, dry.deps);
    expect(outcome).toEqual({ kind: "ok" });
    expect(dry.warns.join("\n")).toContain("REVEALYST_TOKEN is set but malformed");
    expect(dry.pushes).toHaveLength(0);
  });
});
