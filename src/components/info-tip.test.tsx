// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InfoTip } from "./info-tip";

describe("InfoTip", () => {
  it("renders a focusable icon button with an aria-label derived from the score label", () => {
    render(<InfoTip label="Fluency" short="How consistently you use AI tools." />);

    const trigger = screen.getByRole("button", { name: "About Fluency" });
    expect(trigger).toBeInTheDocument();
  });

  it("opens the popover content on click, showing the label and short text", async () => {
    render(<InfoTip label="Fluency" short="How consistently you use AI tools." />);

    const trigger = screen.getByRole("button", { name: "About Fluency" });
    fireEvent.click(trigger);

    expect(await screen.findByText("How consistently you use AI tools.")).toBeInTheDocument();
  });

  it("opens the popover content on Enter when the trigger is focused", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="Fluency" short="How consistently you use AI tools." />);

    // userEvent (unlike fireEvent) reproduces the browser's native behavior
    // of dispatching a click when Enter is pressed on a focused <button> —
    // jsdom doesn't do this on its own for a bare fireEvent.keyDown.
    await user.tab();
    expect(screen.getByRole("button", { name: "About Fluency" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("How consistently you use AI tools.")).toBeInTheDocument();
  });

  it("closes the popover content on Escape", async () => {
    render(<InfoTip label="Fluency" short="How consistently you use AI tools." />);

    const trigger = screen.getByRole("button", { name: "About Fluency" });
    fireEvent.click(trigger);
    expect(await screen.findByText("How consistently you use AI tools.")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await screen.findByText("How consistently you use AI tools.").catch(() => {});
    expect(screen.queryByText("How consistently you use AI tools.")).not.toBeInTheDocument();
  });

  it("renders a learn-more link when learnMoreHref is provided", async () => {
    render(
      <InfoTip
        label="Fluency"
        short="How consistently you use AI tools."
        learnMoreHref="/docs/scores/fluency"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "About Fluency" }));

    const link = await screen.findByRole("link", { name: /how scores work/i });
    expect(link).toHaveAttribute("href", "/docs/scores/fluency");
  });

  it("omits the learn-more link when learnMoreHref is not provided", async () => {
    render(<InfoTip label="Fluency" short="How consistently you use AI tools." />);

    fireEvent.click(screen.getByRole("button", { name: "About Fluency" }));
    await screen.findByText("How consistently you use AI tools.");

    expect(screen.queryByRole("link", { name: /how scores work/i })).not.toBeInTheDocument();
  });
});
