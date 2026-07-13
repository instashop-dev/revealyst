import { describe, expect, it } from "vitest";

import {
  computeSignalCoverage,
  coverageForPerson,
  type SignalCoverageInput,
} from "../src/lib/signal-coverage";

// W5-E deliverable (4): the per-person signal-coverage indicator. Pure
// in-memory aggregation over identities → subjects.connectionId → connections.
// The headline case is a TWO-PERSON, differing-sources fixture: a broad person
// (three sources) vs a single-source person.

// Alice: linked to subjects across THREE connections (cursor + openai +
// anthropic), two of them on ONE connection (api-key + account subjects on the
// same anthropic connection) to prove distinct-CONNECTION counting, not
// distinct-subject. Bob: a single source (copilot).
const input: SignalCoverageInput = {
  connections: [
    { id: "conn_cursor", vendor: "cursor" },
    { id: "conn_openai", vendor: "openai" },
    { id: "conn_anthropic", vendor: "anthropic_console" },
    { id: "conn_copilot", vendor: "github_copilot" },
  ],
  subjects: [
    { id: "s_alice_cursor", connectionId: "conn_cursor" },
    { id: "s_alice_openai", connectionId: "conn_openai" },
    { id: "s_alice_anthropic_key", connectionId: "conn_anthropic" },
    { id: "s_alice_anthropic_acct", connectionId: "conn_anthropic" },
    { id: "s_bob_copilot", connectionId: "conn_copilot" },
  ],
  identities: [
    { subjectId: "s_alice_cursor", personId: "alice" },
    { subjectId: "s_alice_openai", personId: "alice" },
    { subjectId: "s_alice_anthropic_key", personId: "alice" },
    { subjectId: "s_alice_anthropic_acct", personId: "alice" },
    { subjectId: "s_bob_copilot", personId: "bob" },
  ],
};

describe("computeSignalCoverage", () => {
  const coverage = computeSignalCoverage(input);

  it("counts DISTINCT connections, not subjects (two subjects on one connection = one source)", () => {
    const alice = coverage.get("alice");
    expect(alice?.sourceCount).toBe(3); // cursor + openai + anthropic (not 4)
    expect(alice?.vendors).toEqual(["anthropic_console", "cursor", "openai"]);
  });

  it("a single-source person reads as exactly one source", () => {
    const bob = coverage.get("bob");
    expect(bob?.sourceCount).toBe(1);
    expect(bob?.vendors).toEqual(["github_copilot"]);
  });

  it("is pure and deterministic (same input → deep-equal output)", () => {
    expect(computeSignalCoverage(input)).toEqual(computeSignalCoverage(input));
  });

  it("ignores identity links whose subject/connection is not in the batch (no fabrication)", () => {
    const withOrphan: SignalCoverageInput = {
      ...input,
      identities: [
        ...input.identities,
        { subjectId: "s_missing", personId: "alice" }, // subject absent
        { subjectId: "s_alice_cursor", personId: "carol" }, // carol via a known subject
      ],
    };
    const cov = computeSignalCoverage(withOrphan);
    expect(cov.get("alice")?.sourceCount).toBe(3); // orphan added nothing
    expect(cov.get("carol")?.sourceCount).toBe(1);
  });

  it("does not leak identity: output is keyed by personId with counts + vendor labels only", () => {
    for (const [personId, c] of coverage) {
      expect(c.personId).toBe(personId);
      expect(typeof c.sourceCount).toBe("number");
      expect(Array.isArray(c.vendors)).toBe(true);
    }
  });
});

describe("coverageForPerson", () => {
  it("returns a person's coverage when present", () => {
    expect(coverageForPerson(input, "alice").sourceCount).toBe(3);
  });

  it("returns a zero-coverage record (never undefined) for an uncovered person", () => {
    expect(coverageForPerson(input, "nobody")).toEqual({
      personId: "nobody",
      sourceCount: 0,
      vendors: [],
    });
  });
});
