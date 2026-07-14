// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  DataConfidenceCard,
  DataConfidenceProvider,
  MetricQualifier,
} from "./data-confidence";
import { buildDataConfidence } from "@/lib/data-confidence";
import type { CollectedGap } from "@/lib/honesty-gaps";

const now = new Date("2026-07-14T12:08:00Z");
const lastCheckedAt = new Date("2026-07-14T12:00:00Z");

const ESTIMATED_PRICING: CollectedGap = {
  kind: "other",
  detail: "spend_cents_estimated uses public list prices, not invoices",
};
const PARSE_DRIFT: CollectedGap = {
  kind: "other",
  detail: "log parse drift: 190 lines skipped, 799 unknown record types",
};

function modelWith(gaps: CollectedGap[]) {
  return buildDataConfidence({
    gaps,
    connectionErrored: false,
    hasData: true,
    lastCheckedAt,
    now,
  });
}

describe("DataConfidenceCard", () => {
  it("PRESENCE: shows the state, body, summary, and a review CTA when there are disclosures", () => {
    render(
      <DataConfidenceProvider model={modelWith([ESTIMATED_PRICING, PARSE_DRIFT])}>
        <DataConfidenceCard />
      </DataConfidenceProvider>,
    );
    expect(screen.getByText("Data confidence")).toBeTruthy();
    expect(screen.getByText("Mostly complete")).toBeTruthy();
    expect(screen.getByText(/some usage may be missing or estimated/i)).toBeTruthy();
    expect(screen.getByText(/Last checked 8m ago/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review data quality/i })).toBeTruthy();
  });

  it("ABSENCE: never shows raw backend wording (snake_case / parser messages) in the normal card", () => {
    const { container } = render(
      <DataConfidenceProvider model={modelWith([ESTIMATED_PRICING, PARSE_DRIFT])}>
        <DataConfidenceCard />
      </DataConfidenceProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/spend_cents_estimated/);
    expect(text).not.toMatch(/log parse drift/i);
    expect(text).not.toMatch(/unknown record types/i);
  });

  it("reliable state renders no review CTA (nothing to review)", () => {
    render(
      <DataConfidenceProvider model={modelWith([])}>
        <DataConfidenceCard />
      </DataConfidenceProvider>,
    );
    expect(screen.getByText("Reliable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review data quality/i })).toBeNull();
  });
});

describe("Data quality drawer", () => {
  it("opens from the CTA and shows plain-language disclosure, impact, and category", async () => {
    const user = userEvent.setup();
    render(
      <DataConfidenceProvider model={modelWith([ESTIMATED_PRICING, PARSE_DRIFT])}>
        <DataConfidenceCard />
      </DataConfidenceProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Review data quality/i }));

    await waitFor(() => {
      expect(screen.getByText("Some costs are estimated")).toBeTruthy();
    });
    expect(screen.getByText("Some imported activity could not be recognised")).toBeTruthy();
    // Category headings + impact copy are plain English.
    expect(screen.getByText("Cost estimates")).toBeTruthy();
    expect(screen.getAllByText(/What this means/i).length).toBeGreaterThan(0);
  });

  it("keeps raw technical wording behind the Technical details expander (hidden by default)", async () => {
    const user = userEvent.setup();
    render(
      <DataConfidenceProvider model={modelWith([ESTIMATED_PRICING])}>
        <DataConfidenceCard />
      </DataConfidenceProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Review data quality/i }));
    await waitFor(() => {
      expect(screen.getByText("Some costs are estimated")).toBeTruthy();
    });

    // Collapsed: the raw producer string is not shown yet.
    expect(screen.queryByText(/spend_cents_estimated uses public list prices/)).toBeNull();

    // Expand the Technical details section for this disclosure.
    await user.click(screen.getByRole("button", { name: /Technical details/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/spend_cents_estimated uses public list prices/),
      ).toBeTruthy();
    });
  });

  it("aggregates repeated parse-drift syncs into one entry with a summed count", async () => {
    const user = userEvent.setup();
    const drift = (s: number, u: number): CollectedGap => ({
      kind: "other",
      detail: `log parse drift: ${s} lines skipped, ${u} unknown record types`,
    });
    render(
      <DataConfidenceProvider model={modelWith([drift(190, 799), drift(28, 765), drift(28, 745)])}>
        <DataConfidenceCard />
      </DataConfidenceProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Review data quality/i }));
    await waitFor(() => {
      // ONE card, not three.
      expect(
        screen.getAllByText("Some imported activity could not be recognised"),
      ).toHaveLength(1);
    });
    expect(screen.getByText(/246 entries skipped/)).toBeTruthy();
  });
});

describe("MetricQualifier", () => {
  it("renders an accessible chip and opens the drawer at its category on click", async () => {
    const user = userEvent.setup();
    render(
      <DataConfidenceProvider model={modelWith([ESTIMATED_PRICING])}>
        <DataConfidenceCard />
        <MetricQualifier qualifier="estimated" category="cost-estimates" metricLabel="AI spend" />
      </DataConfidenceProvider>,
    );
    const chip = screen.getByRole("button", {
      name: /Estimated — AI spend\. Open data quality details\./i,
    });
    expect(chip).toBeTruthy();

    await user.click(chip);
    await waitFor(() => {
      expect(screen.getByText("Some costs are estimated")).toBeTruthy();
    });
  });
});
