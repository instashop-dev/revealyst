// Shared module-level helpers for the org-scoped namespace factories. Kept in
// one place so the split namespace files (src/db/org-scope/*.ts) don't
// duplicate logic. This module holds only pure, stateless helpers — the
// org-of-one bootstrap (ensureOrgOfOne/membershipForUser) stays in the
// composition root (src/db/org-scope.ts).

/** Postgres unique-violation, across postgres.js and PGlite drivers.
 * Walks the cause chain: drizzle wraps driver errors in a DrizzleQueryError
 * (the 23505 code lives on `.cause`, not the wrapper itself). */
export function isUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    typeof current === "object" && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    if ((current as { code?: string }).code === "23505") {
      return true;
    }
  }
  return false;
}
