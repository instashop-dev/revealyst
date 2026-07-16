// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CapabilityCurriculumTrigger } from "./capability-curriculum-drawer";
import { CAPABILITY_CURRICULUM_COPY } from "@/lib/capability-curriculum";

// T4.1 (GJ-007): the curriculum drawer, opened from the capability-profile
// card's next-focus line. Covers: the opt-in affordance renders plain text
// plus a click target (never a bare unlabeled link), clicking it opens the
// drawer with the summary/how-to/try-this content, and the ordered path
// section places the focused capability correctly.

const LABELS = new Map([
  ["ai-coding-foundations", "Make AI part of daily work"],
  ["feature-breadth", "Use a range of AI features"],
]);

describe("CapabilityCurriculumTrigger", () => {
  it("renders the next-focus lead, label, and an opt-in trigger for a known slug", () => {
    render(
      <CapabilityCurriculumTrigger
        slug="feature-breadth"
        label="Use a range of AI features"
        nextLead="A good next focus"
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/A good next focus:/)).toBeTruthy();
    expect(screen.getByText("Use a range of AI features")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: CAPABILITY_CURRICULUM_COPY.triggerLabel }),
    ).toBeTruthy();
  });

  it("falls back to plain text (no dead link) when the slug has no curriculum entry", () => {
    render(
      <CapabilityCurriculumTrigger
        slug="not-a-real-capability"
        label="Something unmapped"
        nextLead="A good next focus"
        labels={LABELS}
      />,
    );
    expect(screen.getByText("Something unmapped")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: CAPABILITY_CURRICULUM_COPY.triggerLabel }),
    ).toBeNull();
  });

  it("opens the drawer with the summary, how-to steps, and try-this items on click", async () => {
    const user = userEvent.setup();
    render(
      <CapabilityCurriculumTrigger
        slug="feature-breadth"
        label="Use a range of AI features"
        nextLead="A good next focus"
        labels={LABELS}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: CAPABILITY_CURRICULUM_COPY.triggerLabel }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Growing: Use a range of AI features/),
      ).toBeTruthy();
    });
    expect(screen.getByText(CAPABILITY_CURRICULUM_COPY.howToLabel)).toBeTruthy();
    expect(screen.getByText(CAPABILITY_CURRICULUM_COPY.tryThisLabel)).toBeTruthy();
    // The entry's own summary/how-to/try-this content renders (not just labels).
    expect(
      screen.getByText(/Most AI coding tools offer more than a chat box/),
    ).toBeTruthy();
  });

  it("shows the ordered path with the focused capability highlighted", async () => {
    const user = userEvent.setup();
    render(
      <CapabilityCurriculumTrigger
        slug="ai-coding-foundations"
        label="Make AI part of daily work"
        nextLead="A good next focus"
        labels={LABELS}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: CAPABILITY_CURRICULUM_COPY.triggerLabel }),
    );
    await waitFor(() => {
      expect(screen.getByText(CAPABILITY_CURRICULUM_COPY.pathLabel)).toBeTruthy();
    });
    // The focused capability's label appears (highlighted) in the path list.
    expect(screen.getAllByText("Make AI part of daily work").length).toBeGreaterThan(0);
  });

  it("never mentions course/lesson/module/certification or gamification words", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CapabilityCurriculumTrigger
        slug="agentic-delivery"
        label="Let AI agents do more of the work"
        nextLead="A good next focus"
        labels={LABELS}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: CAPABILITY_CURRICULUM_COPY.triggerLabel }),
    );
    await waitFor(() => {
      expect(screen.getByText(CAPABILITY_CURRICULUM_COPY.howToLabel)).toBeTruthy();
    });
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of ["course", "certification", "xp", "streak", "badge", "points", "leaderboard", "league"]) {
      expect(text.includes(word), `banned word "${word}"`).toBe(false);
    }
  });
});
