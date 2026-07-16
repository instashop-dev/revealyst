// Mechanical enforcement of the ADR numbering rule (docs/decisions/README.md):
// ADR numbers must be unique so "ADR NNNN" is a citable, unambiguous reference.
// With an agent fleet claiming numbers offline at build time, collisions happen
// (0009/0010, 0014×2 — see docs/decisions/README.md) — a machine check keeps new
// collisions from landing silently. Runs in CI; exits 1 on any duplicate.
//
//   node scripts/check-adr-numbers.mjs [dir]
//
// [dir] defaults to docs/decisions and exists only to make this script testable
// against a scratch copy of the ledger without touching the real one.
import { readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const PREFIX_RE = /^(\d{4})-/;

/**
 * The two bannered 0014 files are a deliberate, documented numbering collision
 * (see their own banners: "kept as-is because code comments cite 'ADR 0014' for
 * both... Cite 0014 by slug, never by bare number") — allowlisted here by exact
 * filename so this check doesn't fight a decision that's already recorded.
 */
const ALLOWLISTED_DUPLICATE_FILES = new Set([
  "0014-org-scope-batch-read-methods.md",
  "0014-personal-person-level-presets.md",
]);

export function findDuplicatePrefixes(filenames) {
  const byPrefix = new Map();
  for (const name of filenames) {
    if (!name.endsWith(".md")) continue;
    const match = PREFIX_RE.exec(name);
    if (!match) continue;
    const prefix = match[1];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
  }

  const duplicates = [];
  for (const [prefix, names] of byPrefix) {
    if (names.length <= 1) continue;
    const unallowlisted = names.filter(
      (name) => !ALLOWLISTED_DUPLICATE_FILES.has(name),
    );
    // A collision is only acceptable if every file sharing the prefix is one
    // of the two bannered 0014 files. Any other duplicate — including a third
    // file landing on 0014 — is a new, unrecorded collision and fails.
    if (unallowlisted.length > 0) {
      duplicates.push({ prefix, files: names });
    }
  }
  return duplicates;
}

const invokedDirectly = process.argv[1]?.endsWith("check-adr-numbers.mjs");
if (invokedDirectly) {
  const dirArg = process.argv[2];
  const dir = dirArg
    ? isAbsolute(dirArg)
      ? dirArg
      : join(process.cwd(), dirArg)
    : join(process.cwd(), "docs/decisions");
  const filenames = readdirSync(dir);
  const duplicates = findDuplicatePrefixes(filenames);
  if (duplicates.length > 0) {
    console.error("ADR numbering guard: duplicate prefixes detected\n");
    for (const { prefix, files } of duplicates) {
      console.error(`  ✗ ${prefix}: ${files.join(", ")}`);
    }
    process.exit(1);
  }
  console.log("ADR numbering guard: clean");
}
