// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ScoreCard, type ScoreCardData } from "./score-card";

function baseData(overrides: Partial<ScoreCardData> = {}): ScoreCardData {
  return {
    slug: "fluency",
    title: "Fluency",
    shortWhat: "How broadly, deeply, and effectively your team uses AI tools.",
    value: 62,
    attribution: "person",
    delta: null,
    componentRows: [
      {
        key: "breadth",
        label: "Breadth",
        kind: "plain",
        omitted: false,
        raw: 5,
        normalized: 62.5,
        weight: 0.33,
        contribution: 20.6,
        calcSimple: "Counts distinct features used.",
      },
      {
        key: "effectiveness",
        label: "Effectiveness",
        kind: "ratio",
        omitted: true,
        weight: 0.34,
        calcSimple: "Divides accepted by offered suggestions.",
      },
    ],
    methodologyHref: "/methodology#fluency",
    ...overrides,
  };
}

describe("ScoreCard", () => {
  it("renders the value and an accessible meter", () => {
    render(<ScoreCard data={baseData()} />);

    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Fluency score" })).toBeInTheDocument();
  });

  it("computing state (value null) shows the copy and a methodology link, no meter", () => {
    render(<ScoreCard data={baseData({ value: null })} />);

    expect(
      screen.getByText(/Not enough data yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/appears once your connected tools report the data it needs/),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /how scores work/i });
    expect(link).toHaveAttribute("href", "/methodology#fluency");
    expect(screen.queryByRole("meter", { name: "Fluency score" })).not.toBeInTheDocument();
  });

  it("delta kind 'delta' renders the arrow, magnitude, and previous-period label", () => {
    render(
      <ScoreCard
        data={baseData({
          delta: {
            kind: "delta",
            current: 62,
            previous: 56,
            delta: 6,
            previousPeriodLabel: "May 1–31",
          },
        })}
      />,
    );

    expect(screen.getByText("+6 vs May 1–31")).toBeInTheDocument();
  });

  it("delta kind 'first' renders muted first-period copy", () => {
    render(<ScoreCard data={baseData({ delta: { kind: "first" } })} />);
    expect(screen.getByText("First scored period")).toBeInTheDocument();
  });

  it("delta kind 'notComparable' renders the reason via an InfoTip", async () => {
    const user = userEvent.setup();
    render(
      <ScoreCard
        data={baseData({ delta: { kind: "notComparable", reason: "grain" } })}
      />,
    );

    expect(screen.getByText("Not comparable to last period")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About Why not comparable" }));
    expect(
      await screen.findByText(/different kind of period \(for example weekly vs monthly\)/i),
    ).toBeInTheDocument();
  });

  it("an omitted row shows 'Not enough data yet', never a 0", async () => {
    const user = userEvent.setup();
    render(<ScoreCard data={baseData()} />);

    await user.click(screen.getByRole("button", { name: "How this score is calculated" }));

    expect(await screen.findByText("Not enough data yet")).toBeInTheDocument();
    expect(screen.queryByText("0/100")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Parts without enough data are left out of the total/),
    ).toBeInTheDocument();
  });

  it("collapsible trigger is present and content is hidden until clicked", async () => {
    const user = userEvent.setup();
    render(<ScoreCard data={baseData()} />);

    const trigger = screen.getByRole("button", { name: "How this score is calculated" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Not enough data yet")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Not enough data yet")).toBeInTheDocument();
  });

  it("shows the attribution badge (with a visible not-per-person qualifier) only when attribution is present and not 'person'", () => {
    const { rerender } = render(
      <ScoreCard data={baseData({ attribution: "account" })} />,
    );
    expect(screen.getByText(/Account-level/)).toBeInTheDocument();
    expect(screen.getByText(/not per-person/)).toBeInTheDocument();

    rerender(<ScoreCard data={baseData({ attribution: "person" })} />);
    expect(screen.queryByText(/Account-level/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Per-person/)).not.toBeInTheDocument();
  });

  it("collapsed card shows an always-visible 'N of M parts measured' chip when a component is omitted", () => {
    render(<ScoreCard data={baseData()} />);
    // Visible without expanding the collapsible — baseData has 1 measured,
    // 1 omitted, of 2 total components.
    expect(screen.getByText("1 of 2 parts measured")).toBeInTheDocument();
  });

  it("does not show the parts-measured chip when nothing is omitted", () => {
    render(
      <ScoreCard
        data={baseData({
          componentRows: [
            {
              key: "breadth",
              label: "Breadth",
              kind: "plain",
              omitted: false,
              raw: 5,
              normalized: 62.5,
              weight: 1,
              contribution: 62.5,
              calcSimple: "Counts distinct features used.",
            },
          ],
        })}
      />,
    );
    expect(screen.queryByText(/parts measured/)).not.toBeInTheDocument();
  });

  it("appends 'The breakdown shows what's driving this.' only when there are component rows", () => {
    const withRows = render(<ScoreCard data={baseData()} />);
    expect(
      withRows.getByText(/The breakdown shows what's driving this\./),
    ).toBeInTheDocument();
    withRows.unmount();

    const withoutRows = render(
      <ScoreCard data={baseData({ componentRows: [] })} />,
    );
    expect(
      withoutRows.queryByText(/The breakdown shows what's driving this\./),
    ).not.toBeInTheDocument();
  });

  it("guidance is slug-aware, not Adoption-shaped for every score", () => {
    render(
      <ScoreCard
        data={baseData({ slug: "efficiency", value: 92, componentRows: [] })}
      />,
    );
    expect(screen.getByText(/per dollar of spend/i)).toBeInTheDocument();
    expect(screen.queryByText(/Usage is broad and consistent/i)).not.toBeInTheDocument();
  });

  it("bands the guidance on the ROUNDED headline number, not the raw value — 39.6 displays as 40 and reads the 40-69 band", () => {
    render(
      <ScoreCard
        data={baseData({ slug: "adoption", value: 39.6, componentRows: [] })}
      />,
    );
    expect(screen.getByText("40")).toBeInTheDocument();
    // Adoption's "building" (40-69) band copy — see SCORE_GLOSSARY.adoption
    // .interpretBands.building in src/lib/metrics-glossary.ts. The raw value
    // 39.6 falls in the "low" (<40) band; asserting this text proves the
    // card banded on the displayed "40", not the underlying 39.6.
    expect(screen.getByText(/A habit is forming/i)).toBeInTheDocument();
  });

  it("shortWhat is always visible as a CardDescription, without opening the InfoTip popover", () => {
    render(<ScoreCard data={baseData()} />);
    expect(
      screen.getByText("How broadly, deeply, and effectively your team uses AI tools."),
    ).toBeInTheDocument();
  });
});
