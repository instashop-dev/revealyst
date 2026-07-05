import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeConfigDirs, listSessionFiles } from "../src/discover";

// Discovery over real directories (native Windows paths on the dev
// machine — the free Win coverage the playbook calls for).

const scratch = mkdtempSync(join(tmpdir(), "rva-discover-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("claudeConfigDirs", () => {
  it("defaults to both ~/.claude and ~/.config/claude (§5 ccusage parity)", () => {
    expect(claudeConfigDirs({}, "/home/dev")).toEqual([
      join("/home/dev", ".claude"),
      join("/home/dev", ".config", "claude"),
    ]);
  });

  it("adds CLAUDE_CONFIG_DIR paths (COMMA-separated), keeping the defaults", () => {
    const dirA = join(scratch, "override-a");
    const dirB = join(scratch, "override-b");
    // §5: the override is additive and comma-delimited (NOT the OS path
    // delimiter, which would shred a Windows "C:\…" path on POSIX).
    expect(
      claudeConfigDirs({ CLAUDE_CONFIG_DIR: `${dirA},${dirB}` }, "/home/dev"),
    ).toEqual([
      join("/home/dev", ".claude"),
      join("/home/dev", ".config", "claude"),
      dirA,
      dirB,
    ]);
  });

  it("ignores a blank override and de-duplicates", () => {
    expect(claudeConfigDirs({ CLAUDE_CONFIG_DIR: "  " }, "/home/dev")).toEqual([
      join("/home/dev", ".claude"),
      join("/home/dev", ".config", "claude"),
    ]);
    // An override naming a default path must not duplicate it.
    const dflt = join("/home/dev", ".claude");
    expect(
      claudeConfigDirs({ CLAUDE_CONFIG_DIR: dflt }, "/home/dev"),
    ).toEqual([dflt, join("/home/dev", ".config", "claude")]);
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
