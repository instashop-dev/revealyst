// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { IdentityMatchRow } from "./identity-match-row";

const PEOPLE = [{ id: "p1", pseudonym: "Owl-42", displayName: "Jordan" }];
const TEAMS: { id: string; name: string }[] = [];

function renderRow(props: {
  evidence: string | null;
  proposedMatch: { personId: string; personLabel: string } | null;
  hasActivity?: boolean;
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
            hasActivity: props.hasActivity ?? false,
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
              hasActivity: false,
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

describe("IdentityMatchRow — activity hint (per hasActivity)", () => {
  it("shows 'Has usage data' when the account carries activity", () => {
    renderRow({ evidence: null, proposedMatch: null, hasActivity: true });
    expect(screen.getByText("Has usage data")).toBeInTheDocument();
    expect(screen.queryByText("No data yet")).toBeNull();
  });

  it("shows 'No data yet' when the account has no activity", () => {
    renderRow({ evidence: null, proposedMatch: null, hasActivity: false });
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByText("Has usage data")).toBeNull();
  });
});

describe("IdentityMatchRow — Accept flow (POSTs to the reconcile route)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function bodyOf(callIndex: number) {
    const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  it("POSTs {action:'link', subjectId, personId}, refreshes, and its Undo POSTs unlink", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    renderRow({
      evidence: "Email matches shared@acme.com",
      proposedMatch: { personId: "p1", personLabel: "Owl-42 · Jordan" },
    });

    await userEvent.click(screen.getByRole("button", { name: /Accept/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reconcile",
      expect.objectContaining({ method: "POST" }),
    );
    expect(bodyOf(0)).toEqual({
      action: "link",
      subjectId: "s1",
      personId: "p1",
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // The success toast exposes a one-click Undo that unlinks the same pair.
    expect(toastSuccess).toHaveBeenCalledWith(
      "Matched to Owl-42 · Jordan",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
    const undo = toastSuccess.mock.calls[0][1].action.onClick as () => void;
    await undo();
    expect(bodyOf(1)).toEqual({
      action: "unlink",
      subjectId: "s1",
      personId: "p1",
    });
  });

  it("shows the error toast and does NOT refresh when the response is not ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    renderRow({
      evidence: "Email matches shared@acme.com",
      proposedMatch: { personId: "p1", personLabel: "Owl-42" },
    });

    await userEvent.click(screen.getByRole("button", { name: /Accept/ }));

    expect(toastError).toHaveBeenCalledWith("Could not match (500)");
    expect(refresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
