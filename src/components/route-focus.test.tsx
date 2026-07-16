// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// usePathname is the only navigation hook RouteFocusManager reads; drive it
// from a module-level variable so a rerender can simulate a client-side nav.
let mockPath = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

import { RouteFocusManager } from "./route-focus";

function mountMain() {
  const main = document.createElement("main");
  main.id = "main-content";
  main.tabIndex = -1;
  document.body.appendChild(main);
  return main;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RouteFocusManager (U5 focus-on-route-change)", () => {
  it("does NOT steal focus on first render", () => {
    mountMain();
    mockPath = "/dashboard";
    render(<RouteFocusManager />);
    // Initial load / hard nav: the browser's own focus (and skip link) stand.
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to #main-content when the pathname changes", () => {
    const main = mountMain();
    mockPath = "/dashboard";
    const { rerender } = render(<RouteFocusManager />);
    expect(document.activeElement).toBe(document.body);

    mockPath = "/growth";
    rerender(<RouteFocusManager />);
    expect(document.activeElement).toBe(main);
  });

  it("does not yank focus out of an open dialog (its own focus trap owns focus)", () => {
    mountMain();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    dialog.appendChild(input);
    document.body.appendChild(dialog);
    input.focus();
    expect(document.activeElement).toBe(input);

    mockPath = "/a";
    const { rerender } = render(<RouteFocusManager />);
    mockPath = "/b";
    rerender(<RouteFocusManager />);

    expect(document.activeElement).toBe(input);
  });
});
