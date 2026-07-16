import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentSnapshot } from "../lib/agent";
import DiagnosticsScreen from "./diagnostics";

afterEach(cleanup);

const snapshot: AgentSnapshot = {
  state: "onboarding",
  version: "0.1.0",
  platform: "windows",
  autostart: false,
  logDir: "C:\\Users\\me\\AppData\\Local\\com.revealyst.desktop\\logs",
};

describe("DiagnosticsScreen", () => {
  it("shows version, platform, and log location", () => {
    render(<DiagnosticsScreen snapshot={snapshot} />);
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("Windows")).toBeTruthy();
    expect(screen.getByText(snapshot.logDir)).toBeTruthy();
  });

  it("keeps Send diagnostics disabled (M4 not built)", () => {
    render(<DiagnosticsScreen snapshot={snapshot} />);
    const button = screen.getByRole("button", { name: "Send diagnostics" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Not available yet.")).toBeTruthy();
  });

  it("renders placeholders when no snapshot is available yet", () => {
    render(<DiagnosticsScreen snapshot={null} />);
    expect(screen.getAllByText("—").length).toBe(3);
  });
});
