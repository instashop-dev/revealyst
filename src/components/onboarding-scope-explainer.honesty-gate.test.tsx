// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Fix 5 — the honesty gate's NEGATIVE branch. `agentNeverReadsPrompts()` is a
// DERIVED precondition: it stays true only while the on-device collection
// schema proves nothing but counts/model ids leave the device. If a future
// schema change started sending free text, the gate must FAIL CLOSED — the
// standing privacy line is WITHHELD entirely, never swapped for a weaker
// substitute claim. We simulate that regression by mocking the collection
// schema so a non-count, non-model field is marked as leaving the device.
//
// This lives in its own file because the mock replaces the whole schema module
// (hoisted, file-wide) — the positive-branch assertions stay in the sibling
// onboarding-scope-explainer.test.tsx against the real schema.
vi.mock("@/lib/agent-collection-schema", () => ({
  AGENT_NEVER_COLLECTED: ["Prompt text and assistant replies"],
  AGENT_SENT_FIELDS: [
    {
      field: "promptText",
      label: "Prompt text",
      sourceToken: "record.promptText",
      sent: true,
      purpose: "",
    },
  ],
}));

import {
  OnboardingScopeExplainer,
  agentNeverReadsPrompts,
} from "./onboarding-scope-explainer";

describe("OnboardingScopeExplainer — honesty gate fails closed", () => {
  it("agentNeverReadsPrompts() is false when a non-count field leaves the device", () => {
    expect(agentNeverReadsPrompts()).toBe(false);
  });

  it("renders NO standing line (no weaker substitute) for the agent", () => {
    render(<OnboardingScopeExplainer vendor="claude_code_local" />);
    // The whole standing privacy claim is withheld — not softened.
    expect(screen.queryByText(/never your prompts/i)).toBeNull();
    // The component still renders the honest never-collected bullets.
    expect(
      screen.getByText("Prompt text and assistant replies"),
    ).toBeTruthy();
  });
});
