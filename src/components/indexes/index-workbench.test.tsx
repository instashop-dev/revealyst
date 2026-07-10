// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The workbench pulls in next/navigation's router and sonner toasts; stub both
// so the client component renders under jsdom without a Next runtime.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AGGREGATION_OPTIONS, METRIC_OPTIONS } from "@/lib/custom-index-catalog";
import { IndexWorkbench } from "./index-workbench";

function renderWorkbench() {
  return render(
    <IndexWorkbench
      indexes={[]}
      results={{}}
      metrics={METRIC_OPTIONS}
      aggregations={AGGREGATION_OPTIONS}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IndexWorkbench ComponentEditor accessibility", () => {
  it("gives every sub-form control a programmatic label (getByLabelText finds each)", () => {
    renderWorkbench();
    // Toolbar controls carry aria-labels (no visible label slot); the field
    // controls are associated with visible <Label htmlFor> elements.
    expect(screen.getByLabelText("Component name")).toBeInTheDocument();
    expect(screen.getByLabelText("Component type")).toBeInTheDocument();
    expect(screen.getByLabelText("Metric")).toBeInTheDocument();
    expect(screen.getByLabelText("Aggregation")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight (0–1)")).toBeInTheDocument();
    expect(screen.getByLabelText("Scales to 0 at")).toBeInTheDocument();
    expect(screen.getByLabelText("Scales to 100 at")).toBeInTheDocument();
  });

  it("labels numerator and denominator selects distinctly in ratio mode", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.selectOptions(screen.getByLabelText("Component type"), "ratio");
    expect(screen.getByLabelText("Numerator metric")).toBeInTheDocument();
    expect(screen.getByLabelText("Denominator metric")).toBeInTheDocument();
    // Two aggregation selects (numerator + denominator), each associated.
    expect(screen.getAllByLabelText("Aggregation")).toHaveLength(2);
  });

  it("surfaces component validation errors in an aria-live status region", () => {
    // The default component starts with an empty name → schema invalid → the
    // error region renders on first paint.
    renderWorkbench();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/\S/);
  });

  it("announces async preview results in an aria-live region", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        window: { from: "2026-06-01", to: "2026-06-28" },
        entries: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWorkbench();
    // Naming the component makes the schema pass, which enables Preview.
    await user.type(screen.getByLabelText("Component name"), "Adoption");
    const preview = screen.getByRole("button", { name: "Preview" });
    expect(preview).toBeEnabled();
    await user.click(preview);

    // The preview panel is itself the aria-live region.
    const empty = await screen.findByText(/No recent data for these metrics/);
    const region = empty.closest('[role="status"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
