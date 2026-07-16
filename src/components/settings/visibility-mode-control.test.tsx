// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { VisibilityModeControl } from "./visibility-mode-control";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// Documented arrow-key behavior (WAI-ARIA radio group + this component's
// privacy-confirmation flow): arrows move focus AND selection (selection
// follows focus, standard APG). Because selecting can be privacy-material here,
// the SAME choose() a click runs fires on arrow — so arrowing to a
// name-revealing mode opens the readiness dialog (loosening), and arrowing to a
// tighter mode commits immediately, exactly like clicking. Only the checked
// option is in the tab order (roving tabindex); arrows reach the rest.
describe("VisibilityModeControl radiogroup keyboard semantics", () => {
  it("uses roving tabindex — only the checked option is tabbable", () => {
    render(<VisibilityModeControl current="private" />);
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) {
      const checked = radio.getAttribute("aria-checked") === "true";
      expect(radio).toHaveAttribute("tabindex", checked ? "0" : "-1");
    }
  });

  it("arrowing from a private mode to a name-revealing mode opens the readiness dialog", async () => {
    const user = userEvent.setup();
    render(<VisibilityModeControl current="private" />);
    const radios = screen.getAllByRole("radio");
    // index 0 = private (checked). ArrowDown → index 1 = managed (reveals names).
    radios[0].focus();
    await user.keyboard("{ArrowDown}");
    // Selection-follows-focus invoked choose(managed) → loosening → dialog.
    expect(
      await screen.findByText("Before you reveal real names"),
    ).toBeInTheDocument();
  });

  it("returns focus to the checked radio after the readiness dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(<VisibilityModeControl current="private" />);
    const radios = screen.getAllByRole("radio");
    radios[0].focus();
    await user.keyboard("{ArrowDown}"); // opens the loosening dialog
    await screen.findByText("Before you reveal real names");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Focus must return to a radio in the group, never fall to document.body
    // (the arrowed-to option was disabled while the dialog was open).
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("role", "radio"),
    );
  });

  it("arrowing to a tighter mode commits immediately (no dialog) and moves selection", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<VisibilityModeControl current="full" />);
    const radios = screen.getAllByRole("radio");
    // index 2 = full (checked). ArrowDown wraps → index 0 = private (tightening).
    radios[2].focus();
    await user.keyboard("{ArrowDown}");

    // Tightening commits straight to the API without the readiness dialog.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText("Before you reveal real names"),
    ).not.toBeInTheDocument();

    // Selection follows focus: private is now the checked option (optimistic).
    await waitFor(() =>
      expect(screen.getAllByRole("radio")[0]).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });
});

// U5: axe smoke on a representative Settings tab form component (the Privacy
// tab's main control), extending the rail-only coverage in
// settings-tab-rail.test.tsx to an actual tab render.
describe("VisibilityModeControl — axe smoke (U5)", () => {
  it("has no detectable a11y violations", async () => {
    const { container } = render(<VisibilityModeControl current="private" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
