import { describe, expect, it } from "vitest";

import {
  compareWorkflowDiversity,
  DEFAULT_DIVERSITY_MILESTONES,
  workflowDiversity,
} from "../src/lib/workflow-diversity";

// W5-E deliverable (3): workflow diversity as a surfaced signal. distinct-count
// parity with the engine (evaluate.ts distinct_dims) + the milestone comparator
// hook.

describe("workflowDiversity", () => {
  it("counts distinct non-empty feature dims (engine distinct_dims parity)", () => {
    const stat = workflowDiversity([
      { dim: "feature=chat" },
      { dim: "feature=chat" }, // duplicate → still one
      { dim: "feature=agent" },
      { dim: "feature=web_search" },
    ]);
    expect(stat.distinctCount).toBe(3);
    expect(stat.features).toEqual(["agent", "chat", "web_search"]);
  });

  it("ignores empty dims (a plain activity row never inflates the count)", () => {
    const stat = workflowDiversity([
      { dim: "" },
      { dim: "feature=composer" },
      { dim: "" },
    ]);
    expect(stat.distinctCount).toBe(1);
    expect(stat.features).toEqual(["composer"]);
  });

  it("empty input → zero, never a fabricated floor (invariant b)", () => {
    expect(workflowDiversity([])).toEqual({ distinctCount: 0, features: [] });
  });

  it("keeps a non-prefixed dim verbatim (defensive, never throws)", () => {
    expect(workflowDiversity([{ dim: "model=gpt-5" }]).features).toEqual(["model=gpt-5"]);
  });
});

describe("compareWorkflowDiversity (milestone comparator hook)", () => {
  it("flags a strict new best; a tie is not new (digest isNewBest parity)", () => {
    expect(compareWorkflowDiversity(4, 3).isNewBest).toBe(true);
    expect(compareWorkflowDiversity(3, 3).isNewBest).toBe(false);
    expect(compareWorkflowDiversity(2, 3).isNewBest).toBe(false);
  });

  it("reports the honest signed delta (never floored)", () => {
    expect(compareWorkflowDiversity(2, 5).delta).toBe(-3);
    expect(compareWorkflowDiversity(5, 2).delta).toBe(3);
  });

  it("crosses the HIGHEST newly-reached default milestone (2 → 3 → 5 → 8)", () => {
    // 1 → 3 newly crosses both 2 and 3; the highest reached is 3.
    expect(compareWorkflowDiversity(3, 1).crossedMilestone).toBe(3);
    // 4 → 6 newly crosses 5.
    expect(compareWorkflowDiversity(6, 4).crossedMilestone).toBe(5);
    // No new threshold (already past 2, not yet at 3).
    expect(compareWorkflowDiversity(2, 2).crossedMilestone).toBeNull();
    // A regression crosses nothing.
    expect(compareWorkflowDiversity(1, 5).crossedMilestone).toBeNull();
  });

  it("honors caller-supplied milestone thresholds", () => {
    expect(compareWorkflowDiversity(10, 6, [10]).crossedMilestone).toBe(10);
    expect(compareWorkflowDiversity(9, 6, [10]).crossedMilestone).toBeNull();
  });

  it("exposes an ascending default milestone ladder", () => {
    const m = [...DEFAULT_DIVERSITY_MILESTONES];
    expect(m).toEqual([...m].sort((a, b) => a - b));
  });
});
