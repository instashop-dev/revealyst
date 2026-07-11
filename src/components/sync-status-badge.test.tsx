// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncStatusBadge } from "./sync-status-badge";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);

describe("SyncStatusBadge staleness", () => {
  it("flags an active connection stale past the threshold", () => {
    render(
      <SyncStatusBadge
        status="active"
        lastSuccessAt={daysAgo(20)}
        staleAfterDays={14}
      />,
    );
    expect(screen.getByText(/may be incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Synced 20d ago/)).toBeInTheDocument();
  });

  it("shows normal Synced under the threshold", () => {
    render(
      <SyncStatusBadge
        status="active"
        lastSuccessAt={hoursAgo(2)}
        staleAfterDays={14}
      />,
    );
    expect(screen.getByText(/Synced 2h ago/)).toBeInTheDocument();
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
  });

  it("never flags stale without the prop (polled-connector regression guard)", () => {
    render(<SyncStatusBadge status="active" lastSuccessAt={daysAgo(20)} />);
    expect(screen.getByText(/Synced 20d ago/)).toBeInTheDocument();
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
  });

  it("leaves error/paused/waiting states unchanged with the prop present", () => {
    const { rerender } = render(
      <SyncStatusBadge
        status="error"
        lastSuccessAt={daysAgo(20)}
        staleAfterDays={14}
      />,
    );
    expect(screen.getByText("Sync error")).toBeInTheDocument();
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();

    rerender(
      <SyncStatusBadge
        status="paused"
        lastSuccessAt={daysAgo(20)}
        staleAfterDays={14}
      />,
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();

    rerender(
      <SyncStatusBadge
        status="active"
        lastSuccessAt={null}
        staleAfterDays={14}
      />,
    );
    expect(screen.getByText("Waiting for first sync")).toBeInTheDocument();
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
  });
});
