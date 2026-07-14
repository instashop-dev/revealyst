// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { CapabilityProfileCard } from "./capability-profile-card";
import { CoachingCard } from "./coaching-card";
import { DailyNudgeCard } from "./daily-nudge-card";
import { MissionCard } from "./mission-card";
import { GrowthJourneyCard } from "./growth-journey-card";
import { MilestoneCard } from "./milestone-card";
import { buildDailyNudge } from "@/lib/companion-glossary";
import { MATURITY_LEVEL_COPY } from "@/lib/maturity-glossary";
import { detectMilestones, type Milestone } from "@/lib/milestones";
import { compareWorkflowDiversity } from "@/lib/workflow-diversity";
import type { AttentionItem } from "@/lib/score-insights";

const NEXT_STEP: AttentionItem = {
  severity: "info",
  kind: "recommendation",
  title: "Make AI part of the daily routine",
  body: "The active-days part of Adoption is measuring low. A common starting point is routing one recurring task through an AI tool each day.",
};

// A rec carrying its stable id — the shape the W5-D affordances key on.
const REC_WITH_ID: AttentionItem = { ...NEXT_STEP, recId: "adoption-active-days" };

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

  it("W7-4: a MEASURED capability band, when present, becomes the headline", () => {
    render(
      <GrowthJourneyCard
        level={1}
        stale={false}
        nextStep={NEXT_STEP}
        capabilityBand="Established"
      />,
    );
    // The band leads instead of the maturity level name.
    expect(screen.getByText("Established")).toBeTruthy();
    expect(screen.getByText(/Your strongest area is/i)).toBeTruthy();
    // The maturity level name is NOT the headline in this case.
    expect(screen.queryByText(MATURITY_LEVEL_COPY[1].name)).toBeNull();
  });

  it("W7-4: null capabilityBand (today's directional case) keeps the maturity level headline", () => {
    render(
      <GrowthJourneyCard
        level={1}
        stale={false}
        nextStep={NEXT_STEP}
        capabilityBand={null}
      />,
    );
    expect(screen.getByText(MATURITY_LEVEL_COPY[1].name)).toBeTruthy();
    expect(screen.getByText(/You're at/i)).toBeTruthy();
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

  it("renders the computed why line + confidence disclosure (W7-4)", () => {
    render(
      <CoachingCard
        recommendations={[
          {
            ...NEXT_STEP,
            whyLine: "This is where the score has the most room to grow.",
            confidenceNote: "Based on 3 connected sources.",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Why this:/)).toBeTruthy();
    expect(screen.getByText(/most room to grow/)).toBeTruthy();
    expect(screen.getByText(/Based on 3 connected sources/)).toBeTruthy();
  });

  it("renders the capability label when a rec advances one (W7-1)", () => {
    render(
      <CoachingCard
        recommendations={[
          { ...NEXT_STEP, capabilityLabel: "Make AI part of daily work" },
        ]}
      />,
    );
    expect(screen.getByText(/Builds: Make AI part of daily work/)).toBeTruthy();
  });

  it("ABSENCE: renders no capability line when the rec links to none", () => {
    render(<CoachingCard recommendations={[NEXT_STEP]} />);
    // Never a fabricated "Unknown capability" — the line is simply absent.
    expect(screen.queryByText(/Builds:/)).toBeNull();
  });
});

describe("MissionCard — opt-in, un-gamified (W7-5)", () => {
  it("renders the three honest states (start / N-of-M / completed)", () => {
    const { container } = render(
      <MissionCard
        missions={[
          { slug: "m1", title: "Get started", summary: "s1", status: "not-started", stepsReached: 0, totalSteps: 1 },
          { slug: "m2", title: "Ship it", summary: "s2", status: "in-progress", stepsReached: 1, totalSteps: 2 },
          { slug: "m3", title: "Delegate", summary: "s3", status: "complete", stepsReached: 1, totalSteps: 1 },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /Start this mission/i })).toBeTruthy();
    expect(screen.getByText(/1 of 2 steps reached/)).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    // No game vocabulary anywhere in the rendered card.
    expect(container.textContent?.toLowerCase()).not.toMatch(/streak|xp|league|points|badge/);
  });

  it("renders nothing when there are no missions", () => {
    const { container } = render(<MissionCard missions={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CapabilityProfileCard — positive-first decomposition (W7-2)", () => {
  const LABELS = new Map([
    ["ai-coding-foundations", "Make AI part of daily work"],
    ["feature-breadth", "Use a range of AI features"],
  ]);

  it("shows the honest forming state when there is no evidence yet", () => {
    render(<CapabilityProfileCard rows={[]} labels={LABELS} />);
    expect(screen.getByText(/still forming/i)).toBeTruthy();
  });

  it("renders a band + early-read tier, never the raw 0–1 number", () => {
    const { container } = render(
      <CapabilityProfileCard
        rows={[
          {
            capabilitySlug: "ai-coding-foundations",
            label: "Make AI part of daily work",
            mastery: 0.82,
            confidenceTier: "directional",
            nextCapability: "feature-breadth",
          },
        ]}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("Make AI part of daily work")).toBeTruthy();
    expect(screen.getByText("Established")).toBeTruthy(); // 0.82 → band
    expect(screen.getByText("early read")).toBeTruthy(); // directional, plain
    // The raw mastery number never appears (band-not-number).
    expect(container.textContent).not.toContain("0.82");
    // Eligible-next line resolves the slug to a label.
    expect(screen.getByText(/Use a range of AI features/)).toBeTruthy();
  });
});

describe("CoachingCard — W5-D interaction affordances (self-view only)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders snooze/dismiss/mark-tried when a personId is provided", () => {
    render(<CoachingCard recommendations={[REC_WITH_ID]} personId="p-1" />);
    expect(screen.getByRole("button", { name: /Mark as tried/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Snooze/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dismiss/i })).toBeTruthy();
  });

  it("ABSENCE: renders NO affordances without a personId (manager/no-person)", () => {
    render(<CoachingCard recommendations={[REC_WITH_ID]} />);
    expect(screen.queryByRole("button", { name: /Mark as tried/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Snooze/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss/i })).toBeNull();
  });

  it("a tried rec shows a static indicator, not the mark-tried button", () => {
    render(
      <CoachingCard
        recommendations={[REC_WITH_ID]}
        personId="p-1"
        triedRecIds={["adoption-active-days"]}
      />,
    );
    expect(screen.getByText(/Marked as tried/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mark as tried/i })).toBeNull();
    // Snooze/dismiss stay available on a tried rec.
    expect(screen.getByRole("button", { name: /Dismiss/i })).toBeTruthy();
  });

  it("clicking Dismiss POSTs the dismiss state and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    render(<CoachingCard recommendations={[REC_WITH_ID]} personId="p-1" />);
    await user.click(screen.getByRole("button", { name: /Dismiss/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/recommendations/interaction");
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      personId: "p-1",
      recId: "adoption-active-days",
      state: "dismissed",
    });
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });
});

describe("MilestoneCard — positive-first celebration (W5-F)", () => {
  it("renders each grounded milestone with its badge", () => {
    const milestones: Milestone[] = detectMilestones({
      firstAgentSession: true,
      breadth: compareWorkflowDiversity(5, 4),
    });
    render(<MilestoneCard milestones={milestones} />);
    expect(screen.getByText(/Agents showed up in your work/i)).toBeTruthy();
    expect(screen.getByText(/spanning more of your AI tools/i)).toBeTruthy();
    expect(screen.getAllByText("Milestone").length).toBeGreaterThan(0);
  });

  it("ABSENCE: renders NOTHING when there are no milestones (no empty shell)", () => {
    const { container } = render(<MilestoneCard milestones={[]} />);
    expect(container.textContent).toBe("");
  });

  it("the weekly-cadence milestone shows NO streak counter (no-streak decision)", () => {
    const milestones = detectMilestones({ activeWeeks: 8 });
    const { container } = render(<MilestoneCard milestones={milestones} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/steady weekly rhythm/i);
    // No digit anywhere — no "8 weeks", no streak count.
    expect(text).not.toMatch(/\d/);
    expect(text.toLowerCase()).not.toMatch(/streak|xp|league/);
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
