// Shared module-level helpers for the org-scoped namespace factories. Kept in
// one place so the split namespace files (src/db/org-scope/*.ts) don't
// duplicate logic. This module holds only pure, stateless helpers — the
// org-of-one bootstrap (ensureOrgOfOne/membershipForUser) stays in the
// composition root (src/db/org-scope.ts).

/** Postgres unique-violation, across postgres.js and PGlite drivers. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
