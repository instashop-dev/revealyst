// DB apply path for W2-K email-match resolution. Composes the pure
// proposeEmailMatches with the frozen forOrg surface (subjects.list,
// people.list, identities.forPerson/link) — it adds NO new query surface to
// src/db/org-scope.ts (that is a frozen contract).

import type { forOrg } from "../../db/org-scope";
import { proposeEmailMatches, type EmailMatchResult } from "./resolve";

type Scoped = ReturnType<typeof forOrg>;

/**
 * Runs email matching over an org's live subjects/people and links the
 * confident matches as method "email_match". Idempotent: subjects that
 * already carry an identity row are excluded, so a re-run links nothing new
 * and never adds a second person to a hand-reconciled account. Returns the
 * full result (matches + ambiguous + unresolved) so callers can surface the
 * subjects that stayed at key/account level.
 */
export async function applyEmailMatches(
  scoped: Scoped,
): Promise<EmailMatchResult> {
  const [subjectRows, peopleRows] = await Promise.all([
    scoped.subjects.list(),
    scoped.people.list(),
  ]);

  // Every identity row's personId is one of this org's people, so unioning
  // forPerson over all people yields every already-resolved subject — via
  // the existing surface, no bulk-identity reader needed.
  const alreadyResolvedSubjectIds = new Set<string>();
  for (const person of peopleRows) {
    const rows = await scoped.identities.forPerson(person.id);
    for (const row of rows) alreadyResolvedSubjectIds.add(row.subjectId);
  }

  const result = proposeEmailMatches({
    subjects: subjectRows.map((s) => ({
      subjectId: s.id,
      kind: s.kind,
      email: s.email,
    })),
    people: peopleRows.map((p) => ({ personId: p.id, email: p.email })),
    alreadyResolvedSubjectIds,
  });

  for (const match of result.matches) {
    await scoped.identities.link(match.subjectId, match.personId, "email_match");
  }
  return result;
}
