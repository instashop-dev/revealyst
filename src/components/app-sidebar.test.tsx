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

type SidebarProps = React.ComponentProps<typeof AppSidebar>;

function renderSidebar(
  pathname = "/dashboard",
  props: Partial<SidebarProps> = {},
) {
  mockPathname.mockReturnValue(pathname);
  return render(
    <SidebarProvider>
      <AppSidebar
        org={props.org ?? { name: "Acme", kind: "team" }}
        role={props.role ?? "admin"}
        user={
          props.user ?? { name: "Jane Doe", email: "jane@example.com" }
        }
        isPlatformAdmin={props.isPlatformAdmin ?? false}
      />
    </SidebarProvider>,
  );
}

// T2.6 items 2 + the nav-landmark test called for alongside it: a labeled
// <nav> landmark wrapping the menu groups, and aria-current="page" on the
// active item only.
describe("AppSidebar — nav landmark + aria-current (T2.6 item 2)", () => {
  it("exposes exactly one nav landmark labeled 'Primary'", () => {
    renderSidebar();
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });

  it("marks the active nav item with aria-current='page' and leaves the rest unmarked", () => {
    // Team org: /dashboard nav label is "Team" (U0.1, was "Overview").
    renderSidebar("/dashboard");
    const teamLink = screen.getByRole("link", { name: /Team/i });
    expect(teamLink).toHaveAttribute("aria-current", "page");

    const connectionsLink = screen.getByRole("link", { name: /Connections/i });
    expect(connectionsLink).not.toHaveAttribute("aria-current");
  });
});

// U0.1 nav IA: personal vs team labels + AI-maturity gating rendered by the
// sidebar (the pure resolver is unit-tested in src/lib/nav-items.test.ts).
describe("AppSidebar — nav IA (U0.1)", () => {
  it("labels /dashboard 'Team' and shows AI maturity for team orgs", () => {
    renderSidebar("/dashboard", { org: { name: "Acme", kind: "team" } });
    expect(screen.getByRole("link", { name: /Team/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /AI maturity/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Overview/i }),
    ).not.toBeInTheDocument();
  });

  it("labels /dashboard 'Today' and hides AI maturity for personal orgs", () => {
    renderSidebar("/dashboard", {
      org: { name: "My space", kind: "personal" },
      role: "admin",
    });
    expect(screen.getByRole("link", { name: /Today/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /AI maturity/i }),
    ).not.toBeInTheDocument();
    // /growth does not exist until phase U1 — no Growth item yet.
    expect(
      screen.queryByRole("link", { name: /Growth/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the admin group only for admins", () => {
    renderSidebar("/dashboard", { role: "member" });
    expect(
      screen.queryByRole("link", { name: /Billing/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the platform link only for platform admins", () => {
    renderSidebar("/dashboard", { isPlatformAdmin: true });
    expect(
      screen.getByRole("link", { name: /Platform admin/i }),
    ).toBeInTheDocument();
  });

  it("renders the theme toggle in the footer", () => {
    renderSidebar();
    // System / Light / Dark segmented control (U0.8).
    expect(screen.getByRole("group", { name: /theme/i })).toBeInTheDocument();
  });
});
