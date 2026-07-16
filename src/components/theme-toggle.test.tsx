// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle";

// next-themes writes to localStorage + toggles the root `.dark` class; jsdom
// has neither matchMedia nor a clean store between tests, so reset both.
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
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
});

afterEach(() => {
  window.localStorage.clear();
});

function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle (U0.8)", () => {
  it("renders the three states as a labelled group", async () => {
    renderToggle();
    expect(
      await screen.findByRole("group", { name: /theme/i }),
    ).toBeInTheDocument();
    // Each state has a visible text label (never colour-only).
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
  });

  it("persists a chosen theme via next-themes (localStorage + root class)", async () => {
    const user = userEvent.setup();
    renderToggle();

    // Wait for the mount effect to enable the controls.
    const darkBtn = await screen.findByRole("button", { name: /dark/i });
    await waitFor(() => expect(darkBtn).not.toBeDisabled());

    await user.click(darkBtn);
    await waitFor(() => {
      expect(window.localStorage.getItem("theme")).toBe("dark");
      expect(document.documentElement).toHaveClass("dark");
    });

    const lightBtn = screen.getByRole("button", { name: /light/i });
    await user.click(lightBtn);
    await waitFor(() => {
      expect(window.localStorage.getItem("theme")).toBe("light");
      expect(document.documentElement).not.toHaveClass("dark");
    });
  });
});
