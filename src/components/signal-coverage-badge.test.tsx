// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignalCoverageBadge } from "./signal-coverage-badge";

describe("SignalCoverageBadge", () => {
  it("renders a plural source count", () => {
    render(
      <SignalCoverageBadge
        coverage={{ sourceCount: 3, vendors: ["cursor", "openai", "anthropic_console"] }}
      />,
    );
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });

  it("renders the singular for exactly one source", () => {
    render(<SignalCoverageBadge coverage={{ sourceCount: 1, vendors: ["github_copilot"] }} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("renders a plain no-sources state (never a fabricated zero-score)", () => {
    render(<SignalCoverageBadge coverage={{ sourceCount: 0, vendors: [] }} />);
    expect(screen.getByText("No sources yet")).toBeInTheDocument();
  });

  it("renders the count badge in both self-view and team view (tooltip content is lazy)", () => {
    const { rerender } = render(
      <SignalCoverageBadge coverage={{ sourceCount: 2, vendors: ["cursor", "openai"] }} selfView />,
    );
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    // Team view (no selfView): the bare count still renders; vendor names live
    // only in the (unopened) tooltip, so they never sit in the DOM at rest.
    rerender(
      <SignalCoverageBadge coverage={{ sourceCount: 2, vendors: ["cursor", "openai"] }} />,
    );
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    expect(screen.queryByText(/Cursor, OpenAI/)).not.toBeInTheDocument();
  });
});
