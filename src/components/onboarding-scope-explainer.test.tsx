// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import {
  OnboardingScopeExplainer,
  STANDING_PRIVACY_LINE,
  agentNeverReadsPrompts,
} from "./onboarding-scope-explainer";
import { scopeClaimsFor } from "@/connectors/scope-claims";
import {
  AGENT_NEVER_COLLECTED,
  AGENT_SENT_FIELDS,
} from "@/lib/agent-collection-schema";

// U4.2 — the scope explainer is a CLAIM SURFACE: every string it renders must
// come from a fact-checked module (scope-claims for vendors, the agent
// collection schema for the agent), never hand-typed here. These pin that
// sourcing plus the schema-verified standing line.

const VENDORS = ["anthropic_console", "openai", "cursor", "github_copilot"] as const;

describe("OnboardingScopeExplainer — vendor claims sourced from scope-claims", () => {
  for (const vendor of VENDORS) {
    it(`renders ${vendor}'s top read + gap verbatim from scopeClaimsFor`, () => {
      const claims = scopeClaimsFor(vendor);
      expect(claims).not.toBeNull();
      const { container } = render(
        <OnboardingScopeExplainer vendor={vendor} />,
      );
      // Both rendered lines exist inside the registered claim arrays — i.e. the
      // component did not invent prose.
      const text = within(container)
        .getAllByRole("listitem")
        .map((li) => li.textContent?.trim() ?? "");
      for (const line of text) {
        const inClaims =
          claims!.measures.includes(line) ||
          claims!.cannotMeasure.includes(line);
        expect(inClaims, `"${line}" must come from scope-claims`).toBe(true);
      }
    });
  }

  it("renders nothing for an unregistered vendor (never a fabricated line)", () => {
    const { container } = render(
      <OnboardingScopeExplainer vendor="not_a_vendor" />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("OnboardingScopeExplainer — agent claims sourced from the collection schema", () => {
  it("shows the schema-verified standing line and never-collected items", () => {
    render(<OnboardingScopeExplainer vendor="claude_code_local" />);
    // Standing line is only shown because the schema PROVES it.
    expect(agentNeverReadsPrompts()).toBe(true);
    expect(screen.getByText(STANDING_PRIVACY_LINE)).toBeTruthy();
    // The never-read bullets come straight from AGENT_NEVER_COLLECTED.
    expect(screen.getByText(AGENT_NEVER_COLLECTED[0])).toBeTruthy();
  });

  it("the standing line names counts/timing/model names/apps and prompts — matching the schema", () => {
    // The claim the schema licenses.
    expect(STANDING_PRIVACY_LINE.toLowerCase()).toMatch(/prompt/);
    // Completeness: model ids DO leave the device (AGENT_SENT_FIELDS), so the
    // line must own that alongside counts/timing — not imply prompts-only.
    expect(STANDING_PRIVACY_LINE.toLowerCase()).toMatch(/model/);
    expect(AGENT_SENT_FIELDS.some((f) => f.sentValueShape === "model_id")).toBe(
      true,
    );
    // Completeness (invariant b): a closed-enum app label ALSO leaves the device
    // (ai_tool_used), so the line must own "which AI apps are open" too — a
    // sent value the line may not silently omit.
    expect(
      AGENT_SENT_FIELDS.some((f) => f.sentValueShape === "closed_enum"),
    ).toBe(true);
    expect(STANDING_PRIVACY_LINE.toLowerCase()).toMatch(/app/);
    // And the schema really does list prompt text as never-collected.
    expect(AGENT_NEVER_COLLECTED.some((s) => /prompt/i.test(s))).toBe(true);
  });
});

describe("OnboardingScopeExplainer — axe", () => {
  it("has no detectable a11y violations (vendor + agent)", async () => {
    const vendor = render(<OnboardingScopeExplainer vendor="anthropic_console" />);
    expect(await axe(vendor.container)).toHaveNoViolations();
    const agent = render(<OnboardingScopeExplainer vendor="claude_code_local" />);
    expect(await axe(agent.container)).toHaveNoViolations();
  });
});
