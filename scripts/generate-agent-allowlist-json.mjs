// Desktop Agent allowlist bridge (Desktop Agent plan T3.1; law 3).
//
// Projects `src/lib/agent-collection-schema.ts` — THE single source of truth
// for "what leaves the device" — into a checked-in JSON artifact the Rust
// desktop agent embeds at compile time (`desktop-agent/src-tauri/src/
// allowlist.rs` via `include_str!`). The desktop crate never imports TS
// (plan law 5: shared contracts cross via generated JSON under
// `desktop-agent/src-tauri/generated/`), so this file is the bridge.
//
// Run with the repo's standard TS-script runner (this .mjs imports a .ts
// module, which plain `node` cannot resolve):
//
//   npm run generate:desktop-allowlist        (= tsx scripts/generate-agent-allowlist-json.mjs)
//
// Output is DETERMINISTIC — fields sorted by name, object keys sorted,
// 2-space indent, trailing newline, LF endings (pinned by .gitattributes) —
// so `tests/desktop-allowlist-drift.test.ts` can compare the checked-in
// artifact byte-for-byte against a fresh render. Editing the TS schema
// without regenerating, or hand-editing the JSON, fails that test in CI.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  AGENT_COLLECTION_FIELDS,
  AGENT_NEVER_COLLECTED,
} from "../src/lib/agent-collection-schema";
import { AI_TOOL_IDS } from "../src/contracts/metrics";

export const GENERATED_RELATIVE_PATH = path.join(
  "desktop-agent",
  "src-tauri",
  "generated",
  "allowlist.json",
);

/** Recursively sort object keys so the render is order-independent. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])]),
    );
  }
  return value;
}

/**
 * Render the allowlist projection as the exact string that must be checked
 * in at `desktop-agent/src-tauri/generated/allowlist.json`. Pure — the drift
 * test calls this directly and compares bytes.
 *
 * The projection keeps FULL schema fidelity per field (name, label, sent,
 * plain-English purpose, and the CLI parser's sourceToken) plus the
 * never-collected list, so the desktop "what leaves the device" screen can
 * render from the same wording as the app panel and /legal/what-we-collect
 * (never a hand-written collection claim). `sent` is the schema's only
 * grouping: true = the field's VALUE leaves the device; false = read
 * on-device only and reduced to counts/buckets before any push.
 *
 * `closedEnums` (ADR 0057) crosses the CLOSED value sets for enum-valued sent
 * fields to the Rust crate through this same single bridge (plan law 5), so the
 * device validator rejects an out-of-set label (a smuggled snippet) against the
 * exact set the frozen contract defines — never a hand-mirrored copy. Today it
 * carries only `ai_tool_used` (the closed AI-app enum, AI_TOOL_IDS).
 */
export function renderDesktopAllowlistJson() {
  const doc = {
    "//":
      "GENERATED from src/lib/agent-collection-schema.ts + src/contracts/metrics.ts — do not edit; run npm run generate:desktop-allowlist",
    fields: [...AGENT_COLLECTION_FIELDS]
      .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
      .map((f) => ({
        field: f.field,
        label: f.label,
        purpose: f.purpose,
        sent: f.sent,
        sourceToken: f.sourceToken,
      })),
    neverCollected: [...AGENT_NEVER_COLLECTED],
    closedEnums: {
      ai_tool_used: [...AI_TOOL_IDS],
    },
  };
  return `${JSON.stringify(sortKeysDeep(doc), null, 2)}\n`;
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const outPath = path.join(repoRoot, GENERATED_RELATIVE_PATH);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderDesktopAllowlistJson(), "utf8");
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

// Only write when executed as a script — the drift test imports the pure
// render function without touching the filesystem. (A pathToFileURL
// comparison is brittle across tsx/Windows path forms; the entry-script
// basename is unambiguous here.)
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.basename(process.argv[1]) === "generate-agent-allowlist-json.mjs";

if (invokedDirectly) main();
