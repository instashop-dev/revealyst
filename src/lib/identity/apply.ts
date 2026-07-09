// DB apply path for W2-K email-match resolution. Composes the pure
// proposeEmailMatches with the frozen forOrg surface (subjects.list,
// people.list, identities.all/link) — it adds NO new query surface to
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

  // Every identity row's subjectId marks an already-resolved subject. One
  // bulk identities.all() read (org-scope.ts:961-966, ADR 0014) instead of
  // unioning forPerson over every person — avoids N serial/concurrent round
  // trips for what is otherwise a single-query read.
  const identityRows = await scoped.identities.all();
  const alreadyResolvedSubjectIds = new Set<string>(
    identityRows.map((row) => row.subjectId),
  );

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
