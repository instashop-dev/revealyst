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
