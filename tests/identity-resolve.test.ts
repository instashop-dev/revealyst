import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixtureGraphSchema } from "../src/db/fixtures";
import {
  proposeEmailMatches,
  type ResolvablePerson,
  type ResolvableSubject,
} from "../src/lib/identity/resolve";

// Pure-engine suite for W2-K email-match resolution: no DB, no I/O. Builds
// against the checked-in team fixture (rule 2) plus small hand-built graphs
// for the ambiguity / exclusion edge cases the fixture doesn't carry.

const teamFixture = fixtureGraphSchema.parse(
  JSON.parse(readFileSync("fixtures/metric-records/team-30d.json", "utf8")),
);

// The fixture references entities by local `key`; for the pure function the
// key IS the id — matching is on email, ids are opaque.
const fixtureSubjects: ResolvableSubject[] = teamFixture.subjects.map((s) => ({
  subjectId: s.key,
  kind: s.kind,
  email: s.email,
}));
const fixturePeople: ResolvablePerson[] = teamFixture.people.map((p) => ({
  personId: p.key,
  email: p.email,
}));

describe("proposeEmailMatches — team-30d fixture", () => {
  const result = proposeEmailMatches({
    subjects: fixtureSubjects,
    people: fixturePeople,
  });

  it("auto-matches person subjects by email", () => {
    expect(result.matches).toEqual([
      { subjectId: "alice-console", personId: "alice", method: "email_match" },
      { subjectId: "eve-console", personId: "eve", method: "email_match" },
    ]);
  });

  it("leaves account/service/emailless subjects unresolved, never fabricated", () => {
    // shared-console (account), svc-key (service_account), copilot-bob (no email)
    expect(result.unresolvedSubjectIds).toEqual([
      "copilot-bob",
      "shared-console",
      "svc-key",
    ]);
  });

  it("proposes no ambiguous matches for this fixture", () => {
    expect(result.ambiguousSubjectIds).toEqual([]);
  });
});

describe("proposeEmailMatches — honesty edge cases", () => {
  it("never auto-resolves a non-person subject even with a matching email", () => {
    const result = proposeEmailMatches({
      subjects: [
        { subjectId: "shared", kind: "account", email: "team@corp.example" },
        { subjectId: "key", kind: "api_key", email: "team@corp.example" },
      ],
      people: [{ personId: "p1", email: "team@corp.example" }],
    });
    expect(result.matches).toEqual([]);
    expect(result.unresolvedSubjectIds).toEqual(["key", "shared"]);
  });

  it("marks an email that matches two people ambiguous, not a guess", () => {
    const result = proposeEmailMatches({
      subjects: [{ subjectId: "s1", kind: "person", email: "Dup@Corp.Example" }],
      people: [
        { personId: "p1", email: "dup@corp.example" },
        { personId: "p2", email: "dup@corp.example" },
      ],
    });
    expect(result.matches).toEqual([]);
    expect(result.ambiguousSubjectIds).toEqual(["s1"]);
  });

  it("normalizes case and whitespace on both sides", () => {
    const result = proposeEmailMatches({
      subjects: [{ subjectId: "s1", kind: "person", email: "  Alice@Corp.Example " }],
      people: [{ personId: "p1", email: "alice@corp.example" }],
    });
    expect(result.matches).toEqual([
      { subjectId: "s1", personId: "p1", method: "email_match" },
    ]);
  });

  it("excludes subjects a human already reconciled", () => {
    const result = proposeEmailMatches({
      subjects: [{ subjectId: "s1", kind: "person", email: "a@corp.example" }],
      people: [{ personId: "p1", email: "a@corp.example" }],
      alreadyResolvedSubjectIds: new Set(["s1"]),
    });
    expect(result.matches).toEqual([]);
    expect(result.unresolvedSubjectIds).toEqual([]);
  });

  it("treats empty/whitespace emails as no email", () => {
    const result = proposeEmailMatches({
      subjects: [{ subjectId: "s1", kind: "person", email: "   " }],
      people: [{ personId: "p1", email: "" }],
    });
    expect(result.matches).toEqual([]);
    expect(result.unresolvedSubjectIds).toEqual(["s1"]);
  });
});
