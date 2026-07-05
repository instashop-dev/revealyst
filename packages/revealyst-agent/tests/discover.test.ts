import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeConfigDirs, listSessionFiles } from "../src/discover";

// Discovery over real directories (native Windows paths on the dev
// machine — the free Win coverage the playbook calls for).

const scratch = mkdtempSync(join(tmpdir(), "rva-discover-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("claudeConfigDirs", () => {
  it("defaults to <home>/.claude", () => {
    expect(claudeConfigDirs({}, "C:\\Users\\dev")).toEqual([
      join("C:\\Users\\dev", ".claude"),
    ]);
  });

  it("honors CLAUDE_CONFIG_DIR, including multi-path values", () => {
    // Colon-free paths: CI runs this on Linux too, where the delimiter is
    // ":" and a Windows drive letter would split. Real Windows overrides
    // use ";" so drive letters are safe there.
    const dirA = join(scratch, "override-a");
    const dirB = join(scratch, "override-b");
    expect(claudeConfigDirs({ CLAUDE_CONFIG_DIR: dirA }, "/home/dev")).toEqual([
      dirA,
    ]);
    const multi = [dirA, dirB].join(delimiter);
    expect(claudeConfigDirs({ CLAUDE_CONFIG_DIR: multi }, "/home/dev")).toEqual(
      [dirA, dirB],
    );
  });

  it("falls back to the default when the override is blank", () => {
    expect(claudeConfigDirs({ CLAUDE_CONFIG_DIR: "  " }, "/home/dev")).toEqual([
      join("/home/dev", ".claude"),
    ]);
  });
});

describe("listSessionFiles", () => {
  it("finds session files recursively, including nested subagent transcripts", () => {
    const configDir = join(scratch, "config");
    const projA = join(configDir, "projects", "C--Users-dev-repo-a");
    const projB = join(configDir, "projects", "C--Users-dev-repo-b");
    // The real layout found on the founder's machine: sidechains live at
    // projects/<proj>/<sessionId>/subagents/*.jsonl — a flat scan missed
    // 97 of 129 real files (all sidechain usage). Never regress this.
    const subagents = join(projA, "4d0e7731-uuid", "subagents");
    mkdirSync(subagents, { recursive: true });
    mkdirSync(projB, { recursive: true });
    writeFileSync(join(projA, "session-1.jsonl"), '{"type":"user"}\n');
    writeFileSync(join(projA, "notes.txt"), "not a session");
    writeFileSync(join(subagents, "agent-1.jsonl"), '{"type":"assistant"}\n');
    writeFileSync(join(projB, "session-2.jsonl"), '{"type":"assistant"}\n');

    const refs = listSessionFiles([configDir]);
    expect(refs.map((r) => r.path)).toEqual([
      join(subagents, "agent-1.jsonl"),
      join(projA, "session-1.jsonl"),
      join(projB, "session-2.jsonl"),
    ]);
    expect(refs[0].sizeBytes).toBeGreaterThan(0);
    expect(refs[0].mtimeMs).toBeGreaterThan(0);
  });

  it("treats a missing config dir as an empty machine, not an error", () => {
    expect(listSessionFiles([join(scratch, "does-not-exist")])).toEqual([]);
  });

  it("merges results across multiple config dirs", () => {
    const dirA = join(scratch, "multi-a");
    const dirB = join(scratch, "multi-b");
    for (const [dir, name] of [
      [dirA, "a.jsonl"],
      [dirB, "b.jsonl"],
    ] as const) {
      const proj = join(dir, "projects", "p");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, name), "{}\n");
    }
    const refs = listSessionFiles([dirA, dirB]);
    expect(refs).toHaveLength(2);
  });
});
