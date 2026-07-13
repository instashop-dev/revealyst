// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTrustCard } from "./data-trust-card";

describe("DataTrustCard", () => {
  it("summarizes single-source coverage as an aggregate (never a named list)", () => {
    render(
      <DataTrustCard
        coverage={{ single: 2, total: 5 }}
        gaps={[{ kind: "shared_key_not_person_level", detail: "Cursor team key" }]}
      />,
    );
    expect(
      screen.getByText(/2 of 5 identified people rely on a single source/i),
    ).toBeTruthy();
    // The gap kind renders with its glossary label + the connector detail.
    expect(screen.getByText("Shared key, not person-level")).toBeTruthy();
    expect(screen.getByText("Cursor team key")).toBeTruthy();
  });

  it("renders the honest empty states with no people or gaps", () => {
    render(<DataTrustCard coverage={null} gaps={[]} />);
    expect(screen.getByText(/No identity-resolved people yet/i)).toBeTruthy();
    expect(
      screen.getByText(/No connector is reporting degraded or partial attribution/i),
    ).toBeTruthy();
  });

  it("states full multi-source coverage positively", () => {
    render(<DataTrustCard coverage={{ single: 0, total: 4 }} gaps={[]} />);
    expect(
      screen.getByText(/All 4 identified people are covered by more than one source/i),
    ).toBeTruthy();
  });
});
