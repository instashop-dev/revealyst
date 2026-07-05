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

/** All session .jsonl files under <dir>/projects/<encoded-cwd>/ for each
 * config dir. Missing dirs are skipped silently — an empty machine is not
 * an error. */
export function listSessionFiles(configDirs: string[]): SessionFileRef[] {
  const refs: SessionFileRef[] = [];
  for (const dir of configDirs) {
    const projectsDir = join(dir, "projects");
    let projectEntries: string[];
    try {
      projectEntries = readdirSync(projectsDir);
    } catch {
      continue;
    }
    for (const project of projectEntries) {
      const projectPath = join(projectsDir, project);
      let files: string[];
      try {
        if (!statSync(projectPath).isDirectory()) {
          continue;
        }
        files = readdirSync(projectPath);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }
        const path = join(projectPath, file);
        try {
          const stat = statSync(path);
          refs.push({ path, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // Deleted between readdir and stat — skip.
        }
      }
    }
  }
  return refs.sort((a, b) => a.path.localeCompare(b.path));
}
