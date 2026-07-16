// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { RecommendationCard } from "./recommendation-card";
import type { AttentionItem } from "@/lib/score-insights";

const REC: AttentionItem = {
  severity: "info",
  kind: "recommendation",
  title: "Make AI part of the daily routine",
  body: "The active-days part of Adoption is measuring low.",
  recId: "adoption-active-days",
};

describe("RecommendationCard — U0.3 extraction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the rec's title, body, why line, and confidence disclosure", () => {
    render(
      <RecommendationCard
        item={{
          ...REC,
          whyLine: "This is where the score has the most room to grow.",
          confidenceNote: "Based on 3 connected sources.",
        }}
      />,
    );
    expect(screen.getByText(REC.title)).toBeTruthy();
    expect(screen.getByText(REC.body)).toBeTruthy();
    expect(screen.getByText(/Why this:/)).toBeTruthy();
    expect(screen.getByText(/most room to grow/)).toBeTruthy();
    expect(screen.getByText(/Based on 3 connected sources/)).toBeTruthy();
  });

  it("renders no interaction affordances without a personId (manager/no-person)", () => {
    render(<RecommendationCard item={REC} />);
    expect(screen.queryByRole("button", { name: /Snooze/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss/i })).toBeNull();
  });

  it("a tried rec shows a static indicator, not the mark-tried button", () => {
    render(<RecommendationCard item={REC} personId="p-1" tried />);
    expect(screen.getByText(/Marked as tried/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mark as tried/i })).toBeNull();
    // Snooze/dismiss stay available on a tried rec.
    expect(screen.getByRole("button", { name: /Snooze/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dismiss/i })).toBeTruthy();
  });

  it("Dismiss POSTs the dismiss state, offers a 10s Undo toast, and Undo POSTs cleared", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationCard item={REC} personId="p-1" />);
    await user.click(screen.getByRole("button", { name: /Dismiss/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [dismissUrl, dismissInit] = fetchMock.mock.calls[0];
    expect(dismissUrl).toBe("/api/recommendations/interaction");
    expect(JSON.parse((dismissInit as { body: string }).body)).toEqual({
      personId: "p-1",
      recId: "adoption-active-days",
      state: "dismissed",
    });
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());

    // The success toast was called with a 10s duration + an Undo action.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [, toastOptions] = toastSuccess.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(toastOptions.duration).toBe(10_000);
    expect(toastOptions.action.label).toBe("Undo");

    // Never the only path: the row's own buttons are still present.
    expect(screen.getByRole("button", { name: /Dismiss/i })).toBeTruthy();

    // Firing the toast's Undo action restores the ACTUAL prior state: this
    // rec was never interacted with, so undo POSTs "cleared" (ADR 0043) —
    // the row is deleted, never a fabricated "tried".
    toastOptions.action.onClick();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [undoUrl, undoInit] = fetchMock.mock.calls[1];
    expect(undoUrl).toBe("/api/recommendations/interaction");
    expect(JSON.parse((undoInit as { body: string }).body)).toEqual({
      personId: "p-1",
      recId: "adoption-active-days",
      state: "cleared",
    });
  });

  it("Undo on an already-tried rec restores 'tried' (the true prior state)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationCard item={REC} personId="p-1" tried />);
    await user.click(screen.getByRole("button", { name: /Dismiss/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [, toastOptions] = toastSuccess.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    toastOptions.action.onClick();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, undoInit] = fetchMock.mock.calls[1];
    expect(JSON.parse((undoInit as { body: string }).body)).toEqual({
      personId: "p-1",
      recId: "adoption-active-days",
      state: "tried",
    });
  });

  it("Snooze also offers the 10s Undo toast", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationCard item={REC} personId="p-1" />);
    await user.click(screen.getByRole("button", { name: /Snooze/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [, toastOptions] = toastSuccess.mock.calls[0] as [
      string,
      { duration: number; action: { label: string } },
    ];
    expect(toastOptions.duration).toBe(10_000);
    expect(toastOptions.action.label).toBe("Undo");
  });

  it("Mark as tried does NOT offer an undo toast (out of scope — no toast options)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecommendationCard item={REC} personId="p-1" />);
    await user.click(screen.getByRole("button", { name: /Mark as tried/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][1]).toBeUndefined();
  });
});
