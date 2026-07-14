# Platform Admin Section — Implementation Plan

> Status: **SHIPPED** (2026-07-08 approval → merged via PRs #119–#123, recorded in
> [ADR 0016](decisions/0016-platform-admin.md)). This plan is retained as the historical
> design record; the ADR/migration numbers below were pre-implementation estimates —
> the actual artifacts are ADR 0016 and its migration. `remove-user` deliberately stays
> blocked (it would bypass the account-deletion purge hook).

## Context

Revealyst has no platform-level admin surface. Every "admin" in the codebase today is a **per-org membership role** (`org_members.role = 'admin' | 'member'`) — there is no founder/staff concept, no impersonation, no cross-org user view, and the audit log (ADR 0010) has a backend but no UI. As the product takes on real customers (Paddle billing live, launch funnel running), the founder needs an internal console to answer support questions ("what does this user see?"), respond to abuse, and account for staff actions — without SQL and without touching the Paddle/Neon dashboards.

This plan adds a platform-admin section at `/admin`: dashboard, user management (search/filter/sort), user detail, impersonation with end-impersonation, an audit-log viewer, and a binary role model — built on the **Better Auth admin plugin** (already available in the installed `better-auth@1.6.23`, currently unwired) and the codebase's existing seams (`appContext`, `handleApi` pattern, `forOrg` audit log, `src/db/system.ts` cross-org pattern, base-nova UI).

**Confirmed scope decisions (founder):** binary `user`/`admin` platform roles · ban/unban included · admin actions audited **internal-only** (system org's audit log, not visible to customer orgs).

## Architecture decisions

1. **Identity = Better Auth admin plugin.** Adds `user.role`, `user.banned`, `user.ban_reason`, `user.ban_expires`, `session.impersonated_by`; mounts `/api/auth/admin/*` endpoints (list-users, impersonate-user, stop-impersonating, set-role, ban/unban-user). Bootstrap via a new `ADMIN_USER_IDS` env (comma-separated Worker var); day-2 admins promoted via audited set-role. Verified against v1.6.23 docs.
2. **One gate helper, used everywhere:** `isPlatformAdmin(user, env)` in a new `src/lib/admin-context.ts` — `user.role === "admin" || ADMIN_USER_IDS.includes(user.id)` (null role = `"user"`; the plugin's `adminUserIds` grants power without setting the column, so the check must cover both). `appContext` exposes it as `isPlatformAdmin: boolean` (never a second `role` field — that name already means org role).
3. **Separate admin shell**, not the (app) shell: new route group `src/app/(admin)/admin/**` with its own layout (`requireAdminContext()`, **no paywall**, own sidebar: Overview / Users / Audit / Back to app, visually distinct header). The (app) sidebar gets a platform-admin-only "Admin" link for discovery only. Keeps admin exceptions out of customer-facing layout code.
4. **Gate the API choke point too:** `handleAdminApi(fn)` in `admin-context.ts` mirrors `handleApi` (401 → 403 non-admin → **reject sessions where `session.impersonatedBy` is set** → no paywall → ApiError mapping). Both the layout and every `/api/admin/*` route use it — a UI-only gate would leave cross-org data readable with a session cookie (the W3-M lesson).
5. **Cross-org reads live in a new `src/db/admin.ts`**, mirroring `src/db/system.ts` (the only sanctioned pattern: `check-org-scope.mjs` allows schema imports only under `src/db/`; routes may import exported functions). Reads: platform stats, user list with joins, user detail, cross-org audit list. `auth.api.listUsers` is used for **nothing** — it can't join orgs/subscriptions; Better Auth is mutations-only here.
6. **Audit via `betterAuth({ hooks })` inside `createAuth`**, not wrapper routes: the plugin's endpoints are mounted regardless, so wrappers would be bypassable. `hooks.before` = guard layer (block admin-on-admin actions, self-actions, remove-user); `hooks.after` = writes `admin.*` audit rows to the **system org** via `ensureSystemOrg` + `forOrg(systemOrgId).auditLog.record(...)`. Client stays the documented `authClient.admin.*` path.
7. **No changes to frozen `src/contracts/api.ts`:** admin routes are internal, post-freeze surfaces — zod schemas colocated with routes (existing `parseQuery`/`parseBody` from `src/lib/api-route.ts` accept any ZodType), same precedent as `api/audit/route.ts`.
8. **UI built entirely from existing primitives** (Table/Card/Badge/Input/DropdownMenu/Dialog/Sonner + `PageHeader`/`EmptyState`/`TableSkeleton`); server-component-first with URL-searchParams-driven search/sort/filter/pagination (no client table lib — none exists in the codebase and none is needed). No new shadcn components required.

## Features

### 1. Platform-admin foundation (roles/permissions)
- **Purpose:** a durable "who is staff" concept and the security choke points every other feature stands on. Binary `user`/`admin`.
- **Implementation:** enable `admin({ adminUserIds, defaultRole: "user", impersonationSessionDuration: 60 * 60 })` in `createAuth`; `adminClient()` in `auth-client.ts`; add `ADMIN_USER_IDS` to `AuthEnv`; new `src/lib/admin-context.ts` with `isPlatformAdmin`, `requireAdminContext()` (wraps `appContext`; redirects non-admins to `/dashboard`; rejects impersonating sessions), `handleAdminApi()`. `appContext` returns `isPlatformAdmin`. Add `"/admin"` to `APP_PATH_PREFIXES` in `src/lib/domains.ts` (else `classifyPath` calls it "neutral" and it serves on the marketing host).
- **Affected files:** `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/api-context.ts`, `src/lib/admin-context.ts` (new), `src/lib/domains.ts`, `src/db/auth-schema.ts`, `drizzle/0019_*` (new), `docs/decisions/0016-platform-admin.md` (new — re-verify both numbers at PR time; ADR and migration sequences are independent and both have collided before).
- **DB changes:** `user` + `role text`, `banned boolean`, `ban_reason text`, `ban_expires timestamptz`; `session` + `impersonated_by text`. All nullable/additive. No org-scoped table → no `SCOPED_READS` entry needed (tenant-isolation tripwire only sweeps tables with `org_id`).
- **Security notes:** `drizzle/**` is frozen → ADR required in the same PR (`auth-schema.ts` itself is not in the frozen regex, but the migration is). Existing rows get `role = NULL` — treat as `"user"`, never `!== "member"`-style logic. Session cookie cache is currently disabled, so `banned`/`impersonatedBy` are always fresh; add a tripwire comment in `auth.ts` + ADR line that enabling `cookieCache` later would lag ban/stop-impersonation and must revisit these gates. Guards + audit hooks must land **in the same PR as the plugin** so there is never a deployed window where admin endpoints exist unguarded/unaudited.

### 2. Guard + audit hooks for admin mutations
- **Purpose:** make admin power non-abusable and fully accounted for, at the auth handler level where it can't be bypassed.
- **Implementation:** in `createAuth`, `hooks.before` matching `/admin/*` paths: block `remove-user` entirely (403); block impersonate/ban/set-role when the **target** is a platform admin; block set-role/ban on **self** (lockout protection). `hooks.after`: record `admin.impersonate.start`, `admin.impersonate.stop`, `admin.role.set`, `admin.user.ban`, `admin.user.unban` to the system org's audit log (`targetKind: "user"`, `targetId`, metadata = role/reason — never secrets).
- **Affected files:** `src/lib/auth.ts` (createAuth already closes over `db`; needs the system-org id — reuse the existing system-org convention from `src/db/system.ts` `ensureSystemOrg`).
- **DB changes:** none (reuses `audit_log` + system org).
- **Security notes:** admin user **deletion is cut**: the plugin's `remove-user` deletes via the internal adapter and bypasses `deleteUser.beforeDelete` → would skip `assertDeletableAndPurgeOrg` and strand org rows (violates ADR 0015's purge invariant); the before-hook 403s it outright. Blocking impersonate-an-admin + rejecting impersonating sessions at `/admin` kills the "impersonate admin B, act as B" escalation twice over. Impersonating a **banned** user remains allowed (support use) — documented as intentional.

### 3. Admin dashboard (`/admin`)
- **Purpose:** at-a-glance platform health: growth (users/orgs/signups), connector fleet health, subscription rollup — this product's equivalent of "system status per merchant".
- **Implementation:** `platformStats(db)` in `src/db/admin.ts` (user count, org count by kind excluding `system`, signups last 30d from `user.createdAt`, connections status histogram + recent `connector_runs` failures, subscription status rollup; prior art: `src/lib/launch-funnel.ts` / `scripts/launch-metrics.ts`). Server-component page: stat cards + two small tables (recent signups, recent connector failures), `force-dynamic`, `requireAdminContext()`. Admin shell layout `src/app/(admin)/admin/layout.tsx` reusing `Sidebar*` primitives; (app) sidebar gets the gated "Admin" entry (new prop from `(app)/layout.tsx`, third `SidebarGroup` alongside the existing `ADMIN_NAV_ITEMS` pattern in `app-sidebar.tsx`).
- **Affected files:** `src/db/admin.ts` (new), `src/app/(admin)/admin/layout.tsx` + `page.tsx` (new), `src/components/admin/*` (new: admin sidebar/nav, stat cards), `src/components/app-sidebar.tsx`, `src/app/(app)/layout.tsx`.
- **DB changes:** none.
- **Security notes:** all reads via named exported functions in `src/db/admin.ts` (org-scope guard passes by construction); page + any JSON routes both gated (`requireAdminContext`/`handleAdminApi`); no paywall on admin (admin's own org may be over the free band — irrelevant here).

### 4. User management list (`/admin/users`) with search/filter/sort
- **Purpose:** find any user fast and see who they are: org, org-role, plan, banned/platform-admin status, signup date.
- **Implementation:** `listUsersForAdmin({ search, sort, sortDir, filter, limit, offset })` in `src/db/admin.ts` — joins `user` → `org_members` → `orgs` (most-recent membership, same rule as `orgContextForUser`) → derived plan from `subscriptions`; search over email+name (ILIKE), sort by signup date/name/email, filters: banned / platform-admin / plan / org kind; returns `{ rows, total }`. Server-rendered page driven by `searchParams`: GET-form search input, header-link sorting, dropdown-menu filter links, prev/next `<Link>` pagination — bookmarkable URLs, zero client state. Template: `(app)/members/page.tsx` table + `Badge` conventions.
- **Affected files:** `src/db/admin.ts`, `src/app/(admin)/admin/users/page.tsx` (new), `src/components/admin/users-table.tsx` + filter controls (new), `loading.tsx` via `TableSkeleton`.
- **DB changes:** none.
- **Security notes:** offset pagination is fine at founder scale (the audit viewer, which grows unboundedly, uses cursors instead). Clamp `limit`; validate sort/filter fields against an allowlist server-side (no raw column names from the URL).

### 5. User detail (`/admin/users/[id]`)
- **Purpose:** the support console for one user: who they are, what they can access, what's been happening, and the action surface (impersonate / set role / ban).
- **Implementation:** `userDetailForAdmin(db, userId)` in `src/db/admin.ts`: profile + platform role + ban state; memberships with org names/kinds/roles; entitlement per org (`subscriptionsForOrg(...).current()` + tracked-user count); connections summary (vendor, status, lastSuccessAt/lastError); recent audit entries where `actorUserId = userId` (cross-org). Page: stacked `Card`s (template: `(app)/account/page.tsx`), actions in the `PageHeader` slot. Actions are small client components calling `authClient.admin.setRole` / `banUser` / `unbanUser` → sonner toast → `router.refresh()` (the codebase's standard mutation pattern); ban dialog collects a reason (→ `ban_reason`).
- **Affected files:** `src/db/admin.ts`, `src/app/(admin)/admin/users/[id]/page.tsx` (new), `src/components/admin/` role/ban/impersonate action components (new).
- **DB changes:** none.
- **Security notes:** guards live server-side in the auth hooks (feature 2) — the UI merely disables buttons (with tooltip) for platform-admin targets and self. Never render credential material; connections summary shows status fields only. Every action lands a system-org audit row.

### 6. Impersonation + end impersonation
- **Purpose:** see exactly what a user sees — the single highest-value support tool in comparable SaaS panels.
- **Implementation:** "Log in as user" button on user detail → `authClient.admin.impersonateUser({ userId })` → **full navigation** (`window.location.assign("/dashboard")`, not client nav — new session cookie). `appContext` flows unchanged: `getSession` returns the target user's session with `impersonatedBy` set; `ensureOrgOfOne` self-heal firing for the target is identical to their own sign-in (benign — note in ADR so nobody "fixes" it). Persistent banner rendered from `(app)/layout.tsx` when `ctx.session.session.impersonatedBy` is set — in **both** layout branches (normal shell AND the `UpgradePaywall` return, or the admin has no escape control when the target org is over the free band): "Viewing as {name} — actions are real" + "End impersonation" button → `authClient.admin.stopImpersonating()` → navigate back to `/admin/users/[id]`. Session auto-expires after 1h (`impersonationSessionDuration`, set explicitly).
- **Affected files:** `src/app/(app)/layout.tsx`, `src/components/admin/impersonation-banner.tsx` (new), `src/components/admin/impersonate-button.tsx` (new), `src/lib/api-context.ts` (expose impersonation state).
- **DB changes:** none (`session.impersonated_by` landed in feature 1).
- **Security notes:** an impersonated session is rejected by `requireAdminContext` **and** `handleAdminApi` (no `/admin` reach while wearing the user's hat). Impersonating another platform admin is blocked in `hooks.before`. Paywall behavior is intentional: the admin sees the user's blocked state; `stopImpersonating` goes through `/api/auth/*` (never `handleApi`), so the 402 gate can't trap them. The banner's "actions are real" wording matters: writes (incl. opening Paddle checkout as the customer) are live — Stripe-style read-only impersonation is a future ADR, not MVP. Both start and stop are audited.

### 7. Audit log viewer (`/admin/audit`)
- **Purpose:** answer "what did admin X do yesterday" and "what happened in org Y" without SQL — the accountability closer for everything above. Also finally gives ADR 0010's backend a UI.
- **Implementation:** `platformAuditList(db, { orgId?, actorUserId?, action?, before?, beforeId?, limit })` in `src/db/admin.ts` — cross-org read of `audit_log`, newest-first, same `(createdAt, id)` compound cursor as `forOrg(...).auditLog.list` (clamped ≤200), joined with actor email + org name. `GET /api/admin/audit` route: `handleAdminApi` + colocated zod query schema via `parseQuery`. Page: first page server-rendered; filters as a GET form (org, actor, action prefix); "Load more" client component appends via the JSON route (cursor pattern — matches the existing `api/audit` design; offset pages would break on an append-only unbounded table).
- **Affected files:** `src/db/admin.ts`, `src/app/(admin)/admin/audit/page.tsx` (new), `src/app/api/admin/audit/route.ts` (new), `src/components/admin/audit-table.tsx` + load-more (new).
- **DB changes:** none. (If org/action filtering is slow later, an index is a follow-up migration+ADR; `audit_log_org_created_idx` covers the org+cursor path today.)
- **Security notes:** this is a deliberate cross-org read of customer audit data — named explicitly in the ADR (the tenancy exception, like ADR 0010 named the org-scoped design) and implemented only as the named export in `src/db/admin.ts`. `metadata` is rendered as inert preformatted JSON (it never contains secrets by ADR 0010 rule, but render defensively). Route returns 403 to non-admins and impersonating sessions via `handleAdminApi`.

## What comparable SaaS admin panels have — and what we deliberately cut

Benchmarked against Stripe-style internal tools, Django admin, Clerk/WorkOS dashboards. **Included beyond the literal MVP list (all near-free):** ban/unban (confirmed), read-only billing/entitlement visibility on user detail (the #1 support question; zero Paddle write risk), connector health on the dashboard (this product's per-customer status signal).

**Explicitly cut:** admin user deletion (bypasses the ADR 0015 purge hook — blocked at the auth layer; users self-delete via /account) · custom permission matrix (`createAccessControl`) — binary is right at founder scale · billing mutations (refunds/comps → Paddle dashboard, which has its own audit + permissions) · org CRUD / editing user profile fields (view-only; every write is an invariant risk) · session list/revocation UI (ban covers the emergency) · CSV export, charts, email-to-user, feature flags (classic internal-tool scope creep) · read-only "view as" impersonation mode (valuable, but requires threading a mode through every mutation path — future ADR; mitigated by the banner warning).

## PR breakdown (6 small, independently mergeable PRs)

Every PR: build → own tests → `/code-review` + **apply fixes before `gh pr create`** (merge-race rule) → merge on green CI. Each leaves production fully functional with the feature inert or additive. Chain: PR1 → PR2 → PR3 → PR4 → PR5; PR6 needs only PR2 (can run parallel to PR3–5).

### PR1 — Platform-admin foundation (the only frozen-path PR)
Features 1+2: ADR `docs/decisions/0016-platform-admin.md` (verify number against `ls docs/decisions/` at PR time — 0014 collided once already) + `drizzle-kit generate --name platform-admin` (verify against `ls drizzle/*.sql`) + admin plugin + guard/audit hooks + `adminClient` + `admin-context.ts` + `appContext.isPlatformAdmin` + `domains.ts` `/admin` prefix. `ADMIN_USER_IDS` documented in `docs/infra.md` + deploy-workflow secret sync.
**Tests** (extend `tests/auth.test.ts` PGlite pattern): non-admin → admin endpoints 403; admin set-role/ban/impersonate succeed and each lands a system-org audit row; impersonate-an-admin blocked; self-ban/self-set-role blocked; remove-user blocked; ban revokes target sessions; `isPlatformAdmin` null-role + `adminUserIds` cases; `/admin` path classification.
**Acceptance:** CI green (org-scope guard, tenant isolation, frozen-contract check satisfied by the ADR); deployed app behaviorally unchanged for all users; a bootstrapped admin ID can call `/api/auth/admin/list-users`; every admin mutation is guarded + audited from the first deployed moment.

### PR2 — Admin shell + dashboard
Feature 3: `src/db/admin.ts` with `platformStats`; `(admin)/admin/layout.tsx` + `/admin` page; (app) sidebar "Admin" entry; `site-header.tsx` untouched (admin shell has its own header).
**Tests:** `platformStats` against seeded PGlite (counts, histogram, excludes system org); `requireAdminContext` redirect behavior.
**Acceptance:** non-admins see no nav entry and are redirected from `/admin`; admins see real numbers; marketing host never serves `/admin`.

### PR3 — User management list
Feature 4: `listUsersForAdmin` + `/admin/users` page with URL-driven search/sort/filter/pagination.
**Tests:** search matches email+name; sort allowlist + stability; pagination totals; banned/plan/platform-admin filters.
**Acceptance:** find any user by partial email in one request; every list state is a bookmarkable URL; non-admins get 0 bytes of user data (route + page both gated).

### PR4 — User detail + role/ban actions
Feature 5: `userDetailForAdmin` + `/admin/users/[id]` + set-role/ban/unban client actions.
**Tests:** detail reader (memberships, entitlement, connections summary, actor-audit slice); integration: ban → target session revoked + audit row; UI guard states for self/admin targets.
**Acceptance:** role change and ban/unban work end-to-end with toasts and audit rows; action buttons disabled with tooltip for platform-admin targets and self; no credential data rendered.

### PR5 — Impersonation
Feature 6: impersonate button, banner in both (app) layout branches, end-impersonation flow.
**Tests:** auth-layer flow (start → session shows `impersonatedBy` + target user → stop restores admin); impersonating session rejected by `handleAdminApi` (403) and `requireAdminContext` (redirect); banner renders on the paywall branch.
**Acceptance:** admin lands in the user's app as them; banner (with "actions are real" + end button) is always visible, including over the paywall; ending impersonation returns to the user's detail page; both events in the audit log.

### PR6 — Audit log viewer
Feature 7: `platformAuditList` + `/api/admin/audit` + `/admin/audit` page with filters + load-more.
**Tests:** cross-org cursor correctness; filter combinations (org, actor, action); limit clamp; 403 for non-admin/impersonating callers.
**Acceptance:** "what did admin X do yesterday" and "what happened in org Y" answerable via filters; pagination stable under concurrent inserts (compound cursor).

## Verification (end-to-end, per the repo's constraints)

- **Unit/integration:** all new logic lives in `src/db/admin.ts` + `src/lib/admin-context.ts` + auth hooks — testable against PGlite like `tests/auth.test.ts`/`tests/audit-log.test.ts` (relative imports only in lib/db code — vitest doesn't resolve `@/`). Rerun known-flaky files in isolation before treating failures as regressions.
- **Live-ish check:** the `dev:db` PGlite socket can't drive an authenticated app-shell flow (prepared-statement bug) — so gate behavior (403s, redirects, banner) is unit-tested, and the full impersonation loop is verified on the PR preview deployment: bootstrap `ADMIN_USER_IDS` with the founder's user id, sign in, visit `/admin`, search a test user, impersonate → banner → end impersonation → check `/admin/audit` shows all events.
- **Security sweep:** confirm as an impersonating session that `/admin` redirects and `/api/admin/*` 403s; confirm as a plain user that `/api/auth/admin/*` 403s; confirm `/admin` on `revealyst.com` redirects to `app.revealyst.com`.
- **CI:** org-scope guard, tenant-isolation sweep, frozen-contract ADR check, typecheck + full suite green on every PR.
