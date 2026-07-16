// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfidencePill } from "./confidence-pill";

describe("ConfidencePill — U0.2 shared confidence primitive", () => {
  it("renders the label with an icon (never color-only)", () => {
    const { container } = render(
      <ConfidencePill tier="measured" label="Measured" />,
    );
    expect(screen.getByText("Measured")).toBeTruthy();
    // Text + icon always — an SVG must be present alongside the label.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("every known tier renders its own icon, not a shared fallback", () => {
    const tiers = [
      "measured",
      "modeled",
      "derived",
      "directional",
      "not_measured",
    ] as const;
    const seen = new Set<string>();
    for (const tier of tiers) {
      const { container } = render(
        <ConfidencePill tier={tier} label={tier} />,
      );
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      seen.add(svg!.outerHTML);
    }
    // At least two distinct icon markups across the five tiers — this is
    // not a single icon reused regardless of tier (that would be
    // color-only-adjacent: the icon would carry no information).
    expect(seen.size).toBeGreaterThan(1);
  });

  it("renders an icon even with no tier supplied (label-only callers)", () => {
    const { container } = render(<ConfidencePill label="Custom tier" />);
    expect(screen.getByText("Custom tier")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("detail overrides the base label when both are supplied", () => {
    render(
      <ConfidencePill
        tier="derived"
        label="Derived"
        detail="derived, straight-line"
      />,
    );
    expect(screen.getByText("derived, straight-line")).toBeTruthy();
    expect(screen.queryByText("Derived")).toBeNull();
  });

  it("asOf appends trailing context to whatever text is showing", () => {
    render(
      <ConfidencePill tier="measured" label="Measured" asOf="Jul 10" />,
    );
    expect(screen.getByText(/Measured/)).toBeTruthy();
    expect(screen.getByText(/Jul 10/)).toBeTruthy();
  });

  it("not_measured renders muted text (still with its own icon, not color-only)", () => {
    const { container } = render(
      <ConfidencePill tier="not_measured" label="Not measured" />,
    );
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toMatch(/text-muted-foreground/);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
