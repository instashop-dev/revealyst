// View-model assembly for the W2-K manual reconciliation page. Reads only
// through the frozen forOrg surface (subjects/people/teams/connections/
// identities) and layers the shared-account flags on top. Kept out of the
// page component so it can be unit-tested against fixtures.

import type { forOrg } from "../db/org-scope";
import { groupBy } from "./utils";
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
  /** True if this subject has any active_day rows in the window — the
   *  canonical presence signal every connector emits (§ normalize.ts). An
   *  unresolved subject with no activity is a harmless stub; one WITH
   *  activity is metric data sitting unattributed, and is surfaced first so
   *  reconciling "the person with a name" doesn't leave the actual
   *  data-bearing subject (often an api_key/account-kind sibling) behind. */
  hasActivity: boolean;
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
  // All independent reads in one Promise.all. The flag pass needs no subject
  // list anymore — computeSharedAccountFlags reads org-wide signals via the
  // bulk `metrics.allSignals` (ADR 0017); `subjectRows` here feeds only the
  // resolved/unresolved loop below.
  const [subjectRows, peopleRows, teamRows, connectionRows, flags, activeDayRows, identityRows] =
    await Promise.all([
      scoped.subjects.list(),
      scoped.people.list(),
      scoped.teams.list(),
      scoped.connections.list(),
      computeSharedAccountFlags(scoped, {
        from: opts.from,
        to: opts.to,
      }),
      // active_day is the one metric every connector emits whenever a
      // subject did anything at all — the cheapest single-query activity
      // proxy, same convention as computeSharedAccountFlags' volumeMetricKey.
      scoped.metrics.records({
        metricKey: "active_day",
        from: opts.from,
        to: opts.to,
      }),
      // One bulk identities.all() read (ADR 0014), grouped in JS below.
      scoped.identities.all(),
    ]);
  const subjectsWithActivity = new Set(activeDayRows.map((r) => r.subjectId));

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

  // subjectId → identity links, grouped in JS from the bulk read above —
  // the same pattern dashboard-read.ts uses, avoiding a per-person round
  // trip. Links to an unknown person are skipped (same as before).
  const linksBySubject = groupBy(identityRows, (row) => row.subjectId);

  const unresolved: SubjectResolution[] = [];
  const resolved: SubjectResolution[] = [];
  for (const subject of subjectRows) {
    const persons = (linksBySubject.get(subject.id) ?? [])
      .map((row) => personById.get(row.personId))
      .filter((p): p is PersonRef => p !== undefined);
    const entry: SubjectResolution = {
      subjectId: subject.id,
      kind: subject.kind,
      externalId: subject.externalId,
      email: subject.email,
      displayName: subject.displayName,
      vendor: vendorByConnection.get(subject.connectionId) ?? "Unknown",
      persons,
      flag: flagBySubject.get(subject.id) ?? null,
      hasActivity: subjectsWithActivity.has(subject.id),
    };
    (persons.length === 0 ? unresolved : resolved).push(entry);
  }
  // Active-but-unresolved subjects first — they're metric data sitting
  // unattributed, not harmless empty stubs, so they must not get buried
  // below more recognizably-named siblings from the same connector.
  unresolved.sort((a, b) => Number(b.hasActivity) - Number(a.hasActivity));

  return {
    unresolved,
    resolved,
    people,
    teams: teamRows.map((t) => ({ id: t.id, name: t.name })),
    flaggedCount: flags.length,
  };
}
