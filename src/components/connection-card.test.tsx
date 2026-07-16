// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

// The scope drawer picks its Sheet `side` from `useIsMobile` — mock it (jsdom
// has no `matchMedia`, which the real hook needs to mount at all), defaulting
// to desktop.
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { ConnectionCard } from "./connection-card";
import type { ScopeClaims } from "@/connectors/scope-claims";

const CLAIMS: ScopeClaims = {
  measures: ["Tokens used, by person", "Which AI models were used"],
  cannotMeasure: ["People signed in without an API key may be missing"],
};

function renderCard(overrides?: {
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  return render(
    <ConnectionCard
      displayName="My Anthropic key"
      vendorLabel="Anthropic"
      claims={CLAIMS}
      statusBadge={<span>Synced 2h ago</span>}
      primaryAction={overrides?.primaryAction}
      secondaryAction={overrides?.secondaryAction}
    />,
  );
}

describe("ConnectionCard — U2 polled grid card", () => {
  it("renders the connection name, vendor label, status badge, and the top scope claims", () => {
    renderCard({ primaryAction: <button type="button">Sync now</button> });
    expect(screen.getByText("My Anthropic key")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Synced 2h ago")).toBeInTheDocument();
    // The condensed two-line summary shows the first measure and first gap.
    expect(screen.getByText("Tokens used, by person")).toBeInTheDocument();
    expect(
      screen.getByText("People signed in without an API key may be missing"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
  });

  it("shows no admin manage control for a member (read-only = slot omitted, not disabled)", () => {
    renderCard({
      primaryAction: <button type="button">Sync now</button>,
      // no secondaryAction — a non-admin member
    });
    expect(screen.queryByRole("button", { name: /manage/i })).toBeNull();
    // A member still sees the read-only facts and can sync.
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
  });

  it("renders the admin manage control when the secondary slot is provided", () => {
    renderCard({
      primaryAction: <button type="button">Sync now</button>,
      secondaryAction: <button type="button">Manage</button>,
    });
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });

  it("has no obvious a11y violations (axe smoke) in a grid", async () => {
    const { container } = render(
      <div className="grid gap-4 sm:grid-cols-2">
        <ConnectionCard
          displayName="My Anthropic key"
          vendorLabel="Anthropic"
          claims={CLAIMS}
          statusBadge={<span>Synced 2h ago</span>}
          primaryAction={<button type="button">Sync now</button>}
        />
        <ConnectionCard
          displayName="Team Cursor"
          vendorLabel="Cursor"
          claims={CLAIMS}
          statusBadge={<span>Waiting for first sync</span>}
        />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
