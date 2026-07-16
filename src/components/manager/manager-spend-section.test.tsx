// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { ManagerSpendSection } from "./manager-spend-section";
import { MANAGER_SPEND_COPY } from "@/lib/manager-capability-copy";
import type { ManagerSpendView } from "@/lib/manager-spend-view";

// P3-B (ADR 0045 spend half): the manager spend section renders reported and
// estimated separately (never blended), the model mix as a share % (never a
// dollar), the coverage disclosure, and the cost≠capability note — with no a11y
// violations.

const VIEW: ManagerSpendView = {
  reported: { mtdCents: 6_000, priorCents: 4_000 },
  estimated: { mtdCents: 5_500, priorCents: 0 },
  modelVolume: [
    { model: "haiku", tokens: 3_000, sharePct: 75 },
    { model: "opus", tokens: 1_000, sharePct: 25 },
  ],
  coverage: {
    attributableSubjectCount: 1,
    sharedSubjectCount: 1,
    sharedSubjectsWithSpendCount: 1,
  },
};

describe("ManagerSpendSection (P3-B, ADR 0045)", () => {
  it("shows reported + estimated as separate figures and both windows", () => {
    render(<ManagerSpendSection spend={VIEW} />);
    expect(screen.getByText(MANAGER_SPEND_COPY.reportedLabel)).toBeTruthy();
    expect(screen.getByText(MANAGER_SPEND_COPY.estimatedLabel)).toBeTruthy();
    expect(screen.getByText("$60.00")).toBeTruthy(); // reported MTD
    expect(screen.getByText("$40.00")).toBeTruthy(); // reported prior
    expect(screen.getByText("$55.00")).toBeTruthy(); // estimated MTD
    // Hardening #2: no BLENDED total may ever render. Reported MTD ($60.00) +
    // estimated MTD ($55.00) would blend to $115.00 — its absence is the
    // invariant-(b) render guard the structural key check can't provide.
    expect(document.body.textContent).not.toContain("$115.00");
    expect(document.body.textContent).not.toContain("$100.00"); // reported mtd+prior blend
  });

  it("renders the cost≠capability note and the coverage disclosure", () => {
    render(<ManagerSpendSection spend={VIEW} />);
    expect(screen.getByText(MANAGER_SPEND_COPY.contextNote)).toBeTruthy();
    expect(
      screen.getByText(MANAGER_SPEND_COPY.coverageLine(VIEW.coverage)),
    ).toBeTruthy();
  });

  it("shows the model mix as a share %, never a dollar per model", () => {
    render(<ManagerSpendSection spend={VIEW} />);
    const list = screen.getByRole("list");
    expect(within(list).getByText("haiku")).toBeTruthy();
    expect(within(list).getByText("75%")).toBeTruthy();
    // No dollar sign anywhere in the model list (token volume only).
    expect(list.textContent).not.toContain("$");
  });

  it("shows an honest empty state when there is no attributable spend", () => {
    render(
      <ManagerSpendSection
        spend={{
          reported: { mtdCents: 0, priorCents: 0 },
          estimated: { mtdCents: 0, priorCents: 0 },
          modelVolume: [],
          coverage: {
            attributableSubjectCount: 0,
            sharedSubjectCount: 1,
            sharedSubjectsWithSpendCount: 1,
          },
        }}
      />,
    );
    expect(screen.getByText(MANAGER_SPEND_COPY.empty)).toBeTruthy();
  });

  it("has no detectable a11y violations", async () => {
    const { container } = render(<ManagerSpendSection spend={VIEW} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
