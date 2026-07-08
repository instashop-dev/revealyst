// Platform-admin identity check (ADR 0016). PLATFORM role, not org role:
// org_members.role ("admin" | "member") is per-org membership; this is the
// staff/founder concept used by the /admin section and the Better Auth admin
// plugin. Pure functions only — no Next/DB imports — so both src/lib/auth.ts
// (vitest-loaded) and the request-context seams can import it, and tests
// reach it via a relative import (the vitest `@/` alias doesn't resolve at
// test runtime).

export type AdminEnv = {
  /** Comma-separated Better Auth user ids granted platform-admin power
   * without the `user.role` column being set (the bootstrap path — day-2
   * admins are promoted via the audited set-role endpoint instead). */
  ADMIN_USER_IDS?: string;
};

/** Parsed bootstrap admin ids for the admin plugin's `adminUserIds`. */
export function parseAdminUserIds(env: AdminEnv): string[] {
  return (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Is this user platform staff? True when `user.role === "admin"` OR the id is
 * in `ADMIN_USER_IDS`. A NULL/undefined role means "user" (existing rows are
 * never backfilled) — never write `role !== "member"`-style logic against it.
 * Must cover both branches: the plugin's `adminUserIds` grants power without
 * ever setting the column.
 */
export function isPlatformAdmin(
  user: { id: string; role?: string | null },
  env: AdminEnv,
): boolean {
  return user.role === "admin" || parseAdminUserIds(env).includes(user.id);
}
