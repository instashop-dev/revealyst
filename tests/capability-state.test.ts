import { describe, expect, it } from "vitest";
import {
  CAPABILITY_STATE_CONSTANTS,
  computeCapabilityStates,
  type CapabilityGraphInput,
  type PersonEvidenceInput,
} from "../src/scoring/capability-state";

// W7-2: the pure capability-mastery engine against known-truth fixtures. Covers
// the honesty rules (no-evidence → no row; real low kept; fully-decayed
// withheld), the v0 formula (component = normalized/100; metric = days/target),
// confidence composition, the directional cap, decay over simulated time,
// explainability, and the eligible-next traversal.

const AS_OF = "2026-06-30";

const GRAPH: CapabilityGraphInput = {
  capabilities: [
    { slug: "a", sort: 10 },
    { slug: "b", sort: 20 },
    { slug: "c", sort: 30 },
  ],
  dependencies: [
    { capabilitySlug: "b", requiresSlug: "a" },
    { capabilitySlug: "c", requiresSlug: "b" },
  ],
  signals: [
    { capabilitySlug: "a", metricKey: null, componentKey: "compA" },
    { capabilitySlug: "b", metricKey: "metB", componentKey: null },
    { capabilitySlug: "c", metricKey: "metC", componentKey: null },
    { capabilitySlug: "c", metricKey: null, componentKey: "compC" },
  ],
};

function evidence(over: Partial<PersonEvidenceInput> = {}): PersonEvidenceInput {
  return {
    componentValues: new Map(),
    metricEvidence: new Map(),
    sourceCount: 0,
    ...over,
  };
}

describe("computeCapabilityStates — honesty rules", () => {
  it("no evidence → no rows (never mastery: 0)", () => {
    expect(computeCapabilityStates(GRAPH, evidence(), AS_OF)).toEqual([]);
  });

  it("a real recent-but-low reading is KEPT (a measured low, not an absence)", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({ componentValues: new Map([["compA", 5]]) }),
      AS_OF,
    );
    const a = states.find((s) => s.capabilitySlug === "a")!;
    expect(a).toBeDefined();
    expect(a.mastery).toBe(0.05); // 5/100 — kept, not withheld
  });

  it("evidence too stale (fully decayed) is withheld — no row", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({
        metricEvidence: new Map([
          ["metB", { evidenceDays: 8, count: 8, lastDay: "2026-04-01" }],
        ]),
      }),
      AS_OF,
    );
    // 90 days stale → past grace(14)+span(28) → decayFactor 0 → withheld.
    expect(states.find((s) => s.capabilitySlug === "b")).toBeUndefined();
  });
});

describe("computeCapabilityStates — v0 formula", () => {
  it("component mastery is normalized/100, fresh (staleness 0)", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({ componentValues: new Map([["compA", 80]]) }),
      AS_OF,
    );
    const a = states.find((s) => s.capabilitySlug === "a")!;
    expect(a.mastery).toBe(0.8);
    expect(a.lastEvidenceAt).toBe(AS_OF); // component evidence is current
    expect(a.staleness).toBe(0);
  });

  it("metric mastery is min(evidenceDays / target, 1)", () => {
    const target = CAPABILITY_STATE_CONSTANTS.EVIDENCE_TARGET_DAYS; // 10
    const states = computeCapabilityStates(
      GRAPH,
      evidence({
        metricEvidence: new Map([
          ["metB", { evidenceDays: 5, count: 12, lastDay: AS_OF }],
        ]),
      }),
      AS_OF,
    );
    const b = states.find((s) => s.capabilitySlug === "b")!;
    expect(b.mastery).toBe(5 / target); // 0.5
    expect(b.evidenceCount).toBe(12);
  });

  it("a mixed capability averages its component and metric signal scores", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({
        componentValues: new Map([["compC", 60]]),
        metricEvidence: new Map([
          ["metC", { evidenceDays: 10, count: 10, lastDay: AS_OF }],
        ]),
      }),
      AS_OF,
    );
    const c = states.find((s) => s.capabilitySlug === "c")!;
    // mean(0.6, min(10/10,1)=1) = 0.8
    expect(c.mastery).toBe(0.8);
  });
});

describe("computeCapabilityStates — confidence, decay, cap, explainability", () => {
  it("confidence composes coverage + evidence volume + signal completeness", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({
        componentValues: new Map([["compC", 60]]),
        metricEvidence: new Map([
          ["metC", { evidenceDays: 10, count: 20, lastDay: AS_OF }],
        ]),
        sourceCount: 3, // full coverage term
      }),
      AS_OF,
    );
    const c = states.find((s) => s.capabilitySlug === "c")!;
    // coverage=1 (3/3), evidence=1 (20/20), completeness=1 (2 of 2 signals) →
    // 0.5 + 0.3 + 0.2 = 1.0
    expect(c.confidence).toBe(1);
  });

  it("mastery decays with staleness within the decay span", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({
        metricEvidence: new Map([
          // 21 days before AS_OF → staleness 21; decay = 1-(21-14)/28 = 0.75
          ["metB", { evidenceDays: 10, count: 10, lastDay: "2026-06-09" }],
        ]),
      }),
      AS_OF,
    );
    const b = states.find((s) => s.capabilitySlug === "b")!;
    expect(b.staleness).toBe(21);
    expect(b.mastery).toBe(0.75); // min(10/10,1)=1 * 0.75
  });

  it("every row is capped at the directional tier", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({ componentValues: new Map([["compA", 90]]) }),
      AS_OF,
    );
    expect(states.every((s) => s.confidenceTier === "directional")).toBe(true);
  });

  it("carries an explainable per-signal breakdown", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence({ componentValues: new Map([["compA", 40]]) }),
      AS_OF,
    );
    const a = states.find((s) => s.capabilitySlug === "a")!;
    expect(a.components.compA).toEqual({
      kind: "component",
      input: 40,
      contribution: 0.4,
    });
  });
});

describe("computeCapabilityStates — eligible-next traversal", () => {
  it("points at the lowest-sort not-yet-mastered capability whose prereqs are all mastered", () => {
    // a mastered (0.8 ≥ 0.6). b has no evidence (no row) but its prereq a is
    // mastered and b is not → b is the eligible-next frontier.
    const states = computeCapabilityStates(
      GRAPH,
      evidence({ componentValues: new Map([["compA", 80]]) }),
      AS_OF,
    );
    const a = states.find((s) => s.capabilitySlug === "a")!;
    expect(a.nextCapability).toBe("b");
  });

  it("does not unlock a capability whose prerequisite is unmastered", () => {
    // a present but weak (0.3 < 0.6) → not mastered → b not eligible; a itself
    // is the eligible-next (no prereqs, not mastered).
    const states = computeCapabilityStates(
      GRAPH,
      evidence({ componentValues: new Map([["compA", 30]]) }),
      AS_OF,
    );
    const a = states.find((s) => s.capabilitySlug === "a")!;
    expect(a.nextCapability).toBe("a");
  });
});
