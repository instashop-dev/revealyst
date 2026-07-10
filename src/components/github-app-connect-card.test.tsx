// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GITHUB_APP_VENDORS } from "@/lib/vendor-connect-meta";
import { GithubAppConnectCard } from "./github-app-connect-card";

// Both render-time states of the env gate (ADR 0022): when the GitHub App
// secrets are configured the card offers the install; when they aren't
// (available=false — the founder-gated pre-NLV state) it shows an honest
// "not yet available" state with NO connect control, never a dead-end button.

const copilot = GITHUB_APP_VENDORS[0];

describe("GithubAppConnectCard", () => {
  it("available → offers the GitHub App install as a plain <a> to the setup route", () => {
    render(<GithubAppConnectCard vendor={copilot} available />);
    const link = screen.getByRole("button", { name: /connect via github app/i });
    expect(link).toHaveAttribute("href", copilot.setupPath);
    expect(screen.queryByText("Not yet available")).not.toBeInTheDocument();
  });

  it("unavailable (secrets not configured) → honest state, no connect control", () => {
    render(<GithubAppConnectCard vendor={copilot} available={false} />);
    expect(screen.getByText("Not yet available")).toBeInTheDocument();
    expect(
      screen.getByText(/final live verification/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect via github app/i }),
    ).not.toBeInTheDocument();
  });

  it("defaults to available (explicit opt-out gate, matching prior call sites)", () => {
    render(<GithubAppConnectCard vendor={copilot} />);
    expect(
      screen.getByRole("button", { name: /connect via github app/i }),
    ).toBeInTheDocument();
  });

  it("connected + available → offers connecting another org", () => {
    render(<GithubAppConnectCard vendor={copilot} connected available />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /connect another org/i }),
    ).toBeInTheDocument();
  });

  it("connected but unavailable → shows connected state without a new-install control", () => {
    render(<GithubAppConnectCard vendor={copilot} connected available={false} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
