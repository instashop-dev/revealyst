// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { ManagerCapabilityProfile } from "./manager-capability-profile";
import {
  MANAGER_DRILL_IN_COPY,
  MANAGER_ROSTER_COPY,
} from "@/lib/manager-capability-copy";
import type { ManagerCapabilityRow } from "@/lib/manager-capability-view";

const ROWS: ManagerCapabilityRow[] = [
  {
    capabilitySlug: "ai-coding-foundations",
    label: "Make AI part of daily work",
    mastery: 0.82,
    confidenceTier: "directional",
    evidenceCount: 3,
    lastEvidenceAt: "2026-07-12",
  },
  {
    capabilitySlug: "feature-breadth",
    label: "Use a range of AI features",
    mastery: 0.4,
    confidenceTier: "measured",
    evidenceCount: 1,
    lastEvidenceAt: null,
  },
];

describe("ManagerCapabilityProfile (P3-A, ADR 0045)", () => {
  it("renders bands + confidence + evidence count + recency, never the raw number", () => {
    const { container } = render(<ManagerCapabilityProfile rows={ROWS} />);
    expect(screen.getByText("Make AI part of daily work")).toBeTruthy();
    expect(screen.getByText("Established")).toBeTruthy(); // 0.82 band
    expect(screen.getByText("Developing")).toBeTruthy(); // 0.40 band
    expect(screen.getByText("early read")).toBeTruthy(); // directional
    expect(screen.getByText("measured")).toBeTruthy();
    // Evidence count in plain words (singular + plural).
    expect(screen.getByText("3 signals so far")).toBeTruthy();
    expect(screen.getByText("1 signal so far")).toBeTruthy();
    // Recency: UTC-pinned when present, honest "not recorded" when absent.
    expect(screen.getByText(/Last measured Jul 12/)).toBeTruthy();
    expect(screen.getByText(/Recency not recorded/)).toBeTruthy();
    // Never the raw mastery number.
    expect(container.textContent).not.toContain("0.82");
  });

  it("renders the honesty provenance note on the surface", () => {
    render(<ManagerCapabilityProfile rows={ROWS} />);
    expect(screen.getByText(MANAGER_DRILL_IN_COPY.provenanceNote)).toBeTruthy();
  });

  it("shows an honest forming state (never zeros) when there is no evidence", () => {
    render(<ManagerCapabilityProfile rows={[]} />);
    expect(screen.getByText(MANAGER_DRILL_IN_COPY.forming.headline)).toBeTruthy();
  });

  it("renders NO actionable coaching / 'grow this' affordance", () => {
    const { container } = render(<ManagerCapabilityProfile rows={ROWS} />);
    // The self-view card exposes a "See how to grow this" curriculum trigger and
    // a "good next focus" line; the manager view must render NEITHER (coaching
    // stays self-view-only). The provenance note DOES name "recommendations" /
    // "coaching" — deliberately, to say they are withheld — so we assert only on
    // the absence of the actionable affordances, not the disclosure words.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /grow this/i })).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toMatch(
      /see how to grow|good next focus|your next step/,
    );
  });

  it("has no detectable a11y violations", async () => {
    const { container } = render(<ManagerCapabilityProfile rows={ROWS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// Banned-phrasing sweep over ALL new manager copy (invariant b + anti-deficiency
// framing): no ranking/leaderboard/performance-verdict vocabulary, no invented
// benchmark stated as fact.
describe("Manager copy — banned-phrasing sweep (P3-A)", () => {
  const collectStrings = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (typeof v === "function") return [];
    if (v && typeof v === "object") {
      return Object.values(v as Record<string, unknown>).flatMap(collectStrings);
    }
    return [];
  };
  const allCopy = collectStrings({ MANAGER_ROSTER_COPY, MANAGER_DRILL_IN_COPY })
    .join(" ")
    .toLowerCase();

  it("carries no ranking / leaderboard / verdict / gamification vocabulary", () => {
    for (const banned of [
      "leaderboard",
      "ranking",
      "rank ",
      "top performer",
      "underperform",
      "worst",
      "best performer",
      "grade",
      "score them",
      "streak",
      "points",
      "badge",
    ]) {
      expect(allCopy.includes(banned), `banned phrase "${banned}"`).toBe(false);
    }
  });

  it("states no invented benchmark/threshold as fact", () => {
    expect(allCopy).not.toMatch(
      /industry (average|standard|benchmark)|top.quartile|percentile|typical (teams|orgs) score/,
    );
  });
});
