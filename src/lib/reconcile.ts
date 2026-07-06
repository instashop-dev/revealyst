// View-model assembly for the W2-K manual reconciliation page. Reads only
// through the frozen forOrg surface (subjects/people/teams/connections/
// identities) and layers the shared-account flags on top. Kept out of the
// page component so it can be unit-tested against fixtures.

import type { forOrg } from "../db/org-scope";
import { vendorLabel } from "./vendor-labels";
import { computeSharedAccountFlags } from "./shared-account/query";
import type { SharedAccountFlag } from "./shared-account/heuristics";

type Scoped = ReturnType<typeof forOrg>;

export type PersonRef = {
  id: string;
  pseudonym: string;
  displayName: string | null;
};

export type SubjectResolution = {
  subjectId: string;
  kind: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  vendor: string;
  /** Resolved persons — empty means unresolved (surfaced, never billed). */
  persons: PersonRef[];
  /** Shared-account signal, if the heuristics flagged this subject. */
  flag: SharedAccountFlag | null;
};

export type ReconcileView = {
  /** Subjects with no identity row — the reconciliation work-list. */
  unresolved: SubjectResolution[];
  /** Already-resolved subjects (shown for unlink / audit). */
  resolved: SubjectResolution[];
  people: PersonRef[];
  teams: { id: string; name: string }[];
  flaggedCount: number;
};

export async function buildReconcileView(
  scoped: Scoped,
  opts: { from: string; to: string },
): Promise<ReconcileView> {
  // Fetch subjects once, then reuse them for the flag pass — otherwise
  // computeSharedAccountFlags would scan the subjects table a second time.
  const subjectRows = await scoped.subjects.list();
  const [peopleRows, teamRows, connectionRows, flags] = await Promise.all([
    scoped.people.list(),
    scoped.teams.list(),
    scoped.connections.list(),
    computeSharedAccountFlags(scoped, {
      from: opts.from,
      to: opts.to,
      subjects: subjectRows,
    }),
  ]);

  const people: PersonRef[] = peopleRows.map((p) => ({
    id: p.id,
    pseudonym: p.pseudonym,
    displayName: p.displayName,
  }));
  const personById = new Map(people.map((p) => [p.id, p]));
  const vendorByConnection = new Map(
    connectionRows.map((c) => [c.id, vendorLabel(c.vendor)]),
  );
  const flagBySubject = new Map(flags.map((f) => [f.subjectId, f]));

  // subjectId → resolved persons, built by unioning forPerson over all people
  // (the frozen surface has no bulk identities reader — a deferred ADR). Reads
  // are independent, so gather them concurrently.
  const identityRows = await Promise.all(
    peopleRows.map((person) => scoped.identities.forPerson(person.id)),
  );
  const personsBySubject = new Map<string, PersonRef[]>();
  for (const rows of identityRows) {
    for (const row of rows) {
      const person = personById.get(row.personId);
      if (!person) continue;
      const list = personsBySubject.get(row.subjectId) ?? [];
      list.push(person);
      personsBySubject.set(row.subjectId, list);
    }
  }

  const unresolved: SubjectResolution[] = [];
  const resolved: SubjectResolution[] = [];
  for (const subject of subjectRows) {
    const persons = personsBySubject.get(subject.id) ?? [];
    const entry: SubjectResolution = {
      subjectId: subject.id,
      kind: subject.kind,
      externalId: subject.externalId,
      email: subject.email,
      displayName: subject.displayName,
      vendor: vendorByConnection.get(subject.connectionId) ?? "Unknown",
      persons,
      flag: flagBySubject.get(subject.id) ?? null,
    };
    (persons.length === 0 ? unresolved : resolved).push(entry);
  }

  return {
    unresolved,
    resolved,
    people,
    teams: teamRows.map((t) => ({ id: t.id, name: t.name })),
    flaggedCount: flags.length,
  };
}
