import { describe, expect, it } from "vitest";
import { navFor } from "./nav-items";

const titles = (groups: ReturnType<typeof navFor>) =>
  groups.flatMap((g) => g.items.map((i) => i.title));

describe("navFor — U0.1 nav IA", () => {
  it("personal org: Today + Growth + Settings, no AI maturity, no Connections", () => {
    const groups = navFor({
      orgKind: "personal",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary"]);
    expect(groups[0].label).toBe("Personal workspace");
    // U1 added Growth (personal-only surface); U3 replaced "Account" with
    // "Settings" (Settings is for everyone — members reach profile +
    // notifications there). AI maturity stays demoted for personal orgs.
    // ADR 0054 removed the "Connections" nav item with the pivot to the
    // desktop-agent model — device pairing lives under Settings → Devices.
    expect(titles(groups)).toEqual(["Today", "Growth", "Settings"]);
    expect(titles(groups)).not.toContain("Account");
    expect(titles(groups)).not.toContain("AI maturity");
    expect(titles(groups)).not.toContain("Connections");
  });

  it("team org (member): no Growth item (personal-only until T5.1 clears)", () => {
    // Growth ships for personal orgs now; team-org members do not get it until
    // the companion-in-team-orgs dogfood gate (R7) clears — nothing built ahead.
    const groups = navFor({
      orgKind: "team",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(titles(groups)).not.toContain("Growth");
  });

  it("team org (member): Team + AI maturity + Settings, no admin group, no Connections", () => {
    const groups = navFor({
      orgKind: "team",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary"]);
    expect(groups[0].label).toBe("Workspace");
    // A member gets the Settings item (U3) so they can reach their own profile
    // and notification preferences — no admin group. Connections removed (ADR
    // 0054); device pairing lives under Settings → Devices.
    expect(titles(groups)).toEqual(["Team", "AI maturity", "Settings"]);
    expect(titles(groups)).not.toContain("Connections");
  });

  it("system org kind falls through to the team IA (labels + item set), not personal", () => {
    // The internal `system` org kind must never regress to the personal item
    // set (U0 review finding — previously only the personal/other ternary
    // covered it implicitly).
    const groups = navFor({
      orgKind: "system",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(groups[0].label).toBe("Workspace");
    expect(titles(groups)).toEqual(["Team", "AI maturity", "Settings"]);
  });

  it("team org (admin): Administration group drops Members/Billing/Settings (now in /settings/*)", () => {
    const groups = navFor({
      orgKind: "team",
      role: "admin",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary", "admin"]);
    const admin = groups.find((g) => g.id === "admin");
    expect(admin?.label).toBe("Administration");
    // U3: Members, Billing, and Settings moved into the consolidated
    // /settings/* surface, leaving only the data-reading ops links.
    expect(admin?.items.map((i) => i.title)).toEqual([
      "Match accounts",
      "Spend",
      "Compliance",
    ]);
    const adminHrefs = admin?.items.map((i) => i.href) ?? [];
    expect(adminHrefs).not.toContain("/members");
    expect(adminHrefs).not.toContain("/billing");
    expect(adminHrefs).not.toContain("/settings");
  });

  it("admin gating is independent of org kind (personal admin still gets the group)", () => {
    const groups = navFor({
      orgKind: "personal",
      role: "admin",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary", "admin"]);
  });

  it("platform admin: appends the Platform group after any admin group", () => {
    const groups = navFor({
      orgKind: "team",
      role: "admin",
      isPlatformAdmin: true,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary", "admin", "platform"]);
    const platform = groups.find((g) => g.id === "platform");
    expect(platform?.items.map((i) => i.title)).toEqual(["Platform admin"]);
  });

  it("platform group can appear without the admin group (member + platform admin)", () => {
    const groups = navFor({
      orgKind: "team",
      role: "member",
      isPlatformAdmin: true,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary", "platform"]);
  });

  it("every nav item carries an icon component", () => {
    const groups = navFor({
      orgKind: "team",
      role: "admin",
      isPlatformAdmin: true,
    });
    for (const item of groups.flatMap((g) => g.items)) {
      // lucide icons are React forwardRef components (objects), not plain fns.
      expect(item.icon).toBeDefined();
    }
  });
});
