// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoachingCard } from "./coaching-card";
import { DailyNudgeCard } from "./daily-nudge-card";
import { GrowthJourneyCard } from "./growth-journey-card";
import { buildDailyNudge } from "@/lib/companion-glossary";
import { MATURITY_LEVEL_COPY } from "@/lib/maturity-glossary";
import type { AttentionItem } from "@/lib/score-insights";

const NEXT_STEP: AttentionItem = {
  severity: "info",
  kind: "recommendation",
  title: "Make AI part of the daily routine",
  body: "The active-days part of Adoption is measuring low. A common starting point is routing one recurring task through an AI tool each day.",
};

describe("GrowthJourneyCard — level-forward headline (W5-C)", () => {
  it("PRESENCE: leads with the maturity level NAME (from maturity-glossary) and the next step", () => {
    render(
      <GrowthJourneyCard level={1} stale={false} nextStep={NEXT_STEP} />,
    );
    // Level name comes ONLY from MATURITY_LEVEL_COPY — never invented here.
    expect(screen.getByText(MATURITY_LEVEL_COPY[1].name)).toBeTruthy(); // "Trial"
    // The first-sync aha framing: "You're at <level>".
    expect(screen.getByText(/You're at/i)).toBeTruthy();
    // The single next step (top coaching recommendation).
    expect(screen.getByText(NEXT_STEP.title)).toBeTruthy();
    expect(screen.getByText(/Your next step/i)).toBeTruthy();
  });

  it("ABSENCE: renders NO raw 0–100 score headline in the default render", () => {
    const { container } = render(
      <GrowthJourneyCard level={2} stale={false} nextStep={NEXT_STEP} />,
    );
    const text = container.textContent ?? "";
    // No "Score N" headline anywhere.
    expect(text).not.toMatch(/Score\s*\d/i);
    // No raw 0–100 number rendered as a headline (level name + tagline + the
    // task-focused next step carry no 2–3 digit numbers).
    expect(text).not.toMatch(/\b\d{2,3}\b/);
    // And the level NAME is the headline, not a number.
    expect(screen.getByRole("heading", { name: MATURITY_LEVEL_COPY[2].name })).toBeTruthy();
  });

  it("placed level with no recommendation shows an honest no-next-step state (no fabricated task)", () => {
    render(<GrowthJourneyCard level={3} stale={false} nextStep={null} />);
    expect(screen.getByText(MATURITY_LEVEL_COPY[3].name)).toBeTruthy();
    expect(screen.getByText(/Nothing needs fixing right now/i)).toBeTruthy();
  });

  it("null level renders the honest 'not enough data' state, never a placeholder L0", () => {
    const { container } = render(
      <GrowthJourneyCard level={null} stale={false} nextStep={null} />,
    );
    expect(screen.getByText(/still forming/i)).toBeTruthy();
    // No next step is offered without a placed level.
    expect(screen.queryByText(/Your next step/i)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/Score\s*\d/i);
  });

  it("stale renders the withheld state, never a confident low level", () => {
    render(<GrowthJourneyCard level={null} stale={true} nextStep={NEXT_STEP} />);
    expect(screen.getByText(/paused until your next sync/i)).toBeTruthy();
    // A stale surface offers no next step (it isn't placed).
    expect(screen.queryByText(/Your next step/i)).toBeNull();
  });
});

describe("CoachingCard — dedicated coaching home (W5-C)", () => {
  it("renders each recommendation with its task-focused title", () => {
    render(<CoachingCard recommendations={[NEXT_STEP]} />);
    expect(screen.getByText(NEXT_STEP.title)).toBeTruthy();
    expect(screen.getByText("Guidance")).toBeTruthy();
  });

  it("shows an honest empty state when there are no recommendations", () => {
    render(<CoachingCard recommendations={[]} />);
    expect(screen.getByText(/No coaching to show yet/i)).toBeTruthy();
  });
});

describe("DailyNudgeCard — one fresh fact (W5-C)", () => {
  it("renders the single fact when a nudge is present", () => {
    const nudge = buildDailyNudge({
      freshestSyncAt: "2026-07-12",
      agentic: { kind: "measured", agenticDays: 4, activeDays: 9 },
      spendCents: 0,
      hasScores: true,
    });
    render(<DailyNudgeCard nudge={nudge} />);
    expect(screen.getByText(/Agents are showing up/i)).toBeTruthy();
    expect(screen.getByText(/Today's signal/i)).toBeTruthy();
  });

  it("renders NOTHING when there is no fresh fact (never a nag — principle 7)", () => {
    const { container } = render(<DailyNudgeCard nudge={null} />);
    expect(container.textContent).toBe("");
  });
});

describe("buildDailyNudge — positive-first priority (pure)", () => {
  it("prefers measured agentic depth as the fact", () => {
    const nudge = buildDailyNudge({
      freshestSyncAt: "2026-07-12",
      agentic: { kind: "measured", agenticDays: 3, activeDays: 10 },
      spendCents: 5000,
      hasScores: true,
    });
    expect(nudge?.headline).toMatch(/Agents/i);
    expect(nudge?.detail).toMatch(/3 of your 10/);
  });

  it("falls back to consolidated spend, then live scores", () => {
    expect(
      buildDailyNudge({
        freshestSyncAt: "2026-07-12",
        agentic: { kind: "noAgenticData" },
        spendCents: 5000,
        hasScores: true,
      })?.headline,
    ).toMatch(/spend/i);
    expect(
      buildDailyNudge({
        freshestSyncAt: "2026-07-12",
        agentic: { kind: "noAgenticData" },
        spendCents: 0,
        hasScores: true,
      })?.headline,
    ).toMatch(/scores are live/i);
  });

  it("returns null when there is no fresh sync and nothing to say", () => {
    expect(
      buildDailyNudge({
        freshestSyncAt: null,
        agentic: { kind: "noActivity" },
        spendCents: 0,
        hasScores: false,
      }),
    ).toBeNull();
  });
});
