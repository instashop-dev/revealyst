import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Side-effect import: registers every shipped connector (server context), so
// registeredVendors() and getConnector() are populated below.
import "../src/connectors";
import { getConnector, registeredVendors } from "../src/connectors/registry";
import { SCOPE_CLAIMS } from "../src/connectors/scope-claims";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// U2 — scope-claims completeness + "no hard-coded vendor prose in pages".
//
// scope-claims.ts is a CLAIM SURFACE (invariant b / W3-N / W3-P): the app's
// "what this connector can and can't measure" copy must live here (fact-checked
// against docs/connector-facts.md) and be RENDERED by the pages, never
// re-typed as string literals inside a page — the same discipline the landing
// "Connects" strip follows (derives from the registry, never hard-codes).

function readSrc(relFromRepoRoot: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relFromRepoRoot}`, import.meta.url)),
    "utf8",
  );
}

describe("scope-claims completeness", () => {
  it("every registered connector has non-empty measures and cannotMeasure on its registry entry", () => {
    for (const vendor of registeredVendors()) {
      const claims = getConnector(vendor)?.scopeClaims;
      expect(claims, `${vendor} has no scopeClaims on its registry entry`).toBeDefined();
      expect(
        claims!.measures.length,
        `${vendor} scopeClaims.measures is empty`,
      ).toBeGreaterThan(0);
      expect(
        claims!.cannotMeasure.length,
        `${vendor} scopeClaims.cannotMeasure is empty`,
      ).toBeGreaterThan(0);
      for (const line of [...claims!.measures, ...claims!.cannotMeasure]) {
        expect(line.trim().length, `${vendor} has a blank claim line`).toBeGreaterThan(0);
      }
    }
  });

  it("no claim invents a benchmark/percentile stated as fact (banned-phrasing sweep)", () => {
    for (const claims of Object.values(SCOPE_CLAIMS)) {
      for (const line of [...claims.measures, ...claims.cannotMeasure]) {
        expect(BANNED_PHRASING.test(line), `banned phrasing in: "${line}"`).toBe(
          false,
        );
      }
    }
  });

  it("the local Claude Code agent (a push source, not a registered connector) also has claims", () => {
    // It renders on the connections page and in the scope drawer, so its
    // honesty copy must exist too — sourced from the same map.
    const local = SCOPE_CLAIMS.claude_code_local;
    expect(local).toBeDefined();
    expect(local.measures.length).toBeGreaterThan(0);
    expect(local.cannotMeasure.length).toBeGreaterThan(0);
  });

  it("the desktop source discloses the Phase-1 Claude Desktop limitation honestly", () => {
    // The desktop agent reads Claude Code's local logs — NOT the separate
    // Claude Desktop chat app. That hole must be surfaced, not implied away
    // (invariant b); the desktop status screen renders the same limitation.
    const local = SCOPE_CLAIMS.claude_code_local;
    const claudeDesktopGap = local.cannotMeasure.find(
      (line) => /claude desktop/i.test(line) && /phase 1/i.test(line),
    );
    expect(
      claudeDesktopGap,
      "claude_code_local must list the Claude Desktop Phase-1 sync limitation",
    ).toBeDefined();
  });
});
