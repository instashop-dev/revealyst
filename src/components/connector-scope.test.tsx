// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

// The scope drawer mounts a Sheet via ResponsiveSheetContent, which reads
// `useIsMobile`; jsdom has no matchMedia, so stub the hook to desktop (same
// pattern as growth-cards / companion-cards tests).
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { ConnectorScope } from "./connector-scope";

const CLAIMS = {
  measures: ["Daily API usage per key", "Model and token counts"],
  cannotMeasure: ["Who typed which prompt", "Costs before yesterday"],
};

describe("ConnectorScope (U2 / U5)", () => {
  it("shows the strongest thing it can see and the top gap in the summary", () => {
    render(<ConnectorScope vendorName="Example" claims={CLAIMS} />);
    expect(screen.getByText("Daily API usage per key")).toBeTruthy();
    expect(screen.getByText("Who typed which prompt")).toBeTruthy();
  });

  it("gives the disclosure trigger a >=44px touch target (U5)", () => {
    render(<ConnectorScope vendorName="Example" claims={CLAIMS} />);
    const trigger = screen.getByRole("button", {
      name: /can and can't measure/i,
    });
    expect(trigger.className).toMatch(/min-h-11/);
  });

  it("opens the drawer with the full measures / gaps lists", async () => {
    render(<ConnectorScope vendorName="Example" claims={CLAIMS} />);
    await userEvent.click(
      screen.getByRole("button", { name: /can and can't measure/i }),
    );
    expect(screen.getByText("Revealyst can see")).toBeTruthy();
    expect(screen.getByText("Model and token counts")).toBeTruthy();
    expect(screen.getByText("Costs before yesterday")).toBeTruthy();
  });

  it("has no detectable a11y violations, closed and open (axe smoke, U5)", async () => {
    const { container } = render(
      <ConnectorScope vendorName="Example" claims={CLAIMS} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(
      screen.getByRole("button", { name: /can and can't measure/i }),
    );
    // The open drawer's content is portalled onto document.body — audit the
    // whole document so the dialog markup is included.
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
