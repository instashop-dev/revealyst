// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { BANNED_PHRASING } from "../../../tests/helpers/banned-phrasing";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { RemoveMemberDialog } from "./remove-member-dialog";

beforeEach(() => {
  mocks.refresh.mockClear();
  mocks.toastError.mockClear();
  mocks.toastSuccess.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("RemoveMemberDialog", () => {
  it("has no axe violations and no banned phrasing (trigger + open dialog)", async () => {
    const { container } = render(
      <RemoveMemberDialog userId="u1" label="Dana" />,
    );
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(await screen.findByText(/Remove Dana\?/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(BANNED_PHRASING);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("DELETEs the member and refreshes on confirm", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<RemoveMemberDialog userId="u-42" label="Dana" />);
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /remove member/i }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/org/members/u-42",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("surfaces the server's plain-English guard message on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This is the workspace's only admin." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RemoveMemberDialog userId="u-9" label="Dana" />);
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /remove member/i }),
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "This is the workspace's only admin.",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
