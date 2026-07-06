// Email-match identity resolution (W2-K). Pure — no DB, no I/O.
//
// Proposes subject → person links purely from email equality, the only
// signal we trust to auto-resolve identity. The apply path (a caller in the
// repo layer) feeds these to forOrg(...).identities.link(_, _, "email_match").
//
// Honesty rules (invariant b — never fabricate per-user numbers, §6.1):
//   - Only `kind: "person"` subjects with a non-empty email are eligible.
//     An api_key / service_account / account / workspace / project subject is
//     NEVER auto-resolved to a person from account-level data — it stays
//     unresolved and surfaced for manual reconciliation.
//   - An email that matches more than one person is AMBIGUOUS: not auto-
//     linked (a human decides), never guessed.
//   - Subjects a human has already touched (any existing identity row) are
//     excluded, so an email match never silently adds a second person to a
//     manually-reconciled shared account.
// Everything not proposed is returned as unresolved/ambiguous so callers can
// surface it rather than drop it.

import type { SubjectKind } from "../../contracts/attribution";

export type ResolvableSubject = {
  subjectId: string;
  kind: SubjectKind;
  email: string | null;
};

export type ResolvablePerson = {
  personId: string;
  email: string | null;
};

export type EmailMatch = {
  subjectId: string;
  personId: string;
  method: "email_match";
};

export type EmailMatchResult = {
  /** Proposed 1:1 email matches, ready for identities.link(). */
  matches: EmailMatch[];
  /** Eligible subjects whose email matched >1 person — need a human. */
  ambiguousSubjectIds: string[];
  /** Subjects with no confident match: ineligible kind, no email, or no
   *  matching person. Surfaced (at key/account level), never fabricated. */
  unresolvedSubjectIds: string[];
};

/** Lowercase + trim; empty/whitespace-only becomes null (no email). */
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function proposeEmailMatches(input: {
  subjects: ReadonlyArray<ResolvableSubject>;
  people: ReadonlyArray<ResolvablePerson>;
  /** Subjects that already have ≥1 identity row — excluded from auto-match. */
  alreadyResolvedSubjectIds?: ReadonlySet<string>;
}): EmailMatchResult {
  const resolved = input.alreadyResolvedSubjectIds ?? new Set<string>();

  // email → distinct personIds (a person with a null email is unreachable).
  const personsByEmail = new Map<string, Set<string>>();
  for (const person of input.people) {
    const email = normalizeEmail(person.email);
    if (!email) continue;
    const persons = personsByEmail.get(email) ?? new Set<string>();
    persons.add(person.personId);
    personsByEmail.set(email, persons);
  }

  const matches: EmailMatch[] = [];
  const ambiguousSubjectIds: string[] = [];
  const unresolvedSubjectIds: string[] = [];

  for (const subject of input.subjects) {
    if (resolved.has(subject.subjectId)) continue;

    const email =
      subject.kind === "person" ? normalizeEmail(subject.email) : null;
    const candidates = email ? personsByEmail.get(email) : undefined;

    if (!candidates || candidates.size === 0) {
      unresolvedSubjectIds.push(subject.subjectId);
    } else if (candidates.size > 1) {
      ambiguousSubjectIds.push(subject.subjectId);
    } else {
      const [personId] = [...candidates];
      matches.push({ subjectId: subject.subjectId, personId, method: "email_match" });
    }
  }

  return {
    matches: matches.sort((a, b) => a.subjectId.localeCompare(b.subjectId)),
    ambiguousSubjectIds: ambiguousSubjectIds.sort(),
    unresolvedSubjectIds: unresolvedSubjectIds.sort(),
  };
}
