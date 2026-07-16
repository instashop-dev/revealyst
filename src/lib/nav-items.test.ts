import { describe, expect, it } from "vitest";
import { navFor } from "./nav-items";

const titles = (groups: ReturnType<typeof navFor>) =>
  groups.flatMap((g) => g.items.map((i) => i.title));

describe("navFor — U0.1 nav IA", () => {
  it("personal org: Today + Connections + Account, no AI maturity, no Growth", () => {
    const groups = navFor({
      orgKind: "personal",
      role: "member",
      isPlatformAdmin: false,
    });
    expect(groups.map((g) => g.id)).toEqual(["primary"]);
    expect(groups[0].label).toBe("Personal workspace");
    expect(titles(groups)).toEqual(["Today", "Connections", "Account"]);
    // /growth doesn't exist until phase U1.
    expect(titles(groups)).not.toContain("Growth");
    expect(titles(groups)).not.toContain("AI maturity");
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
