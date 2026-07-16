// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconcileExplainer } from "./reconcile-explainer";

const DISMISS_KEY = "revealyst.reconcile.explainer.dismissed";
const HEADING = "How the accounts your tools report map to real people";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("ReconcileExplainer", () => {
  it("renders expanded on first visit (no dismissal stored)", () => {
    render(<ReconcileExplainer />);
    expect(screen.getByText(HEADING)).toBeInTheDocument();
    // Sourced from ATTRIBUTION_GLOSSARY, not re-typed here.
    expect(screen.getByText("Per-person")).toBeInTheDocument();
  });

  it("stays hidden when a prior dismissal is stored", () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    render(<ReconcileExplainer />);
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("dismissal persists to localStorage and hides the card", async () => {
    render(<ReconcileExplainer />);
    expect(screen.getByText(HEADING)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Dismiss explainer/ }),
    );

    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("does not crash when localStorage throws (private mode / disabled storage)", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    render(<ReconcileExplainer />);
    // getItem threw → we fall back to showing the explainer this session.
    expect(screen.getByText(HEADING)).toBeInTheDocument();

    // Dismissing swallows the setItem throw and still hides the card.
    await userEvent.click(
      screen.getByRole("button", { name: /Dismiss explainer/ }),
    );
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("SSR guard: the initial (pre-effect) render is null and never touches window", () => {
    // The component reads window only inside useEffect; its first synchronous
    // render returns null (mounted=false), so a server render can't crash. We
    // approximate that here by asserting the render throws nothing even when
    // window.localStorage access is made to throw before effects settle.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("no storage");
    });
    expect(() => render(<ReconcileExplainer />)).not.toThrow();
  });
});
