// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncStalenessBanner } from "./sync-staleness-banner";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

describe("SyncStalenessBanner", () => {
  it("renders for a stale local-agent org", () => {
    render(
      <SyncStalenessBanner
        connections={[
          { vendor: "claude_code_local", lastSuccessAt: daysAgo(20) },
        ]}
      />,
    );
    expect(screen.getByText("Data as of your last sync")).toBeInTheDocument();
    expect(screen.getByText(/Last synced 20d ago/)).toBeInTheDocument();
  });

  it("renders a first-sync prompt when the local agent never synced", () => {
    render(
      <SyncStalenessBanner
        connections={[{ vendor: "claude_code_local", lastSuccessAt: null }]}
      />,
    );
    expect(screen.getByText("Data as of your last sync")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for your first sync/)).toBeInTheDocument();
  });

  it("renders nothing when the local agent is fresh", () => {
    const { container } = render(
      <SyncStalenessBanner
        connections={[
          { vendor: "claude_code_local", lastSuccessAt: daysAgo(1) },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a local agent (polled-only org)", () => {
    const { container } = render(
      <SyncStalenessBanner
        connections={[
          { vendor: "anthropic", lastSuccessAt: null },
          { vendor: "openai_admin", lastSuccessAt: daysAgo(40) },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
