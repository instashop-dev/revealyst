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
});

describe("no hard-coded vendor capability prose in (app) pages", () => {
  // The connections page must READ scopeClaims (from the registry / the map),
  // not embed vendor-capability sentences as string literals. This is the
  // structural W3-P guard applied to the trust-upgrade copy.
  const connectionsPage = "src/app/(app)/connections/page.tsx";

  it("the connections page imports the claims source rather than re-typing prose", () => {
    const src = readSrc(connectionsPage);
    expect(
      /scope-claims|scopeClaims/.test(src),
      "connections page should resolve vendor claims from scope-claims, not hard-code them",
    ).toBe(true);
  });

  it("the connections page contains none of the exact claim sentences as string literals", () => {
    // If a claim sentence appears verbatim in the page source, someone
    // pasted registry copy into the page — exactly the drift this guards.
    const src = readSrc(connectionsPage);
    const allClaims = Object.values(SCOPE_CLAIMS).flatMap((c) => [
      ...c.measures,
      ...c.cannotMeasure,
    ]);
    for (const claim of allClaims) {
      expect(
        src.includes(claim),
        `connections page hard-codes a vendor claim: "${claim}"`,
      ).toBe(false);
    }
  });
});
