import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentSnapshot } from "../lib/agent";
import StatusScreen from "./status";

afterEach(cleanup);

const snapshot: AgentSnapshot = {
  state: "onboarding",
  version: "0.1.0",
  platform: "windows",
  autostart: false,
  logDir: "C:\\Users\\me\\AppData\\Local\\com.revealyst.desktop\\logs",
};

describe("StatusScreen", () => {
  it("shows honest not-connected placeholders — never fake data", () => {
    render(<StatusScreen snapshot={snapshot} />);
    expect(screen.getByText("Setup needed")).toBeTruthy();
    expect(screen.getByText("Not signed in yet")).toBeTruthy();
    expect(screen.getByText("Not set up yet")).toBeTruthy();
    expect(screen.getByText("Never — not connected yet")).toBeTruthy();
    // F3 honesty: the mode row states the default without implying an active
    // collection mechanism.
    expect(
      screen.getByText("Analytics Only (the default — collection isn't built yet)"),
    ).toBeTruthy();
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Source detection is not available yet")).toBeTruthy();
    expect(screen.getByText("Nothing — no data is collected yet")).toBeTruthy();
    expect(screen.getByText("Automatic updates are not available yet")).toBeTruthy();
  });

  it("shows the real app version from the snapshot", () => {
    render(<StatusScreen snapshot={snapshot} />);
    expect(screen.getByText("0.1.0")).toBeTruthy();
  });

  it("renders placeholders when no snapshot is available yet", () => {
    render(<StatusScreen snapshot={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
