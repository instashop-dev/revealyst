// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

// The curriculum drawer (U0.7) mounts a Sheet reading `useIsMobile`; jsdom has
// no matchMedia, so stub the hook (desktop keeps assertions unaffected). Same
// pattern as companion-cards.test.tsx.
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CapabilityFullListCard } from "./capability-full-list-card";
import { GrowthJourneyCard } from "./growth-journey-card";
import { MissionBoard, type MissionBoardRow } from "./mission-board";
import { MissionRow, type MissionBoardRow as MissionRowType } from "./mission-row";
import {
  CAPABILITY_PROFILE_COPY,
  GROWTH_PAGE_COPY,
  MISSION_COPY,
} from "@/lib/capability-glossary";
import { MATURITY_LEVEL_COPY } from "@/lib/maturity-glossary";
import type { AttentionItem } from "@/lib/score-insights";

const LABELS = new Map([
  ["ai-coding-foundations", "Make AI part of daily work"],
  ["feature-breadth", "Use a range of AI features"],
  ["effective-prompting", "Write effective prompts"],
]);

const NEXT_STEP: AttentionItem = {
  severity: "info",
  kind: "recommendation",
  title: "Try a new tool",
  body: "body",
};

describe("GrowthJourneyCard — growth variant (U1.3)", () => {
  it("expands the level MEANING into a narrative paragraph (from maturity-glossary)", () => {
    render(
      <GrowthJourneyCard level={2} stale={false} nextStep={null} variant="growth" />,
    );
    // Level name headline (unchanged source).
    expect(screen.getByText(MATURITY_LEVEL_COPY[2].name)).toBeTruthy();
    // The fuller description paragraph — growth-only.
    expect(screen.getByText(MATURITY_LEVEL_COPY[2].description)).toBeTruthy();
  });

  it("does NOT render a coaching next-step block (that's the Today hero's CTA)", () => {
    render(
      <GrowthJourneyCard level={2} stale={false} nextStep={NEXT_STEP} variant="growth" />,
    );
    expect(screen.queryByText(/Your next step/i)).toBeNull();
    expect(screen.queryByText(NEXT_STEP.title)).toBeNull();
  });

  it("companion variant is unchanged: no description paragraph, keeps the next step", () => {
    render(<GrowthJourneyCard level={2} stale={false} nextStep={NEXT_STEP} />);
    expect(screen.queryByText(MATURITY_LEVEL_COPY[2].description)).toBeNull();
    expect(screen.getByText(/Your next step/i)).toBeTruthy();
    expect(screen.getByText(NEXT_STEP.title)).toBeTruthy();
  });
});

describe("CapabilityFullListCard (Growth, U1.3)", () => {
  const ROWS = [
    {
      capabilitySlug: "ai-coding-foundations",
      label: "Make AI part of daily work",
      mastery: 0.82,
      confidenceTier: "directional",
      nextCapability: "feature-breadth",
      lastEvidenceAt: "2026-07-12",
    },
    {
      capabilitySlug: "feature-breadth",
      label: "Use a range of AI features",
      mastery: 0.4,
      confidenceTier: "measured",
      nextCapability: null,
      lastEvidenceAt: null,
    },
  ];

  it("renders EVERY evidenced row (not just the strongest few)", () => {
    render(<CapabilityFullListCard rows={ROWS} labels={LABELS} />);
    expect(screen.getByText("Make AI part of daily work")).toBeTruthy();
    expect(screen.getByText("Use a range of AI features")).toBeTruthy();
    // Bands, never the raw 0–1 number.
    expect(screen.getByText("Established")).toBeTruthy(); // 0.82
    expect(screen.getByText("Developing")).toBeTruthy(); // 0.40
  });

  it("shows a confidence pill + last-evidence recency, honest when the date is absent", () => {
    const { container } = render(
      <CapabilityFullListCard rows={ROWS} labels={LABELS} />,
    );
    expect(screen.getByText("early read")).toBeTruthy(); // directional
    expect(screen.getByText("measured")).toBeTruthy();
    // UTC-pinned so the date never renders a day early on a west-of-UTC host.
    expect(screen.getByText(/Last measured Jul 12/)).toBeTruthy();
    // The row with no date shows the honest "not recorded" copy — never a made-up date.
    expect(screen.getByText(/Recency not recorded/)).toBeTruthy();
    // Never the raw mastery number.
    expect(container.textContent).not.toContain("0.82");
  });

  it("renders a per-row 'See how to grow this' trigger for capabilities with a curriculum", () => {
    render(<CapabilityFullListCard rows={ROWS} labels={LABELS} />);
    // At least one row exposes the grow trigger.
    expect(
      screen.getAllByRole("button", { name: /See how to grow this/i }).length,
    ).toBeGreaterThan(0);
  });

  it("guards its own empty state (no evidenced rows) — never an empty card shell", () => {
    render(<CapabilityFullListCard rows={[]} labels={LABELS} />);
    // Default forming empty state, honest — no fabricated bar.
    expect(screen.getByText(CAPABILITY_PROFILE_COPY.forming.headline)).toBeTruthy();
  });

  it("renders a caller-supplied empty state when there are no rows", () => {
    render(
      <CapabilityFullListCard
        rows={[]}
        labels={LABELS}
        emptyState={<p>Connect a tool to get started</p>}
      />,
    );
    expect(screen.getByText("Connect a tool to get started")).toBeTruthy();
  });
});

describe("MissionBoard — grouped active / available / completed (U1.3)", () => {
  const MISSIONS: MissionBoardRow[] = [
    { slug: "m1", title: "In flight", summary: "s1", status: "in-progress", stepsReached: 1, totalSteps: 2 },
    { slug: "m2", title: "Not yet", summary: "s2", status: "not-started", stepsReached: 0, totalSteps: 1 },
    { slug: "m3", title: "Done one", summary: "s3", status: "complete", stepsReached: 1, totalSteps: 1, completedAt: "2026-07-10T00:00:00.000Z" },
  ];

  it("groups the three states under labelled headings, with a completion date", () => {
    render(<MissionBoard missions={MISSIONS} />);
    // Query the section HEADINGS (the "Completed" badge is a span, not a heading).
    expect(
      screen.getByRole("heading", { name: MISSION_COPY.groups.active }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: MISSION_COPY.groups.available }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: MISSION_COPY.groups.completed }),
    ).toBeTruthy();
    expect(screen.getByText(/1 of 2 steps reached/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start this mission/i })).toBeTruthy();
    // The completed timeline shows the date.
    expect(screen.getByText(/Completed Jul 10, 2026/)).toBeTruthy();
  });

  it("shows an honest empty state when the catalog has no missions", () => {
    render(<MissionBoard missions={[]} />);
    expect(screen.getByText(MISSION_COPY.empty)).toBeTruthy();
  });

  it("renders NO gamification vocabulary anywhere", () => {
    const { container } = render(<MissionBoard missions={MISSIONS} />);
    expect(container.textContent?.toLowerCase()).not.toMatch(
      /streak|xp|league|leaderboard|points|badge|level up|level-up/,
    );
  });
});

// The SHARED mission-row renderer (U1.3 dedup) — the three honest states used by
// BOTH MissionCard (Today active strip) and MissionBoard (grouped board). State
// coverage lives here now that both cards delegate to it.
describe("MissionRow — shared three-state renderer (U1.3)", () => {
  const renderRow = (mission: MissionRowType) =>
    render(
      <ul>
        <MissionRow mission={mission} />
      </ul>,
    );

  it("not-started renders a Start button (no measured claim)", () => {
    renderRow({ slug: "m", title: "T", summary: "s", status: "not-started", stepsReached: 0, totalSteps: 1 });
    expect(screen.getByRole("button", { name: /Start this mission/i })).toBeTruthy();
  });

  it("in-progress renders 'N of M steps reached' (plain words, not a meter)", () => {
    renderRow({ slug: "m", title: "T", summary: "s", status: "in-progress", stepsReached: 1, totalSteps: 2 });
    expect(screen.getByText(/1 of 2 steps reached/)).toBeTruthy();
  });

  it("complete renders the done badge + a UTC-pinned completion date when present", () => {
    renderRow({
      slug: "m",
      title: "T",
      summary: "s",
      status: "complete",
      stepsReached: 1,
      totalSteps: 1,
      completedAt: "2026-07-10T00:00:00.000Z",
    });
    expect(screen.getByText(MISSION_COPY.doneBadge)).toBeTruthy();
    expect(screen.getByText(/Completed Jul 10, 2026/)).toBeTruthy();
  });

  it("complete with no date falls back to the grounded complete line (never a made-up date)", () => {
    renderRow({ slug: "m", title: "T", summary: "s", status: "complete", stepsReached: 1, totalSteps: 1 });
    expect(screen.getByText(MISSION_COPY.completeLine)).toBeTruthy();
  });
});

// Banned-phrasing / anti-gamification sweep over the NEW Growth copy (invariant
// b + Spec V4 §8.4 + NOT-019 LMS ban). Every rendered string added by U1.3 must
// be free of invented benchmarks AND of gamification/LMS vocabulary.
describe("Growth copy — banned-phrasing sweep (U1.3)", () => {
  // Sweep the rendered STRING VALUES only — never the object KEYS (a code
  // identifier like `doneBadge` is not user-facing copy).
  const collectStrings = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (typeof v === "function") return [];
    if (v && typeof v === "object") {
      return Object.values(v as Record<string, unknown>).flatMap(collectStrings);
    }
    return [];
  };
  const allCopy = collectStrings({ GROWTH_PAGE_COPY, MISSION_COPY })
    .join(" ")
    .toLowerCase();

  it("states no invented benchmark/threshold as fact", () => {
    expect(allCopy).not.toMatch(
      /industry (average|standard|benchmark)|top.quartile|percentile|typical (teams|orgs) score/,
    );
  });

  it("carries no XP/streak/league/points/badge or course/lesson/certification vocabulary", () => {
    for (const banned of [
      "xp",
      "streak",
      "league",
      "leaderboard",
      "points",
      "badge",
      "level up",
      "level-up",
      "course",
      "lesson",
      "certification",
    ]) {
      expect(allCopy.includes(banned), `banned word "${banned}"`).toBe(false);
    }
  });
});

describe("Growth cards — axe smoke (U1.3)", () => {
  it("GrowthJourneyCard (growth variant) has no detectable a11y violations", async () => {
    const { container } = render(
      <GrowthJourneyCard level={2} stale={false} nextStep={null} variant="growth" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("CapabilityFullListCard has no detectable a11y violations", async () => {
    const { container } = render(
      <CapabilityFullListCard
        rows={[
          {
            capabilitySlug: "ai-coding-foundations",
            label: "Make AI part of daily work",
            mastery: 0.82,
            confidenceTier: "directional",
            nextCapability: "feature-breadth",
            lastEvidenceAt: "2026-07-12",
          },
        ]}
        labels={LABELS}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("MissionBoard has no detectable a11y violations", async () => {
    const { container } = render(
      <MissionBoard
        missions={[
          { slug: "m1", title: "In flight", summary: "s1", status: "in-progress", stepsReached: 1, totalSteps: 2 },
          { slug: "m3", title: "Done", summary: "s3", status: "complete", stepsReached: 1, totalSteps: 1, completedAt: "2026-07-10T00:00:00.000Z" },
        ]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
