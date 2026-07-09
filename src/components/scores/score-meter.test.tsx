// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScoreMeter } from "./score-meter";

describe("ScoreMeter", () => {
  it("renders meter semantics with the correct aria values and accessible name", () => {
    render(<ScoreMeter value={42} label="Fluency score" />);

    const meter = screen.getByRole("meter", { name: "Fluency score" });
    expect(meter).toHaveAttribute("aria-valuenow", "42");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("honors a custom max for aria-valuemax and aria-valuenow", () => {
    render(<ScoreMeter value={3} label="Active days" max={7} />);

    const meter = screen.getByRole("meter", { name: "Active days" });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemax", "7");
  });
});
