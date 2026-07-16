import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("shows the background-placeholder message", () => {
    render(<App />);
    expect(
      screen.getByText(
        "Revealyst runs quietly in the background. Nothing is collected yet.",
      ),
    ).toBeTruthy();
  });
});
