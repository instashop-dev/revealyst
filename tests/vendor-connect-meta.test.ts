import { describe, expect, it } from "vitest";
// Side-effect import: registers every shipped connector (server context —
// the client bundle never does this; the meta module is hand-maintained
// precisely because of that, and THIS test is its drift guard).
import "../src/connectors";
import { getConnector, registeredVendors } from "../src/connectors/registry";
import { readCopilotAppConfig } from "../src/lib/github-app-config";
import {
  GITHUB_APP_VENDORS,
  KEY_VENDORS,
  NLV_PENDING_VENDORS,
} from "../src/lib/vendor-connect-meta";

// Vendors with a shipped connector that the key-based connect UI must NOT
// offer, with the reason. Adding a connector to the registry without either
// adding it to KEY_VENDORS or listing it here fails the sweep below — the
// W3-P lesson (never let copy/UI drift from the registry) enforced for the
// connect surface.
const INTENTIONALLY_NOT_IN_CONNECT_UI: Record<string, string> = {
  // (none today — claude_code_local pairs via device token in onboarding
  // and has no registered connector; Copilot connects via GitHub App, so it
  // is offered through GITHUB_APP_VENDORS rather than KEY_VENDORS.)
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

  it("every GITHUB_APP_VENDORS entry has a shipped, registered connector", () => {
    for (const v of GITHUB_APP_VENDORS) {
      expect(
        getConnector(v.vendor),
        `${v.vendor} is offered as a GitHub-App connect but has no registered connector`,
      ).toBeDefined();
    }
  });

  it("every registered connector is offered in the connect UI or explicitly excused", () => {
    const offered = new Set<string>([
      ...KEY_VENDORS.map((v) => v.vendor),
      ...GITHUB_APP_VENDORS.map((v) => v.vendor),
    ]);
    for (const vendor of registeredVendors()) {
      const excused = vendor in INTENTIONALLY_NOT_IN_CONNECT_UI;
      expect(
        offered.has(vendor) || excused,
        `${vendor} shipped in the registry but the connect UI doesn't offer it — add it to KEY_VENDORS or excuse it in INTENTIONALLY_NOT_IN_CONNECT_UI`,
      ).toBe(true);
    }
  });

  it("every NLV_PENDING vendor has a registered connector (a stale entry would re-hide a live vendor)", () => {
    // The landing "Connects" strip holds these in "Soon" until the founder's
    // one-line flip post-NLV (ADR 0022). An entry for a vendor that was never
    // registered is meaningless; an entry left behind after the connector was
    // REMOVED would silently mask a real absence. Registration is the
    // precondition for being on this list at all.
    for (const vendor of NLV_PENDING_VENDORS) {
      expect(
        getConnector(vendor),
        `${vendor} is NLV-pending but has no registered connector — stale entry`,
      ).toBeDefined();
    }
  });
});

describe("Copilot connect env gate (readCopilotAppConfig)", () => {
  const full = {
    GH_COPILOT_APP_ID: "4215573",
    GH_COPILOT_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----",
    GH_COPILOT_APP_SLUG: "revealyst",
    // The OAuth client id/secret gate the install-ownership check (the
    // confused-deputy fix): the whole flow stays disabled until they sync too.
    GH_COPILOT_APP_CLIENT_ID: "Iv23li7wFumkZwiRogYu",
    GH_COPILOT_APP_CLIENT_SECRET: "client-secret",
  };

  it("all secrets present → configured (the connect surfaces offer the install)", () => {
    expect(readCopilotAppConfig(full)).toEqual({
      appId: "4215573",
      privateKeyPem: full.GH_COPILOT_APP_PRIVATE_KEY,
      slug: "revealyst",
      clientId: "Iv23li7wFumkZwiRogYu",
      clientSecret: "client-secret",
    });
  });

  it("any secret missing → null (the founder-gated pre-NLV state; surfaces show 'not yet available')", () => {
    expect(readCopilotAppConfig({})).toBeNull();
    for (const drop of Object.keys(full) as (keyof typeof full)[]) {
      const partial = { ...full, [drop]: undefined };
      expect(readCopilotAppConfig(partial), `missing ${drop}`).toBeNull();
    }
  });
});
