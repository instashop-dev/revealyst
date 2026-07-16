// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

const mockPathname = vi.fn(() => "/settings/profile");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsTabRail } from "./settings-tab-rail";
import { AdminOnlyNotice } from "./admin-only-notice";
import { settingsTabsFor, SETTINGS_COPY } from "@/lib/settings-nav";

function renderRail(role: "admin" | "member", pathname = "/settings/profile") {
  mockPathname.mockReturnValue(pathname);
  return render(<SettingsTabRail tabs={settingsTabsFor(role)} />);
}

describe("SettingsTabRail — role-filtered, deep-linkable tabs", () => {
  it("a member's rail shows only Profile + Notifications", () => {
    renderRail("member");
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Billing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "People" }),
    ).not.toBeInTheDocument();
  });

  it("an admin's rail shows all seven tabs", () => {
    renderRail("admin");
    for (const label of [
      "Profile",
      "Workspace",
      "Privacy",
      "Notifications",
      "People",
      "Billing",
      "Advanced",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the active tab with aria-current='page' and leaves the rest unmarked", () => {
    renderRail("admin", "/settings/billing");
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("exposes exactly one nav landmark labeled 'Settings'", () => {
    renderRail("admin");
    expect(
      screen.getByRole("navigation", { name: "Settings" }),
    ).toBeInTheDocument();
  });
});

describe("AdminOnlyNotice — in-place explanation for members", () => {
  it("renders the plain-English explanation, not a redirect", () => {
    render(<AdminOnlyNotice />);
    expect(screen.getByText(SETTINGS_COPY.adminOnly.title)).toBeInTheDocument();
    expect(screen.getByText(SETTINGS_COPY.adminOnly.body)).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin/i)).toBeInTheDocument();
  });
});

describe("Settings shell + tab — axe smoke", () => {
  it("the tab rail (shell nav) has no axe violations", async () => {
    const { container } = renderRail("admin");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an admin tab's member-facing explanation has no axe violations", async () => {
    const { container } = render(<AdminOnlyNotice />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
