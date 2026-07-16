// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectorCard } from "./connector-card";

// U0.6 — the shared connector-card shell. Presentation only: slots render
// what's passed, the primary action always gets a >=44px touch target
// (class-presence assertion — jsdom doesn't compute real layout), and
// optional slots (mark, status badge, meta, secondary action, children) are
// each absent from the DOM when omitted.

describe("ConnectorCard — U0.6 shell", () => {
  it("renders vendor name, status badge, summary, meta, and the primary action", () => {
    render(
      <ConnectorCard
        vendorName="Example Vendor"
        statusBadge={<span>Connected</span>}
        summary="Does the example thing."
        meta="Last synced 2 hours ago."
        primaryAction={<button type="button">Connect</button>}
      />,
    );
    expect(screen.getByText("Example Vendor")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Does the example thing.")).toBeTruthy();
    expect(screen.getByText("Last synced 2 hours ago.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("renders a mark when given one, and none when omitted", () => {
    const { rerender, container } = render(
      <ConnectorCard
        vendorName="Example Vendor"
        mark={<svg data-testid="mark" />}
        primaryAction={<button type="button">Connect</button>}
      />,
    );
    expect(screen.getByTestId("mark")).toBeTruthy();

    rerender(
      <ConnectorCard
        vendorName="Example Vendor"
        primaryAction={<button type="button">Connect</button>}
      />,
    );
    expect(container.querySelector('[data-testid="mark"]')).toBeNull();
  });

  it("renders an optional secondary action alongside the primary one", () => {
    render(
      <ConnectorCard
        vendorName="Example Vendor"
        primaryAction={<button type="button">Confirm</button>}
        secondaryAction={<button type="button">Cancel</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("renders card-specific body content passed as children", () => {
    render(
      <ConnectorCard
        vendorName="Example Vendor"
        primaryAction={<button type="button">Connect</button>}
      >
        <p>Extra per-state body content.</p>
      </ConnectorCard>,
    );
    expect(screen.getByText("Extra per-state body content.")).toBeTruthy();
  });

  it("gives the primary action slot a >=44px touch target (min-h-11)", () => {
    render(
      <ConnectorCard
        vendorName="Example Vendor"
        primaryAction={<button type="button">Connect</button>}
      />,
    );
    const wrapper = screen.getByRole("button", { name: "Connect" }).closest(
      '[data-slot="connector-card-primary-action"]',
    );
    expect(wrapper).toBeTruthy();
    expect(wrapper?.className).toMatch(/min-h-11/);
  });

  it("supports a primary-action slot that isn't a button (fallback explanatory text)", () => {
    render(
      <ConnectorCard
        vendorName="Example Vendor"
        muted
        primaryAction={<p>Not connectable on this deployment yet.</p>}
      />,
    );
    expect(
      screen.getByText("Not connectable on this deployment yet."),
    ).toBeTruthy();
  });

  it("renders no footer at all when there's nothing to put in it", () => {
    const { container } = render(
      <ConnectorCard vendorName="Example Vendor" summary="Just a summary." />,
    );
    expect(container.querySelector('[data-slot="card-footer"]')).toBeNull();
  });
});
