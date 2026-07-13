// W5-E deliverable (4): per-person signal-coverage indicator.
//
// A PURE, in-memory aggregation over data the dashboard batch ALREADY holds —
// `identities` (subject → person links), `subjects` (each carrying its
// `connectionId`), and `connections` (each carrying its `vendor`). It answers
// one honest question: for a given person, how many independent data sources
// feed their picture? "3 sources" reads very differently from "1 source", and
// that difference is itself an honesty surface (a single-source person's score
// rests on a narrower base). ZERO new queries — the caller passes rows it has.
//
// Honesty / privacy (invariant b + §9.4a):
//   - A "source" is a distinct CONNECTION contributing at least one subject
//     linked to the person. Distinct-connection, not distinct-subject: two
//     subjects from one connection (e.g. a person's api-key subject + their
//     account subject on the same Anthropic connection) are ONE source, never
//     two — counting subjects would overstate coverage.
//   - The vendor labels are exposed for the SELF-VIEW detail only. The count is
//     aggregate-safe on its own (a number leaks no identity); callers rendering
//     coverage for OTHER people in a team view must show the count, never the
//     per-person vendor list, unless the visibility mode already permits naming.
//   - No fabrication: a person with no linked subjects simply has no entry
//     (sourceCount 0 is only ever returned when explicitly asked via
//     `coverageForPerson`), never a defaulted or inferred source.

/** A connection row reduced to what coverage needs. */
export type CoverageConnection = {
  /** connections.id */
  id: string;
  /** connections.vendor (e.g. "cursor", "openai", "anthropic_console"). */
  vendor: string;
};

/** A subject row reduced to what coverage needs. */
export type CoverageSubject = {
  /** subjects.id */
  id: string;
  /** subjects.connectionId — the source this subject's signal comes from. */
  connectionId: string;
};

/** An identity link reduced to what coverage needs (identities table). */
export type CoverageIdentity = {
  subjectId: string;
  personId: string;
};

export type SignalCoverageInput = {
  identities: readonly CoverageIdentity[];
  subjects: readonly CoverageSubject[];
  connections: readonly CoverageConnection[];
};

/** One person's coverage. `sourceCount` is the headline badge number; `vendors`
 * is the sorted distinct-vendor list for the self-view detail only. */
export type PersonSignalCoverage = {
  personId: string;
  /** Distinct connections contributing ≥1 linked subject. */
  sourceCount: number;
  /** Sorted, de-duplicated vendor ids across those connections (self-view). */
  vendors: string[];
};

/**
 * Compute per-person signal coverage. Pure and deterministic: same input →
 * deep-equal output. Only people that have at least one linked subject on a
 * known connection appear in the result — callers decide how to render the
 * absent (uncovered) case.
 */
export function computeSignalCoverage(
  input: SignalCoverageInput,
): Map<string, PersonSignalCoverage> {
  const connectionVendor = new Map<string, string>();
  for (const c of input.connections) connectionVendor.set(c.id, c.vendor);

  const subjectConnection = new Map<string, string>();
  for (const s of input.subjects) subjectConnection.set(s.id, s.connectionId);

  // person → set of distinct connection ids (the source set).
  const perPerson = new Map<string, Set<string>>();
  for (const link of input.identities) {
    const connectionId = subjectConnection.get(link.subjectId);
    if (connectionId === undefined) continue; // subject not in the batch — skip
    if (!connectionVendor.has(connectionId)) continue; // unknown connection — skip
    let set = perPerson.get(link.personId);
    if (!set) {
      set = new Set<string>();
      perPerson.set(link.personId, set);
    }
    set.add(connectionId);
  }

  const out = new Map<string, PersonSignalCoverage>();
  for (const [personId, connectionIds] of perPerson) {
    const vendors = new Set<string>();
    for (const id of connectionIds) {
      const v = connectionVendor.get(id);
      if (v) vendors.add(v);
    }
    out.set(personId, {
      personId,
      sourceCount: connectionIds.size,
      vendors: [...vendors].sort(),
    });
  }
  return out;
}

/**
 * Convenience single-person lookup. Returns a zero-coverage record (never
 * undefined) so a caller can render "1 source" / "no sources yet" uniformly —
 * the only place a `sourceCount: 0` is ever produced, and only on explicit ask.
 */
export function coverageForPerson(
  input: SignalCoverageInput,
  personId: string,
): PersonSignalCoverage {
  return (
    computeSignalCoverage(input).get(personId) ?? {
      personId,
      sourceCount: 0,
      vendors: [],
    }
  );
}
