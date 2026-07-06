// Session-log discovery (docs/connector-facts.md §5):
//   Windows  %USERPROFILE%\.claude\projects\<encoded-cwd>\<sessionId>.jsonl
//   mac/linux ~/.claude/projects/...
//   Also     ~/.config/claude/projects (ccusage parity)
//   Override CLAUDE_CONFIG_DIR — COMMA-separated multi-path (ccusage), NOT
//            the OS path delimiter (which would shred a Windows "C:\…" path
//            on POSIX and disagrees with the documented format).
// Subagent sidechains live at projects/<proj>/<sessionId>/subagents/*.jsonl
// and MUST be included (they carry their own usage) — hence a recursive scan.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type SessionFileRef = {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
};

/** Config dirs to scan. §5: "Agent must scan ~/.claude/projects,
 * ~/.config/claude/projects, and every CLAUDE_CONFIG_DIR path." The
 * override is additive (ccusage scans defaults + override), comma-split,
 * and the set is de-duplicated. Pure over its inputs for testability. */
export function claudeConfigDirs(
  env: Record<string, string | undefined>,
  homeDir: string,
): string[] {
  const dirs = [join(homeDir, ".claude"), join(homeDir, ".config", "claude")];
  const override = env.CLAUDE_CONFIG_DIR;
  if (override && override.trim() !== "") {
    for (const path of override.split(",")) {
      const trimmed = path.trim();
      if (trimmed !== "") {
        dirs.push(trimmed);
      }
    }
  }
  return [...new Set(dirs)];
}

/** Real layouts nest: sessions at projects/<proj>/*.jsonl, but subagent
 * sidechains at projects/<proj>/<sessionId>/subagents/*.jsonl (verified on
 * the founder's machine, where a flat scan missed 97 of 129 files — i.e.
 * ALL sidechain usage). Bounded depth guards against symlink cycles. */
const MAX_SCAN_DEPTH = 6;

/** All session .jsonl files under <dir>/projects/**, recursively, for each
 * config dir. Missing dirs are skipped silently — an empty machine is not
 * an error. */
export function listSessionFiles(configDirs: string[]): SessionFileRef[] {
  const refs: SessionFileRef[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) {
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) {
          walk(path, depth + 1);
        } else if (entry.endsWith(".jsonl")) {
          refs.push({ path, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Deleted between readdir and stat — skip.
      }
    }
  };
  for (const dir of configDirs) {
    walk(join(dir, "projects"), 0);
  }
  return refs.sort((a, b) => a.path.localeCompare(b.path));
}
