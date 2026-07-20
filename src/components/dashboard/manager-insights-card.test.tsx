// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

// The dismiss button is a client leaf using useRouter + sonner + fetch — stub
// them (same pattern as companion-cards.test.tsx / growth-cards.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ManagerInsightsCard } from "./manager-insights-card";
import { CapabilityGrowthCard } from "./capability-growth-card";
import type { TeamInsightRow } from "@/db/org-scope/team-insights";
import type { CapabilityHistoryRow } from "@/lib/capability-history";
import { MANAGER_INSIGHTS_COPY } from "@/lib/team-insights-glossary";

const LABELS = new Map([
  ["ai-coding-foundations", "Make AI part of daily work"],
  ["consistent-daily-use", "Build a consistent daily habit"],
]);

const INSIGHTS: TeamInsightRow[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    teamId: null,
    category: "capability_gap",
    severity: "attention",
    subject: "ai-coding-foundations",
    params: { capabilitySlug: "ai-coding-foundations", mastered: 0, total: 6 },
    periodStart: "2026-07-01",
    status: "new",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    teamId: null,
    category: "low_adoption",
    severity: "attention",
    subject: "",
    params: { active: 3, total: 12 },
    periodStart: "2026-07-01",
    status: "viewed",
  },
];

function history(
  slug: string,
  periodStart: string,
  mastered: number,
  total: number,
): CapabilityHistoryRow {
  return {
    teamId: null,
    capabilitySlug: slug,
    periodStart,
    periodEnd: periodStart,
    representedCount: total,
    totalCount: 12,
    masteredCount: mastered,
    developingCount: total - mastered,
    masterySumBp: null,
    masterySumSqBp: null,
    confidenceTier: "directional",
  };
}

describe("ManagerInsightsCard", () => {
  it("renders plain-English copy from the glossary (count-only, no person data)", () => {
    render(
      <ManagerInsightsCard insights={INSIGHTS} capabilityLabels={LABELS} />,
    );
    expect(screen.getByText(/Room to grow in/)).toBeInTheDocument();
    expect(screen.getByText(/Most of the team is just getting started/)).toBeInTheDocument();
    // The visible text carries no email/uuid — the prop shape is count-only.
    const text = document.body.textContent ?? "";
    expect(/@/.test(text)).toBe(false);
    expect(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text),
    ).toBe(false);
    // A dismiss affordance per insight.
    expect(
      screen.getAllByRole("button", { name: new RegExp(MANAGER_INSIGHTS_COPY.dismiss, "i") }),
    ).toHaveLength(INSIGHTS.length);
  });

  it("shows an honest empty state when there are no insights", () => {
    render(<ManagerInsightsCard insights={[]} capabilityLabels={LABELS} />);
    expect(screen.getByText(MANAGER_INSIGHTS_COPY.empty)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ManagerInsightsCard insights={INSIGHTS} capabilityLabels={LABELS} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("CapabilityGrowthCard", () => {
  it("honest empty state when fewer than two periods exist", () => {
    render(
      <CapabilityGrowthCard
        rows={[history("ai-coding-foundations", "2026-07-01", 2, 6)]}
        capabilityLabels={LABELS}
      />,
    );
    expect(
      screen.getByText(/History starts accruing from this month/),
    ).toBeInTheDocument();
  });

  it("renders a per-capability trend once two periods exist", () => {
    render(
      <CapabilityGrowthCard
        rows={[
          history("ai-coding-foundations", "2026-06-01", 1, 6),
          history("ai-coding-foundations", "2026-07-01", 3, 6),
        ]}
        capabilityLabels={LABELS}
      />,
    );
    expect(screen.getByText("Make AI part of daily work")).toBeInTheDocument();
    // Latest counts shown (3 of 6), never a fabricated 0..100.
    expect(screen.getByText("3 of 6")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CapabilityGrowthCard
        rows={[
          history("ai-coding-foundations", "2026-06-01", 1, 6),
          history("ai-coding-foundations", "2026-07-01", 3, 6),
        ]}
        capabilityLabels={LABELS}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
