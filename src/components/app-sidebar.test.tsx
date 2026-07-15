// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The sidebar pulls in next/navigation's pathname/router; stub both so the
// client component renders under jsdom without a Next runtime (same pattern
// as src/components/indexes/index-workbench.test.tsx).
const mockPathname = vi.fn(() => "/dashboard");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

// jsdom has no matchMedia implementation; SidebarProvider's mobile-breakpoint
// hook (src/hooks/use-mobile.ts) needs one to mount at all.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

// T2.6 items 2 + the nav-landmark test called for alongside it: a labeled
// <nav> landmark wrapping the menu groups, and aria-current="page" on the
// active item only.
describe("AppSidebar — nav landmark + aria-current (T2.6 item 2)", () => {
  function renderSidebar(pathname = "/dashboard") {
    mockPathname.mockReturnValue(pathname);
    return render(
      <SidebarProvider>
        <AppSidebar
          org={{ name: "Acme", kind: "team" }}
          role="admin"
          user={{ name: "Jane Doe", email: "jane@example.com" }}
          isPlatformAdmin={false}
        />
      </SidebarProvider>,
    );
  }

  it("exposes exactly one nav landmark labeled 'Primary'", () => {
    renderSidebar();
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });

  it("marks the active nav item with aria-current='page' and leaves the rest unmarked", () => {
    renderSidebar("/dashboard");
    const overviewLink = screen.getByRole("link", { name: /Overview/i });
    expect(overviewLink).toHaveAttribute("aria-current", "page");

    const connectionsLink = screen.getByRole("link", { name: /Connections/i });
    expect(connectionsLink).not.toHaveAttribute("aria-current");
  });
});
