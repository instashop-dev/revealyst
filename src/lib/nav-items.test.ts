import { describe, expect, it } from "vitest";
import { navFor } from "./nav-items";

const titles = (groups: ReturnType<typeof navFor>) =>
  groups.flatMap((g) => g.items.map((i) => i.title));

describe("navFor — U0.1 nav IA", () => {
  it("personal org: Today + Growth + Connections + Account, no AI maturity", () => {
    const groups = navFor({
      orgKind: "personal",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary"]);
    expect(groups[0].label).toBe("Personal workspace");
    expect(titles(groups)).toEqual([
      "Today",
      "Growth",
      "Connections",
      "Account",
    ]);
    // Growth is a personal-only surface (U1); AI maturity stays demoted for
    // personal orgs (the raw 0–100 diagnostic lives behind the companion).
    expect(titles(groups)).not.toContain("AI maturity");
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

  it("team org (member): Team + AI maturity + Connections + Account, no admin group", () => {
    const groups = navFor({
      orgKind: "team",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary"]);
    expect(groups[0].label).toBe("Workspace");
    expect(titles(groups)).toEqual([
      "Team",
      "AI maturity",
      "Connections",
      "Account",
    ]);
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
    expect(titles(groups)).toEqual([
      "Team",
      "AI maturity",
      "Connections",
      "Account",
    ]);
  });

  it("team org (admin): appends the Administration group unchanged", () => {
    const groups = navFor({
      orgKind: "team",
      role: "admin",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary", "admin"]);
    const admin = groups.find((g) => g.id === "admin");
    expect(admin?.label).toBe("Administration");
    expect(admin?.items.map((i) => i.title)).toEqual([
      "Members",
      "Match accounts",
      "Spend",
      "Billing",
      "Compliance",
      "Settings",
    ]);
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
