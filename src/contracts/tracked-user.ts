// ─────────────────────────────────────────────────────────────────────────
// tracked_user — FROZEN BILLING PRIMITIVE (W0 gate item 4).
//
// A tracked user in billing period P is an identity-resolved person with
// at least one metric_record in P:
//
//   tracked(P) = { person p | ∃ identity (s → p) ∧ ∃ metric_record(subject
//                  s, day ∈ P) }
//
// - Unresolved subjects (no identity row) with records in P are SURFACED,
//   never billed — Revealyst never fabricates people from keys or shared
//   accounts (§6.1).
// - A shared account flagged as "N people likely" (§6.2) still counts only
//   its RESOLVED identities: the flag is metadata, not people.
// - A person is counted once no matter how many subjects or tools resolve
//   to them; a person with zero active subjects in P is not tracked.
//
// Paddle metering, the ≤10 free band, and the paywall all key off this
// count. Changing this definition post-freeze is an ADR + W3-M re-sync.
// The SQL twin lives in forOrg(db, org).billing.trackedUsers(period); a
// contract test asserts pure and SQL agree on shared fixtures.
// ─────────────────────────────────────────────────────────────────────────

export type BillingPeriod = {
  /** Inclusive UTC calendar days, YYYY-MM-DD. */
  start: string;
  end: string;
};

export type TrackedUserCount = {
  /** Distinct identity-resolved persons with ≥1 record in the period. */
  trackedPersonIds: string[];
  /** Subjects active in the period with NO identity — surfaced, not billed. */
  unresolvedSubjectIds: string[];
};

export function countTrackedUsers(input: {
  identities: ReadonlyArray<{ subjectId: string; personId: string }>;
  /** One entry per (subject, day) with ≥1 metric_record. */
  activeSubjectDays: ReadonlyArray<{ subjectId: string; day: string }>;
  period: BillingPeriod;
}): TrackedUserCount {
  const activeSubjects = new Set<string>();
  for (const { subjectId, day } of input.activeSubjectDays) {
    if (day >= input.period.start && day <= input.period.end) {
      activeSubjects.add(subjectId);
    }
  }

  const personsBySubject = new Map<string, string[]>();
  for (const { subjectId, personId } of input.identities) {
    const persons = personsBySubject.get(subjectId) ?? [];
    persons.push(personId);
    personsBySubject.set(subjectId, persons);
  }

  const trackedPersons = new Set<string>();
  const unresolvedSubjects = new Set<string>();
  for (const subjectId of activeSubjects) {
    const persons = personsBySubject.get(subjectId);
    if (persons && persons.length > 0) {
      for (const personId of persons) {
        trackedPersons.add(personId);
      }
    } else {
      unresolvedSubjects.add(subjectId);
    }
  }

  return {
    trackedPersonIds: [...trackedPersons].sort(),
    unresolvedSubjectIds: [...unresolvedSubjects].sort(),
  };
}
