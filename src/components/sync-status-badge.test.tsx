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

describe("SyncStatusBadge limited coverage (honesty gaps)", () => {
  it("shows 'Working — can't see everything' when the latest run reports gaps", () => {
    render(
      <SyncStatusBadge
        status="active"
        lastSuccessAt={hoursAgo(2)}
        gapKinds={["sub_daily_unavailable"]}
      />,
    );
    expect(screen.getByText(/can't see everything/)).toBeInTheDocument();
    // The plain green "Synced X ago" badge is NOT shown as the label — the
    // freshness time moves into the tooltip so the surface never implies
    // complete coverage.
    expect(screen.queryByText(/^Synced 2h ago$/)).not.toBeInTheDocument();
  });

  it("stays a plain Synced badge when there are no gaps", () => {
    render(
      <SyncStatusBadge
        status="active"
        lastSuccessAt={hoursAgo(2)}
        gapKinds={[]}
      />,
    );
    expect(screen.getByText(/Synced 2h ago/)).toBeInTheDocument();
    expect(screen.queryByText(/can't see everything/)).not.toBeInTheDocument();
  });

  it("ignores unknown gap kinds (drift-safe) and falls back to Synced", () => {
    render(
      <SyncStatusBadge
        status="active"
        lastSuccessAt={hoursAgo(2)}
        gapKinds={["not_a_real_kind" as never]}
      />,
    );
    expect(screen.getByText(/Synced 2h ago/)).toBeInTheDocument();
    expect(screen.queryByText(/can't see everything/)).not.toBeInTheDocument();
  });

  it("never shows limited coverage for a not-yet-synced connection", () => {
    render(
      <SyncStatusBadge
        status="pending"
        lastSuccessAt={null}
        gapKinds={["oauth_actors_missing"]}
      />,
    );
    expect(screen.getByText("Waiting for first sync")).toBeInTheDocument();
    expect(screen.queryByText(/can't see everything/)).not.toBeInTheDocument();
  });
});
