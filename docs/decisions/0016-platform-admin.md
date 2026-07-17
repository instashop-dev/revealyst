# 0016 — Platform-admin section: roles, guarded admin mutations, system-org audit

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Founder (approved plan: `docs/legacy/admin-section-plan.md`, PR #118)

## Context

Every "admin" in the codebase is a **per-org membership role**
(`org_members.role = 'admin' | 'member'`). There is no founder/staff concept,
no impersonation, no cross-org user view, and the audit log (ADR 0010) has a
backend but no UI. With real customers live (Paddle billing, launch funnel),
the founder needs an internal `/admin` console — user search, support
impersonation, ban/unban, audit visibility — without SQL and without touching
the Paddle/Neon dashboards.

The identity layer is the **Better Auth admin plugin** (already in the
installed `better-auth@1.6.23`, previously unwired). Wiring it requires new
nullable columns on the auth tables, and `drizzle/**` is frozen — hence this
ADR. The full plan (7 features, 6 PRs) is in `docs/legacy/admin-section-plan.md`;
this ADR records the contract-touching decisions.

## Decision

1. **Binary platform roles, additive schema (migration `drizzle/0019_platform-admin.sql`).**
   `user` gains `role text`, `banned boolean`, `ban_reason text`,
   `ban_expires timestamptz`; `session` gains `impersonated_by text`. All
   nullable/additive — existing rows keep `NULL`, and **`NULL` role means
   `"user"`** (no backfill; never write `!== "member"`-style logic against
   it). No new org-scoped table, so no `SCOPED_READS` entry in the
   tenant-isolation sweep is needed.
2. **One staff check, two power sources.** `isPlatformAdmin(user, env)`
   (`src/lib/admin-access.ts`, re-exported from `src/lib/admin-context.ts`)
   is `user.role === "admin" || ADMIN_USER_IDS.includes(user.id)`. The new
   `ADMIN_USER_IDS` env (comma-separated Worker secret, synced by the Deploy
   workflow) is the bootstrap path — the plugin's `adminUserIds` grants power
   without setting the column, so every gate must cover both. Day-2 admins
   are promoted via the audited set-role endpoint. `appContext` exposes
   `isPlatformAdmin: boolean` — never a second `role` field (that name means
   org role).
3. **Guards live in `betterAuth({ hooks })`, not wrapper routes.** The plugin
   mounts `/api/auth/admin/*` regardless, so wrappers would be bypassable.
   `hooks.before`:
   - **`remove-user` is blocked outright**: it deletes via the internal
     adapter, bypassing `deleteUser.beforeDelete` → would skip
     `assertDeletableAndPurgeOrg` and strand org rows, violating ADR 0015's
     purge invariant. Users self-delete via `/account`.
   - **`create-user`, `update-user`, `set-user-password`,
     `revoke-user-session(s)` are blocked outright**: profile writes are cut
     (view-only admin), `update-user`'s generic `data` payload could set
     `role`/`banned` (bypassing the guards below and the audit trail), and
     ban — which is audited — covers the session-revocation emergency.
     Enforcement is a fail-closed **allowlist** of permitted `/admin/*`
     endpoints, not a denylist — a better-auth upgrade that adds or renames
     an admin mutation ships blocked, never unguarded/unaudited.
   - **Guards run only for authenticated platform-admin callers** — anyone
     else falls through to the endpoint's own 401/403, so the distinctive
     guard errors can't be used by unauthenticated or non-admin callers as
     an oracle to enumerate which user ids are platform admins.
   - **Admin-on-admin is blocked**: impersonate/ban/set-role 403 when the
     target is a platform admin (either power source). Combined with
     impersonating sessions being rejected at every `/admin` gate, this kills
     the "impersonate admin B, act as B" escalation twice over.
   - **Self set-role/ban is blocked** (lockout protection).
   - **Role values are restricted to `"user"`/`"admin"`**: a compound role
     like `"admin,user"` would read as admin to the plugin's `split(",")`
     checks but not to `isPlatformAdmin`'s exact match — a hidden-admin hole.
4. **Admin actions are audited internal-only, to the SYSTEM org.**
   `hooks.after` records `admin.impersonate.start/stop`, `admin.role.set`,
   `admin.user.ban/unban` via `ensureSystemOrg` + `forOrg(SYSTEM_ORG_ID)
   .auditLog.record(...)` (`targetKind: "user"`; metadata = role/reason only,
   never secrets — ADR 0010 rule). Customer orgs never see staff actions in
   their own audit log. Failed calls are not recorded (the after hook skips
   error returns); a failed audit write throws — loud beats silently
   unaudited admin power. Guards + audit land **in the same PR as the
   plugin**, so there is never a deployed window where admin endpoints exist
   unguarded or unaudited.
5. **Gate choke points** (`src/lib/admin-context.ts`): `requireAdminContext()`
   for `/admin` pages, `handleAdminApi()` for `/api/admin/*` routes —
   401 → 403 non-admin → 403 impersonating session → **no free-band paywall**
   (the admin's own org size is irrelevant here). `"/admin"` joins
   `APP_PATH_PREFIXES` in `src/lib/domains.ts` so the marketing host never
   serves it.
6. **Impersonation semantics** (implemented in a later PR of the chain, on
   this schema): sessions minted by impersonate-user carry
   `impersonated_by` and expire after 1h
   (`impersonationSessionDuration: 60 * 60`). The `ensureOrgOfOne` self-heal
   firing for the impersonated target is identical to the target's own
   sign-in — benign; do not "fix" it. Impersonating a **banned** user remains
   allowed (support use) — intentional. Impersonation is live-write
   ("actions are real"); a read-only mode is a future ADR.
7. **Cross-org admin reads** (later PRs) live in a new `src/db/admin.ts`,
   mirroring `src/db/system.ts` — the sanctioned schema-zone pattern. The
   audit-log viewer is a **deliberate cross-org read of customer audit data**
   by platform staff, implemented only as named exports there; this is the
   tenancy exception this ADR names (as ADR 0010 named the org-scoped
   design). `auth.api.listUsers` is used for nothing — Better Auth is
   mutations-only here.

## Tripwire

Session `cookieCache` is currently **disabled**, so `user.banned` and
`session.impersonated_by` are read fresh on every request — bans and
stop-impersonation take effect immediately. Enabling `cookieCache` later
would lag both by the cache TTL; every admin gate (`requireAdminContext`,
`handleAdminApi`, the plugin's banned check) must be revisited first. A
matching comment sits on the plugin block in `src/lib/auth.ts`.

## Contracts affected

- `drizzle/**` (frozen): additive migration `0019_platform-admin.sql`.
- `src/db/auth-schema.ts`: new nullable columns above (file itself is not in
  the frozen regex; the migration is).
- No change to `src/contracts/**`, `src/db/org-scope.ts`'s public API,
  `src/lib/credentials.ts`, `docs/connector-facts.md`, or `fixtures/**`.
  Admin API routes are internal post-freeze surfaces — zod schemas colocated
  with routes, same precedent as `api/audit/route.ts`.

## Workstreams to re-sync

None — additive columns on auth tables no other workstream reads; the admin
section is a new, self-contained surface. The (app) sidebar gains a
platform-admin-only link in a later PR of this chain.
