// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { computeAttributionTrend } from "@/lib/attribution-trend";
import { AttributionTrendCard } from "./attribution-trend-card";

// Review F5: both gating findings (F1 headline basis, F2 copy overclaim) lived
// in this rendering layer — pin them here against the real lib output, not a
// hand-built trend object, so the card and the lib can't drift apart.

const day = (d: string, attribution: string) => ({ day: d, attribution });

describe("AttributionTrendCard", () => {
  it("renders the LATEST week's share as the headline, with the aggregate as labeled context (review F1)", () => {
    // The review's demonstrated failing input: week A 50%, week B shared-key
    // burst 10/100 (10%), week C 60%. The old aggregate headline rendered
    // "13% … up from 50%".
    const rows = [
      day("2026-06-01", "person"),
      day("2026-06-02", "account"),
      ...Array.from({ length: 10 }, () => day("2026-06-08", "person")),
      ...Array.from({ length: 90 }, () => day("2026-06-10", "account")),
      day("2026-06-15", "person"),
      day("2026-06-16", "person"),
      day("2026-06-17", "person"),
      day("2026-06-18", "account"),
      day("2026-06-19", "account"),
    ];
    const trend = computeAttributionTrend(rows);
    render(<AttributionTrendCard trend={trend} />);

    // Headline = week C's 60%, on the weekly basis the delta uses.
    expect(screen.getByText("60%")).toBeTruthy();
    // The delta endpoints read against the same weekly series.
    expect(screen.getByText(/up from 50%/)).toBeTruthy();
    // The burst-depressed aggregate appears ONLY as explicitly labeled
    // multi-week context, never as the headline.
    expect(screen.queryByText("13%")).toBeNull();
    expect(
      screen.getByText(/Across all 3 weeks shown: 13.1%/),
    ).toBeTruthy();
    // Headline is dated to the week it measures.
    expect(screen.getByText(/week of Jun 15/)).toBeTruthy();
  });

  it("never claims identity resolution — vendor person-attribution copy only (review F2)", () => {
    const trend = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-02", "person"),
    ]);
    const { container } = render(<AttributionTrendCard trend={trend} />);
    // The numerator is vendor-assigned attribution === 'person' — independent
    // of /reconcile identity resolution. "identity-resolved" (or any
    // "resolved" claim) must not appear anywhere on the card.
    expect(container.textContent).not.toMatch(/identity[- ]resolved/i);
    expect(container.textContent).not.toMatch(/resolved/i);
    expect(container.textContent).toContain("person-attributed");
    // And the measured-confidence label is present.
    expect(screen.getByText("Measured")).toBeTruthy();
  });

  it("renders no 'up from' claim for a single measured week", () => {
    const trend = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-03", "account"),
    ]);
    const { container } = render(<AttributionTrendCard trend={trend} />);
    // "50%" appears as the headline AND in the per-rung breakdown rows.
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/up from|down from/);
    // No multi-week aggregate line for a single week either.
    expect(container.textContent).not.toMatch(/Across all/);
  });

  it("renders an honest empty state that is also true when usage predates the window (review F7)", () => {
    const { container } = render(
      <AttributionTrendCard trend={computeAttributionTrend([])} />,
    );
    expect(
      screen.getByText(/No usage in the period this dashboard covers/),
    ).toBeTruthy();
    // Never a teaser/placeholder number.
    expect(container.textContent).not.toMatch(/\d%/);
  });

  it("lists only ladder levels that actually have usage-days", () => {
    const trend = computeAttributionTrend([
      day("2026-06-01", "person"),
      day("2026-06-02", "account"),
    ]);
    const { container } = render(<AttributionTrendCard trend={trend} />);
    expect(screen.getByText("Per-person")).toBeTruthy();
    expect(screen.getByText("Account-level")).toBeTruthy();
    // No key_project rows -> its rung is absent, not shown as 0.
    expect(container.textContent).not.toContain("Key / project");
  });
});
