// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ManagerNotesSection, type ManagerNoteVM } from "./manager-notes-section";
import { MANAGER_NOTES_COPY } from "@/lib/manager-capability-copy";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// D-TCI-7 (ADR 0053): the notes section renders the add form, the author-
// attributed list with follow-up chips, the author-only delete affordance, and
// the co-manager/never-shown-to-the-person disclosure — with no a11y violations.

const CURRENT_USER = "mgr-current";
const NOTES: ManagerNoteVM[] = [
  {
    id: "note-1",
    authorUserId: CURRENT_USER,
    authorName: "Morgan Lee",
    body: "Paired on prompt drafting — going well.",
    followUpOn: "2026-08-01",
    createdAt: new Date().toISOString(),
  },
  {
    id: "note-2",
    authorUserId: "mgr-other",
    authorName: "Sam Chen",
    body: "Asked about agent workflows.",
    followUpOn: null,
    createdAt: new Date().toISOString(),
  },
];

describe("ManagerNotesSection (D-TCI-7, ADR 0053)", () => {
  it("renders the visibility disclosure, both notes with author bylines, and the follow-up chip", () => {
    render(
      <ManagerNotesSection
        personId="p-1"
        currentUserId={CURRENT_USER}
        notes={NOTES}
      />,
    );
    expect(screen.getByText(MANAGER_NOTES_COPY.description)).toBeTruthy();
    expect(
      screen.getByText("Paired on prompt drafting — going well."),
    ).toBeTruthy();
    expect(screen.getByText(/Morgan Lee/)).toBeTruthy();
    expect(screen.getByText(/Sam Chen/)).toBeTruthy();
    expect(
      screen.getByText(MANAGER_NOTES_COPY.followUpChip("2026-08-01")),
    ).toBeTruthy();
  });

  it("shows the delete affordance ONLY on the caller's own notes", () => {
    render(
      <ManagerNotesSection
        personId="p-1"
        currentUserId={CURRENT_USER}
        notes={NOTES}
      />,
    );
    // One own note → exactly one delete button (the server enforces
    // author-only regardless; this is the honest-affordance check).
    expect(
      screen.getAllByRole("button", {
        name: MANAGER_NOTES_COPY.deleteLabel,
      }),
    ).toHaveLength(1);
  });

  it("shows the empty state (with the add form) when there are no notes", () => {
    render(
      <ManagerNotesSection
        personId="p-1"
        currentUserId={CURRENT_USER}
        notes={[]}
      />,
    );
    expect(screen.getByText(MANAGER_NOTES_COPY.empty)).toBeTruthy();
    expect(
      screen.getByPlaceholderText(MANAGER_NOTES_COPY.placeholder),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: MANAGER_NOTES_COPY.addAction }),
    ).toBeTruthy();
  });

  it("has no detectable a11y violations", async () => {
    const { container } = render(
      <ManagerNotesSection
        personId="p-1"
        currentUserId={CURRENT_USER}
        notes={NOTES}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
