// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { IdentityMatchRow } from "./identity-match-row";

const PEOPLE = [{ id: "p1", pseudonym: "Owl-42", displayName: "Jordan" }];
const TEAMS: { id: string; name: string }[] = [];

function renderRow(props: {
  evidence: string | null;
  proposedMatch: { personId: string; personLabel: string } | null;
}) {
  return render(
    <table>
      <tbody>
        <IdentityMatchRow
          subject={{
            subjectId: "s1",
            label: "shared@acme.com",
            vendor: "Cursor",
            kind: "person",
            flagged: false,
          }}
          evidence={props.evidence}
          proposedMatch={props.proposedMatch}
          people={PEOPLE}
          teams={TEAMS}
        />
      </tbody>
    </table>,
  );
}

describe("IdentityMatchRow — evidence line", () => {
  it("renders the email-match evidence when present", () => {
    renderRow({
      evidence: "Email matches shared@acme.com",
      proposedMatch: { personId: "p1", personLabel: "Owl-42 · Jordan" },
    });
    expect(screen.getByText("Email matches shared@acme.com")).toBeInTheDocument();
  });

  it("shows no invented evidence when there is no match (renders the neutral placeholder)", () => {
    renderRow({ evidence: null, proposedMatch: null });
    // No fabricated "active on the same days" — just an honest placeholder.
    expect(screen.getByText("No automatic match")).toBeInTheDocument();
    expect(screen.queryByText(/Email matches/)).toBeNull();
  });

  it("offers one-click Accept only when there is a proposed match", () => {
    const { rerender } = renderRow({
      evidence: "Email matches shared@acme.com",
      proposedMatch: { personId: "p1", personLabel: "Owl-42" },
    });
    expect(screen.getByRole("button", { name: /Accept/ })).toBeInTheDocument();
    // The manual dialog trigger changes to "Someone else" beside Accept.
    expect(screen.getByRole("button", { name: /Someone else/ })).toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <IdentityMatchRow
            subject={{
              subjectId: "s1",
              label: "shared@acme.com",
              vendor: "Cursor",
              kind: "person",
              flagged: false,
            }}
            evidence={null}
            proposedMatch={null}
            people={PEOPLE}
            teams={TEAMS}
          />
        </tbody>
      </table>,
    );
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Match/ })).toBeInTheDocument();
  });

  it("has no obvious a11y violations (axe smoke)", async () => {
    const { container } = renderRow({
      evidence: "Email matches shared@acme.com",
      proposedMatch: { personId: "p1", personLabel: "Owl-42" },
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
