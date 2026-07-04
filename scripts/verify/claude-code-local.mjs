// W0-A live verification — Claude Code local transcript logs.
// Run on macOS/Linux machines (Windows already verified 2026-07-04).
// Covers NLV-L1, L4, L5, L8. Read-only; NEVER prints message content —
// only key names, type names, counters, and version strings.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONTENT_KEYS = new Set(["message", "toolUseResult", "lastPrompt", "aiTitle", "attachment", "content", "slug"]);

const roots = [];
if (process.env.CLAUDE_CONFIG_DIR) roots.push(...process.env.CLAUDE_CONFIG_DIR.split(",").map((s) => s.trim()));
roots.push(join(homedir(), ".claude"), join(homedir(), ".config", "claude"));

console.log(`platform: ${process.platform}`);

for (const root of roots) {
  const projects = join(root, "projects");
  console.log(`\n[L1] root ${root}: exists=${existsSync(root)} projects=${existsSync(projects)}`);
  if (!existsSync(projects)) continue;

  const dirs = readdirSync(projects).slice(0, 50);
  console.log(`[L1] project-dir encoding samples (POSIX cwd encoding check): ${JSON.stringify(dirs.slice(0, 5))}`);

  const typeCounts = {};
  const versions = new Set();
  const entrypoints = new Set();
  const requestIdCounts = new Map();
  let legacyCostUSD = 0, legacySummary = 0, files = 0, records = 0;

  for (const dir of dirs) {
    const dpath = join(projects, dir);
    if (!statSync(dpath).isDirectory()) continue;
    for (const f of readdirSync(dpath).filter((x) => x.endsWith(".jsonl")).slice(0, 30)) {
      files++;
      const lines = readFileSync(join(dpath, f), "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        records++;
        typeCounts[rec.type] = (typeCounts[rec.type] ?? 0) + 1;      // L8: summary type?
        if (rec.version) versions.add(rec.version);
        if (rec.entrypoint) entrypoints.add(rec.entrypoint);          // L4
        if (rec.costUSD !== undefined) legacyCostUSD++;               // L8
        if (rec.type === "summary") legacySummary++;
        if (rec.requestId) requestIdCounts.set(rec.requestId, (requestIdCounts.get(rec.requestId) ?? 0) + 1); // L5
        // Sanity: assert we never accidentally serialize content keys.
        for (const k of Object.keys(rec)) if (CONTENT_KEYS.has(k)) { /* structural presence only */ }
      }
    }
  }

  const dupRequestIds = [...requestIdCounts.values()].filter((n) => n > 1).length;
  console.log(`[L4] files=${files} records=${records}`);
  console.log(`[L4] record types: ${JSON.stringify(typeCounts)}`);
  console.log(`[L4] versions seen: ${JSON.stringify([...versions])}`);
  console.log(`[L4] entrypoints seen: ${JSON.stringify([...entrypoints])}`);
  console.log(`[L5] requestIds appearing >1×: ${dupRequestIds} of ${requestIdCounts.size} (streaming-duplicate check)`);
  console.log(`[L8] legacy fields: costUSD on ${legacyCostUSD} records; 'summary' type on ${legacySummary} records`);
}

console.log(`\n[L2] MANUAL: set CLAUDE_CONFIG_DIR to a custom path, start Claude Code, confirm transcripts land there (and whether comma-separated multi-path is honored by Claude Code itself, not just ccusage).`);
console.log(`[L3] MANUAL: note .claude/.last-cleanup timestamp before/after restarting Claude Code with an old-mtime transcript present; determine mtime-vs-record-age semantics and whether subagent dirs are pruned with the parent session.`);
console.log(`[L7] MANUAL: run one prompt that triggers a retry/tool iteration; inspect usage.iterations[] on the resulting assistant record to pin its semantics.`);
