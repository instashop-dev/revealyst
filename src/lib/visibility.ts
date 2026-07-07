import { personRefSchema } from "../contracts/api";

export type VisibilityMode = "private" | "managed" | "full";

/** A person row as read from the org-scoped repository — only the fields the
 * privacy boundary needs. */
export type PersonLike = {
  id: string;
  pseudonym: string;
  displayName?: string | null;
};

/**
 * §7 privacy, enforced by shape. THE one decision point for turning a stored
 * person into a client-facing ref: the real name survives only when the org's
 * visibility mode permits it; in `private` (the default) every person is
 * team-only pseudonymous. `personRefSchema` is strict, so any extra field
 * (email, auth id) throws here rather than leaking downstream.
 *
 * Behaviour matches the original inline rule in api-impl.ts::listPeople:
 * `private` hides the name; `managed`/`full` pass it through.
 */
export function toPersonRef(person: PersonLike, visibilityMode: VisibilityMode) {
  return personRefSchema.parse({
    id: person.id,
    pseudonym: person.pseudonym,
    displayName:
      visibilityMode === "private" ? null : (person.displayName ?? null),
  });
}

export type PersonRef = ReturnType<typeof toPersonRef>;

/**
 * The single audit predicate for the §7 privacy default: a dashboard view is
 * "team-only pseudonymized" iff no surfaced person carries a real name, no
 * individual is listed as a segment member, and no shared-account flag carries
 * a real vendor account identifier (often an email — same leak class as a
 * person's name). Structural on purpose (no import of DashboardView) so it
 * stays the one decision point — the page renders through the visibility
 * gate, and this asserts the gate held.
 *
 * A private-mode view passes; a managed/full view (which deliberately surfaces
 * names/members) throws — that asymmetry is what makes the W2 gate item
 * ("privacy default verified as team-only pseudonymized") a real assertion,
 * imported by W1-S's E2E via tests/harness/seams.ts.
 */
export function assertTeamOnlyPseudonymized(view: {
  summary: { scores: readonly { person: PersonRef | null }[] };
  segments: { segments: readonly { members: readonly PersonRef[] }[] };
  sharedAccounts: readonly { externalId: string | null }[];
}): void {
  const leaks: string[] = [];
  for (const score of view.summary.scores) {
    if (score.person && score.person.displayName !== null) {
      leaks.push(`score exposes a real name for person ${score.person.id}`);
    }
  }
  for (const segment of view.segments.segments) {
    if (segment.members.length > 0) {
      leaks.push(`segment surfaces ${segment.members.length} individual member(s)`);
    }
  }
  for (const flag of view.sharedAccounts) {
    if (flag.externalId !== null) {
      leaks.push(`shared-account flag exposes a real account identifier`);
    }
  }
  if (leaks.length > 0) {
    throw new Error(
      `dashboard view is not team-only pseudonymized: ${leaks.join("; ")}`,
    );
  }
}
