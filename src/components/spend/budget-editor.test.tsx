// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { BudgetEditor } from "./budget-editor";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("BudgetEditor", () => {
  it("shows a pending spinner while saving, then surfaces the server error message", async () => {
    const user = userEvent.setup();
    // A fetch that stays pending until we resolve it, so the busy state (and
    // its spinner) is observable mid-flight.
    let resolveFetch!: (value: {
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }) => void;
    const pending = new Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);

    render(<BudgetEditor initialLimitCents={null} thresholds={[50, 80, 100]} />);
    await user.type(screen.getByLabelText("Monthly budget (USD)"), "100");
    await user.click(screen.getByRole("button", { name: "Set budget" }));

    // The house pending indicator (Spinner renders role=status aria-label="Loading").
    expect(
      await screen.findByRole("status", { name: "Loading" }),
    ).toBeInTheDocument();

    // Resolve with a 400 carrying the server's { error } message.
    resolveFetch({
      ok: false,
      status: 400,
      json: async () => ({ error: "monthly limit exceeds account cap" }),
    });

    // The toast surfaces the SERVER message, not a fixed string.
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("monthly limit exceeds account cap"),
    );
    // Spinner clears once the request settles.
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument(),
    );
  });

  it("falls back to a default message when the error body has no server message", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("no body");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BudgetEditor initialLimitCents={2500} thresholds={[50, 80, 100]} />);
    await user.clear(screen.getByLabelText("Monthly budget (USD)"));
    await user.type(screen.getByLabelText("Monthly budget (USD)"), "50");
    await user.click(screen.getByRole("button", { name: "Update budget" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not save the budget"),
    );
  });
});
