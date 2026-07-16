import { describe, expect, it } from "vitest";
import {
  isPaywallExempt,
  PAYWALL_EXEMPT_PREFIXES,
} from "../src/lib/paywall-exempt";
import {
  SETTINGS_COPY,
  SETTINGS_TABS,
  settingsTabsFor,
} from "../src/lib/settings-nav";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// U3 Settings consolidation (plan §5.7): the tab list is role-gated config, the
// paywall exemption keeps /settings/* reachable over the free band, and the new
// copy is swept for invented benchmarks like every other claim surface.

describe("settingsTabsFor — role gating", () => {
  it("a member sees only Profile + Notifications", () => {
    const tabs = settingsTabsFor("member").map((t) => t.key);
    expect(tabs).toEqual(["profile", "notifications"]);
  });

  it("an admin sees all seven tabs in order", () => {
    const tabs = settingsTabsFor("admin").map((t) => t.key);
    expect(tabs).toEqual([
      "profile",
      "workspace",
      "privacy",
      "notifications",
      "people",
      "billing",
      "advanced",
    ]);
  });

  it("every tab routes under /settings/ (routes, not client tabs — deep-linkable)", () => {
    for (const tab of SETTINGS_TABS) {
      expect(tab.href.startsWith("/settings/")).toBe(true);
    }
  });

  it("only Profile + Notifications are non-admin (everyone) tabs", () => {
    const everyone = SETTINGS_TABS.filter((t) => !t.adminOnly).map((t) => t.key);
    expect(everyone).toEqual(["profile", "notifications"]);
  });
});

describe("isPaywallExempt — over-band reachability of /settings/*", () => {
  it("keeps the ADR 0015/0018 prefixes plus the /billing 308 stub", () => {
    // /account + /settings are the ADR-frozen exemptions; /billing is exempt
    // ONLY as a redirect stub — the layout renders the paywall instead of
    // children for a blocked org, so the stub must be reachable for its 308
    // to /settings/billing (itself exempt) to execute.
    expect(PAYWALL_EXEMPT_PREFIXES).toEqual([
      "/account",
      "/settings",
      "/billing",
    ]);
  });

  it("exempts every consolidated settings tab an over-band user needs", () => {
    // Billing (upgrade) + Profile (delete account) are the paths a blocked org
    // must reach to unblock — both now live under the exempt /settings prefix.
    expect(isPaywallExempt("/settings")).toBe(true);
    expect(isPaywallExempt("/settings/billing")).toBe(true);
    expect(isPaywallExempt("/settings/profile")).toBe(true);
    expect(isPaywallExempt("/settings/privacy")).toBe(true);
    // Legacy /account 308 target stays exempt too.
    expect(isPaywallExempt("/account")).toBe(true);
  });

  it("does not exempt unrelated routes or prefix look-alikes", () => {
    expect(isPaywallExempt("/dashboard")).toBe(false);
    // The /billing 308 stub IS exempt — the layout renders the paywall instead
    // of children for a blocked org, so the stub must be reachable for its
    // redirect to /settings/billing (itself exempt) to execute at all.
    expect(isPaywallExempt("/billing")).toBe(true);
    expect(isPaywallExempt("/settingsology")).toBe(false);
  });
});

describe("Settings copy — honesty sweep", () => {
  it("new Settings copy carries no invented benchmark/threshold claims", () => {
    const strings = [
      SETTINGS_COPY.adminOnly.title,
      SETTINGS_COPY.adminOnly.body,
      SETTINGS_COPY.trackedUserDefinition,
    ];
    for (const s of strings) {
      expect(s).not.toMatch(BANNED_PHRASING);
    }
  });

  it("the tracked-user definition states the frozen contract's rule (unresolved accounts not billed)", () => {
    // Sourced from src/contracts/tracked-user.ts: a person with activity in the
    // period; unresolved subjects are surfaced but never billed.
    expect(SETTINGS_COPY.trackedUserDefinition).toMatch(/activity in the period/i);
    expect(SETTINGS_COPY.trackedUserDefinition).toMatch(/never counted toward billing/i);
  });
});
