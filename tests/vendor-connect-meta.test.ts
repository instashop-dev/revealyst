import { describe, expect, it } from "vitest";
// Side-effect import: registers every shipped connector (server context —
// the client bundle never does this; the meta module is hand-maintained
// precisely because of that, and THIS test is its drift guard).
import "../src/connectors";
import { getConnector, registeredVendors } from "../src/connectors/registry";
import { KEY_VENDORS } from "../src/lib/vendor-connect-meta";

// Vendors with a shipped connector that the key-based connect UI must NOT
// offer, with the reason. Adding a connector to the registry without either
// adding it to KEY_VENDORS or listing it here fails the sweep below — the
// W3-P lesson (never let copy/UI drift from the registry) enforced for the
// connect surface.
const INTENTIONALLY_NOT_IN_CONNECT_UI: Record<string, string> = {
  // (none today — claude_code_local pairs via device token in onboarding
  // and has no registered connector; Copilot has no connector yet)
};

describe("vendor-connect-meta ↔ connector registry drift guard", () => {
  it("every KEY_VENDORS entry has a shipped, registered connector", () => {
    for (const v of KEY_VENDORS) {
      expect(
        getConnector(v.vendor),
        `${v.vendor} is offered in the connect UI but has no registered connector`,
      ).toBeDefined();
    }
  });

  it("every registered connector is offered in the connect UI or explicitly excused", () => {
    const offered = new Set<string>(KEY_VENDORS.map((v) => v.vendor));
    for (const vendor of registeredVendors()) {
      const excused = vendor in INTENTIONALLY_NOT_IN_CONNECT_UI;
      expect(
        offered.has(vendor) || excused,
        `${vendor} shipped in the registry but the connect UI doesn't offer it — add it to KEY_VENDORS or excuse it in INTENTIONALLY_NOT_IN_CONNECT_UI`,
      ).toBe(true);
    }
  });
});
