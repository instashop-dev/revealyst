// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { BANNED_PHRASING } from "../../tests/helpers/banned-phrasing";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}));
const { push, refresh, toastError } = mocks;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

import { WorkspaceSwitcher } from "./workspace-switcher";
import { CreateTeamWorkspaceDialog } from "./admin/create-team-workspace-dialog";

const WORKSPACES = {
  activeOrgId: "org-personal",
  workspaces: [
    { id: "org-personal", name: "My space", kind: "personal" },
    { id: "org-team", name: "Acme Team", kind: "team" },
  ],
};

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  toastError.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkspaceSwitcher", () => {
  it("shows the active workspace name and a labeled trigger", () => {
    render(<WorkspaceSwitcher currentOrg={{ name: "My space", kind: "personal" }} />);
    expect(screen.getByText("My space")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /switch workspace/i }),
    ).toBeInTheDocument();
  });

  it("lazily loads the workspace list on open and switches on click", async () => {
    const fetchMock = vi
      .fn()
      // GET /api/org/workspaces
      .mockResolvedValueOnce({
        ok: true,
        json: async () => WORKSPACES,
      })
      // POST /api/org/workspaces (switch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, activeOrgId: "org-team" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkspaceSwitcher currentOrg={{ name: "My space", kind: "personal" }} />);
    // Nothing fetched until the menu opens.
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: /switch workspace/i }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/org/workspaces"),
    );
    // Both workspaces listed; the other one is clickable to switch.
    const target = await screen.findByText("Acme Team");
    await userEvent.click(target);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/org/workspaces",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalled();
  });

  it("has no axe violations and no banned phrasing", async () => {
    const { container } = render(
      <WorkspaceSwitcher currentOrg={{ name: "My space", kind: "personal" }} />,
    );
    expect(await axe(container)).toHaveNoViolations();
    expect(container.textContent ?? "").not.toMatch(BANNED_PHRASING);
  });

  it("offers a 'Create team workspace' affordance that opens the create dialog", async () => {
    // Menu open triggers the lazy workspace fetch — stub it so it doesn't error.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => WORKSPACES }),
    );
    render(
      <WorkspaceSwitcher currentOrg={{ name: "My space", kind: "personal" }} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /switch workspace/i }),
    );
    const createItem = await screen.findByText(/create team workspace/i);
    await userEvent.click(createItem);

    // The shared create dialog opens with plain, benchmark-free copy.
    expect(
      await screen.findByText(/a team workspace is a shared space/i),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(BANNED_PHRASING);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("offers 'Leave workspace' only for a team org, and POSTs on confirm", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        // GET workspace list (menu open)
        .mockResolvedValueOnce({ ok: true, json: async () => WORKSPACES })
        // POST /api/org/leave (confirm)
        .mockResolvedValueOnce({ ok: true }),
    );
    render(
      <WorkspaceSwitcher currentOrg={{ name: "Acme Team", kind: "team" }} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /switch workspace/i }),
    );
    const leaveItem = await screen.findByText(/leave workspace/i);
    await userEvent.click(leaveItem);
    // Confirm dialog opens with plain copy; confirm fires the leave POST.
    expect(await screen.findByText(/Leave Acme Team\?/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /leave workspace/i }),
    );
    await waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "/api/org/leave",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(document.body.textContent ?? "").not.toMatch(BANNED_PHRASING);
  });

  it("hides 'Leave workspace' for a personal org", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => WORKSPACES }),
    );
    render(
      <WorkspaceSwitcher currentOrg={{ name: "My space", kind: "personal" }} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /switch workspace/i }),
    );
    await screen.findByText(/create team workspace/i);
    expect(screen.queryByText(/leave workspace/i)).not.toBeInTheDocument();
  });
});

describe("CreateTeamWorkspaceDialog (admin)", () => {
  it("opens with plain, benchmark-free copy and no axe violations", async () => {
    const { container } = render(<CreateTeamWorkspaceDialog />);
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(
      screen.getByRole("button", { name: /new workspace/i }),
    );
    // The dialog copy explains the action in plain English.
    expect(screen.getByText(/adds you as its admin/i)).toBeInTheDocument();
    // Sweep the whole (portalled) document for banned benchmark/threshold copy.
    expect(document.body.textContent ?? "").not.toMatch(BANNED_PHRASING);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
