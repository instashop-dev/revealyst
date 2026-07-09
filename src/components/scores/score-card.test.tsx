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
      screen.getByText("Computing from your connected data — check back shortly."),
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
      await screen.findByText(/covered a different number of days/i),
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

  it("shows the attribution badge only when attribution is present and not 'person'", () => {
    const { rerender } = render(
      <ScoreCard data={baseData({ attribution: "account" })} />,
    );
    expect(screen.getByText("Account-level")).toBeInTheDocument();

    rerender(<ScoreCard data={baseData({ attribution: "person" })} />);
    expect(screen.queryByText("Account-level")).not.toBeInTheDocument();
    expect(screen.queryByText("Per-person")).not.toBeInTheDocument();
  });
});
