import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// TMD P3 tail (ADR 0063) — the "decision log NEVER feeds scoring" pin, enforced
// STRUCTURALLY (the manager-notes-scoring-isolation pattern): no module on any
// scoring/derivation path may import the initiative-decisions table or its
// namespace methods. A decision is a management record (who/why), not telemetry;
// if it ever became a metric input, a manager's free-text note would silently
// launder into a per-person number (the invariant-(b) failure mode).
//
// The sweep reads SOURCE (imports + identifiers), not runtime behavior, so a
// future refactor that wires the log into an engine fails THIS test at the
// import site, before any number is produced. The tokens are decision-SPECIFIC
// (never the bare `initiatives`, which scoring may legitimately reference some
// day) so the pin stays precise.

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

const DECISION_TOKENS = [
  "initiativeDecisions",
  "initiative_decisions",
  "appendDecision",
  "listDecisions",
  "InitiativeDecisionRow",
];

describe("initiative decision log never feeds scoring (ADR 0063 structural pin)", () => {
  it("no scoring/deriveAttention/capability-state module references the decision-log table or methods", () => {
    const paths = scoringModulePaths();
    // Anti-vacuity: the sweep must actually cover the engine.
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.some((p) => p.includes("capability-state"))).toBe(true);

    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      for (const token of DECISION_TOKENS) {
        expect(
          source.includes(token),
          `${path} references "${token}" — scoring must never touch the initiative decision log (ADR 0063)`,
        ).toBe(false);
      }
    }
  });

  it("anti-vacuity: the tokens are real (the decision-log modules themselves match them)", () => {
    const schemaSource = readFileSync("src/db/schema/initiatives.ts", "utf8");
    expect(schemaSource).toMatch(/pgTable\(\s*"initiative_decisions"/);
    expect(schemaSource).toContain("export const initiativeDecisions");

    const namespaceSource = readFileSync(
      "src/db/org-scope/initiatives.ts",
      "utf8",
    );
    expect(namespaceSource).toContain("appendDecision");
    expect(namespaceSource).toContain("listDecisions");
    expect(namespaceSource).toContain("InitiativeDecisionRow");
  });

  it("the schema comment states the rule the sweep enforces", () => {
    const schemaSource = readFileSync("src/db/schema/initiatives.ts", "utf8");
    expect(schemaSource).toContain("NEVER FEEDS SCORING");
  });
});
