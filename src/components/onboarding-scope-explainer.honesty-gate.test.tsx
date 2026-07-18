// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Fix 5 — the honesty gate's NEGATIVE branch. `agentNeverUploadsPrompts()` is a
// DERIVED precondition: it stays true only while the on-device collection
// schema proves nothing but bounded values (counts / model ids / closed-enum
// labels) leave the device. If a future schema change started sending free text
// (a sent field with no bounded `sentValueShape`), the gate must FAIL CLOSED —
// the standing privacy line is WITHHELD entirely, never swapped for a weaker
// substitute claim. This is what keeps the "your prompts never leave" promise
// honest even after the agent began READING prompt text on-device to classify
// it (ADR 0059): reading on-device is fine, but the moment free text would LEAVE
// the line disappears. We simulate that regression by mocking the collection
// schema so a non-bounded field is marked as leaving the device.
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
  agentNeverUploadsPrompts,
} from "./onboarding-scope-explainer";

describe("OnboardingScopeExplainer — honesty gate fails closed", () => {
  it("agentNeverUploadsPrompts() is false when a free-text field leaves the device", () => {
    expect(agentNeverUploadsPrompts()).toBe(false);
  });

  it("renders NO standing line (no weaker substitute) for the agent", () => {
    render(<OnboardingScopeExplainer vendor="claude_code_local" />);
    // The whole standing privacy claim is withheld — not softened. Match the
    // real standing-line wording ("prompts never leave this computer") so this
    // stays a genuine "line is absent" check, not a vacuous one.
    expect(screen.queryByText(/prompts never leave/i)).toBeNull();
    // The component still renders the honest never-collected bullets.
    expect(
      screen.getByText("Prompt text and assistant replies"),
    ).toBeTruthy();
  });
});
