import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D-TCI-7 (ADR 0053) — the "notes NEVER feed scoring" pin, enforced
// STRUCTURALLY: no module on any scoring/derivation path may import the
// manager-notes table or namespace. A note is human coaching content; if it
// ever became a metric input, a manager's free-text opinion would silently
// launder into a per-person number (the exact invariant-(b) failure mode).
//
// The sweep reads SOURCE (imports + identifiers), not runtime behavior, so a
// future refactor that wires notes into an engine fails THIS test at the
// import site, before any number is produced.

/** Every scoring/derivation module: the whole scoring engine (evaluate,
 * recompute, capability-state, mission-progress, segments, insights
 * generators, …) plus the two derivation modules that live in lib —
 * deriveAttention (score-insights) and the utility ranker (recommendation-
 * catalog). */
function scoringModulePaths(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk("src/scoring");
  files.push("src/lib/score-insights.ts"); // deriveAttention
  files.push("src/lib/recommendation-catalog.ts"); // computeUtility ranker
  return files;
}

const NOTES_TOKENS = [
  "managerNotes",
  "manager_notes",
  "manager-notes",
  "ManagerNoteRow",
];

describe("manager notes never feed scoring (ADR 0053 structural pin)", () => {
  it("no scoring/deriveAttention/capability-state module references the notes table or namespace", () => {
    const paths = scoringModulePaths();
    // Anti-vacuity: the sweep must actually cover the engine.
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.some((p) => p.includes("capability-state"))).toBe(true);

    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      for (const token of NOTES_TOKENS) {
        expect(
          source.includes(token),
          `${path} references "${token}" — scoring must never touch manager notes (ADR 0053)`,
        ).toBe(false);
      }
    }
  });

  it("anti-vacuity: the tokens are real (the notes modules themselves match them)", () => {
    // If the table/namespace were renamed, the sweep above would silently pass
    // on stale tokens — this leg fails instead, forcing the token list to
    // follow the rename.
    const namespaceSource = readFileSync(
      "src/db/org-scope/manager-notes.ts",
      "utf8",
    );
    expect(namespaceSource).toContain("managerNotesNamespace");
    expect(namespaceSource).toContain("ManagerNoteRow");
    const schemaSource = readFileSync("src/db/schema/core.ts", "utf8");
    expect(schemaSource).toMatch(/pgTable\(\s*"manager_notes"/);
    expect(schemaSource).toContain("export const managerNotes");
  });

  it("the schema comment states the rule the sweep enforces", () => {
    const schemaSource = readFileSync("src/db/schema/core.ts", "utf8");
    expect(schemaSource).toContain(
      "NEVER feeds scoring, deriveAttention, or capability state",
    );
  });
});
