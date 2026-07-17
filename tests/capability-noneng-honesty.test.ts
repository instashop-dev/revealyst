import { describe, expect, it } from "vitest";
import {
  computeCapabilityStates,
  type CapabilityGraphInput,
  type PersonEvidenceInput,
} from "../src/scoring/capability-state";

// P8-NE honesty guard (ADR 0054), invariant (b) — THE most important test of
// this workstream.
//
// Non-engineering capabilities (Product/Marketing/Sales/CS/HR/Finance/Ops) have
// NO live telemetry source today — every connector is a developer tool. Their
// pack definitions (drizzle/0044) are therefore bound to ZERO signals on
// purpose. This asserts the mastery engine's response to an UNBOUND capability
// is the honest "not measured" state: NO row at all — never a floored 0, never a
// fabricated confidence tier — no matter how much evidence the person otherwise
// has. If this ever produces a row for an unbound capability, we are fabricating
// a per-user number.

// The Marketing proof pack (drizzle/0044) exactly as seeded: capabilities with
// NO signal bindings and NO dependency edges.
const MARKETING_ONLY_GRAPH: CapabilityGraphInput = {
  capabilities: [
    { slug: "mkt-audience-research", sort: 10 },
    { slug: "mkt-campaign-ideation", sort: 20 },
    { slug: "mkt-copy-development", sort: 30 },
    { slug: "mkt-content-repurposing", sort: 40 },
    { slug: "mkt-seo-workflows", sort: 50 },
    { slug: "mkt-creative-generation", sort: 60 },
    { slug: "mkt-campaign-analysis", sort: 70 },
  ],
  dependencies: [],
  signals: [], // the honest core: non-eng capabilities bind no live signal yet
};

const AS_OF = "2026-07-17";

/** Deliberately GENEROUS evidence — every engineering component maxed, plenty of
 * metric evidence — to prove the engine ignores it for capabilities that bind
 * none of it. An unbound capability cannot borrow another capability's data. */
const RICH_EVIDENCE: PersonEvidenceInput = {
  componentValues: new Map([
    ["active_days", 100],
    ["tool_coverage", 100],
    ["breadth", 100],
    ["depth", 100],
    ["effectiveness", 100],
    ["output_per_spend", 100],
  ]),
  metricEvidence: new Map([
    ["active_day", { evidenceDays: 28, count: 400, lastDay: AS_OF }],
    ["commits", { evidenceDays: 28, count: 400, lastDay: AS_OF }],
    ["feature_used", { evidenceDays: 28, count: 400, lastDay: AS_OF }],
  ]),
  sourceCount: 3,
};

describe("non-engineering capability honesty guard (invariant b)", () => {
  it("an unbound capability produces NO row, even with rich evidence", () => {
    const states = computeCapabilityStates(
      MARKETING_ONLY_GRAPH,
      RICH_EVIDENCE,
      AS_OF,
    );
    // No fabricated rows at all — the whole pack is not-measured.
    expect(states).toEqual([]);
  });

  it("never emits a floored 0 or any confidence tier for an unbound capability", () => {
    const states = computeCapabilityStates(
      MARKETING_ONLY_GRAPH,
      RICH_EVIDENCE,
      AS_OF,
    );
    for (const slug of MARKETING_ONLY_GRAPH.capabilities.map((c) => c.slug)) {
      const row = states.find((s) => s.capabilitySlug === slug);
      // The dishonest failure mode this guards: a row with mastery 0 / a tier.
      expect(row, `${slug} must have no state row`).toBeUndefined();
    }
  });

  it("empty evidence also yields nothing (no zeros from an empty person)", () => {
    const emptyEvidence: PersonEvidenceInput = {
      componentValues: new Map(),
      metricEvidence: new Map(),
      sourceCount: 0,
    };
    expect(
      computeCapabilityStates(MARKETING_ONLY_GRAPH, emptyEvidence, AS_OF),
    ).toEqual([]);
  });

  it("in a MIXED graph, only the bound (engineering) capability gets a row", () => {
    // One engineering capability bound to a live metric, alongside the unbound
    // marketing pack — proves the engine scores ONLY what has a real binding and
    // never lets a bound capability's data spill into an unbound sibling.
    const mixedGraph: CapabilityGraphInput = {
      capabilities: [
        { slug: "ai-coding-foundations", sort: 5 },
        ...MARKETING_ONLY_GRAPH.capabilities,
      ],
      dependencies: [],
      signals: [
        { capabilitySlug: "ai-coding-foundations", metricKey: "active_day", componentKey: null },
      ],
    };
    const states = computeCapabilityStates(mixedGraph, RICH_EVIDENCE, AS_OF);
    expect(states.map((s) => s.capabilitySlug)).toEqual(["ai-coding-foundations"]);
    // No marketing slug appears in any row.
    expect(states.some((s) => s.capabilitySlug.startsWith("mkt-"))).toBe(false);
  });
});
