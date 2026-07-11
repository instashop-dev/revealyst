// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OnboardingInterim } from "./onboarding-interim";
import {
  LOCAL_CHANNEL_VENDOR,
  SCORE_TIMING_COPY,
} from "@/lib/onboarding-guide";

describe("OnboardingInterim", () => {
  it("shows same-day timing copy and connected tools for a poll-connector org", () => {
    render(
      <OnboardingInterim
        connections={[{ vendor: "anthropic_console", status: "active" }]}
        isAdmin
      />,
    );

    expect(
      screen.getByText(SCORE_TIMING_COPY.same_day.headline),
    ).toBeInTheDocument();
    expect(screen.getByText(SCORE_TIMING_COPY.same_day.detail)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic Console/)).toBeInTheDocument();
  });

  it("shows overnight timing copy for a SYNCED local-Agent-only org (never 'today')", () => {
    render(
      <OnboardingInterim
        connections={[{ vendor: LOCAL_CHANNEL_VENDOR, status: "active" }]}
        isAdmin
      />,
    );

    expect(
      screen.getByText(SCORE_TIMING_COPY.overnight.headline),
    ).toBeInTheDocument();
    expect(screen.getByText(/nightly run/i)).toBeInTheDocument();
    // No backfill claim for the agent channel — one-shot client push (F3).
    expect(screen.queryByText(/backfill in progress/i)).not.toBeInTheDocument();
  });

  it("shows the waiting state for a paired-but-never-synced agent — no 'data is in' (F1)", () => {
    render(
      <OnboardingInterim
        connections={[{ vendor: LOCAL_CHANNEL_VENDOR, status: "pending" }]}
        isAdmin
      />,
    );

    expect(
      screen.getByText(SCORE_TIMING_COPY.awaiting_agent.headline),
    ).toBeInTheDocument();
    expect(screen.queryByText(/data is in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/by tomorrow/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/backfill in progress/i)).not.toBeInTheDocument();
  });

  it("renders nothing for a paused-only org — nothing is ingesting (F2)", () => {
    const { container } = render(
      <OnboardingInterim
        connections={[{ vendor: "openai", status: "paused" }]}
        isAdmin
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("claims 'backfill in progress' only on poll-bearing channels (F3)", () => {
    render(
      <OnboardingInterim
        connections={[{ vendor: "anthropic_console", status: "active" }]}
        isAdmin
      />,
    );
    expect(screen.getByText(/backfill in progress/i)).toBeInTheDocument();
  });

  it("renders ingestion facts only when non-zero (no teaser numbers)", () => {
    const { rerender } = render(
      <OnboardingInterim
        connections={[{ vendor: "openai", status: "active" }]}
        ingestionEvidence={{ activePeople: 0, connectionsSynced: 0 }}
        isAdmin
      />,
    );
    expect(screen.queryByText("People active")).not.toBeInTheDocument();

    rerender(
      <OnboardingInterim
        connections={[{ vendor: "openai", status: "active" }]}
        ingestionEvidence={{ activePeople: 4, connectionsSynced: 1 }}
        isAdmin
      />,
    );
    expect(screen.getByText("People active")).toBeInTheDocument();
    expect(screen.getByText("4 people")).toBeInTheDocument();
    expect(screen.getByText("Tools synced")).toBeInTheDocument();
  });

  it("hides admin-only checklist steps from non-admin members", () => {
    const { rerender } = render(
      <OnboardingInterim
        connections={[{ vendor: "openai", status: "active" }]}
        isAdmin
      />,
    );
    // Admin sees the reconcile + budget steps.
    expect(screen.getByText("Resolve identities")).toBeInTheDocument();
    expect(screen.getByText("Set a monthly budget")).toBeInTheDocument();

    rerender(
      <OnboardingInterim
        connections={[{ vendor: "openai", status: "active" }]}
        isAdmin={false}
      />,
    );
    expect(screen.queryByText("Resolve identities")).not.toBeInTheDocument();
    expect(screen.queryByText("Set a monthly budget")).not.toBeInTheDocument();
    // The non-admin still gets the universal steps.
    expect(screen.getByText("Explore the methodology")).toBeInTheDocument();
  });
});
