// Session-log discovery (docs/connector-facts.md §5):
//   Windows  %USERPROFILE%\.claude\projects\<encoded-cwd>\<sessionId>.jsonl
//   mac/linux ~/.claude/projects/...
//   Override  CLAUDE_CONFIG_DIR (may hold several paths, platform-delimited)
// Subagent sidechains are separate .jsonl files in the same directories and
// MUST be included (they carry their own usage).

import { readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export type SessionFileRef = {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
};

/** Config dirs to scan, in order. Pure over its inputs for testability. */
export function claudeConfigDirs(
  env: Record<string, string | undefined>,
  homeDir: string,
): string[] {
  const override = env.CLAUDE_CONFIG_DIR;
  if (override && override.trim() !== "") {
    return override
      .split(delimiter)
      .map((p) => p.trim())
      .filter((p) => p !== "");
  }
  return [join(homeDir, ".claude")];
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
