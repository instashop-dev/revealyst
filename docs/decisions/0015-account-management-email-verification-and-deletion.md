# 0015 — Account management: required email verification + account-deletion teardown

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Founder (via account-management planning session)

## Context

Users could sign up / sign in but had no way to manage their account afterward
(no name edit, password change, forgotten-password recovery, or deletion). Two
of the new flows touch frozen contracts, so this ADR is required (rule 1):

1. **Required email verification** needs existing users to not be locked out.
   Signup verification was never enforced and `user.email_verified` (default
   `false`) is read nowhere in app code, so every live user is `false`. Turning
   on `emailAndPassword.requireEmailVerification` would 403 every existing user
   at their next sign-in. A one-time data migration under the frozen `drizzle/**`
   path is the only safe fix.
2. **Account deletion** must not orphan data. `orgs.bootstrap_user_id` is
   `onDelete: set null`, so Better Auth's `deleteUser` cascades away the user's
   sessions/accounts/memberships but leaves the personal org — its connections
   (encrypted vendor credentials) and any active Paddle subscription (which keeps
   billing) — behind. A correct teardown must delete every org-scoped table in
   FK order, which requires raw table access the frozen `forOrg` surface doesn't
   expose.

## Decision

- **Require email verification at signup.** `emailAndPassword.requireEmailVerification:
  true` + `emailVerification { sendOnSignUp, autoSignInAfterVerification,
  sendVerificationEmail }`, and `sendResetPassword` for forgotten passwords. All
  mail goes through a new `src/lib/email.ts` (Amazon SES v2 over SigV4 via
  `aws4fetch` — no SMTP on Workers). No signup schema change; only new signups are
  gated.
- **Backfill migration 0018** (`drizzle/0018_backfill-email-verified.sql`, data
  only): `UPDATE "user" SET email_verified = true WHERE email_verified = false`.
  Runs in Deploy before the new Worker version, so existing users stay in.
- **Account deletion is gated + purges the org-of-one.** Better Auth
  `user.deleteUser.beforeDelete` calls a new `assertDeletableAndPurgeOrg(db,
  userId)` in **`src/db/account-deletion.ts`** (a NEW schema-zone module, not the
  frozen `forOrg` public API). It resolves the user's bootstrap org, then:
  - **blocks** if the org has more than one member (transfer/remove first) —
    `kind` is not a proxy for "org of one" (a personal-kind org can have members);
  - **blocks** unless every subscription row is fully `canceled` — a `paused`
    row is resumable via Paddle's customer portal (ADR 0011) and must block
    deletion too, not just an entitling (`active`/`trialing`/`past_due`) one;
  - otherwise deletes every org-scoped table in FK-safe order (each statement
    pinned to the one `org_id`, drawn from an exported `PURGE_TABLES` list with a
    schema-driven completeness test — `tests/account-deletion.test.ts` — mirroring
    `tests/tenant-isolation.test.ts`'s tripwire so a future org-scoped table can't
    silently skip the purge), then the org row — whose delete cascades invites,
    benchmark_consent, subscriptions, audit_log.
  Gate failures throw Better Auth's `APIError` (not a plain `Error`) so the
  message reaches the client — better-call's router bodyless-500s a plain thrown
  `Error`. `sendDeleteAccountVerification` is deliberately NOT configured, so
  delete runs on the immediate path: password-gated for credential accounts, or
  (no password sent) gated on session freshness (Better Auth's default 24h
  `session.freshAge`) for GitHub-OAuth-only accounts, which have no password to
  verify. `hasCredentialAccount(db, userId)` (same module) tells the UI which
  mode applies, and also gates change-password (OAuth-only accounts have no
  password to change and no client-exposed way to set one — the account page
  shows an explanatory message instead of a form that can never succeed).
- **`/account` is exempted from the free-band paywall shell.** The (app) layout
  replaces all children with the upgrade paywall for a blocked org, with no prior
  path-level exception (unlike `handleApi`'s `allowOverFreeBand`) — which would
  trap exactly the users most motivated to delete their account behind a paywall
  they can't pay. A minimal `middleware.ts` forwards the pathname via an
  `x-pathname` header (server components have no direct pathname API); the
  layout reads it and skips the block for `/account`.
- **Password reset now revokes other sessions** (`revokeSessionsOnPasswordReset:
  true`), matching change-password-form.tsx's `revokeOtherSessions: true` — a
  reset is often an account-recovery action and should invalidate a
  possibly-compromised session, not leave it live.
- **Name edit stays client-only** (`authClient.updateUser({ name })`): the sidebar
  footer shows `user.name`; the header `org.name` is a distinct workspace label we
  intentionally leave unchanged, avoiding the first-ever `orgs.name` writer (which
  via `forOrg` would widen the frozen surface).

## Contracts affected

- **`drizzle/**`** — additive: migration `0018_backfill-email-verified` (data-only,
  no schema/column change; `email_verified` already exists).
- **`src/db/org-scope.ts` public API** — **unchanged.** The deletion teardown lives
  in the new `src/db/account-deletion.ts` (schema zone, allowed by
  `check-org-scope.mjs`) rather than widening `forOrg`.
- No `src/contracts/**`, no `tracked_user`, no credential-shape, no
  `connector-facts.md`, no fixture change.

## Workstreams to re-sync

None — additive. No existing consumer's shape changes. New auth behavior
(`requireEmailVerification`) changes the signup→app flow; `tests/auth.test.ts` is
updated in the same PR to verify before signing in.

## Consequences

- **Deletion permanently destroys the user's workspace and all its data by design**
  (connections, encrypted credentials, subjects, metric_records, scores, …). Gated
  behind a password + explicit confirm dialog; UI copy states this honestly
  (invariant b). No audit row is written for the delete — a full org-of-one purge
  cascades `audit_log` away and there is no other admin to read it; a retained
  audit sink is a possible follow-up.
- **Known limitation (accepted for personal-mode V1):** if a deleting user is the
  sole admin of a *different* org they were invited into, their membership simply
  cascades away, potentially leaving that org admin-less. Only the user's own
  bootstrap org is purged. Revisit with ownership-transfer when Team mode matures.
- **SES sandbox is a launch dependency.** A new SES account only sends to verified
  addresses until AWS grants production access; until then verification/reset mail
  to real signups silently no-ops server-side and — with `requireEmailVerification`
  — new users can't get in. `EMAIL_FROM` must be a verified identity on
  `revealyst.com`. Enable verification in prod only after SES production access +
  domain verification are confirmed. The unconfigured-SES log line never includes
  the token-bearing email body outside development, so this failure mode is
  silent but not also a credential-log leak.
- **Known limitation, accepted: email-send failures are swallowed, not just when
  SES is unconfigured.** Better Auth invokes `sendResetPassword` /
  `sendVerificationEmail` via `runInBackgroundOrAwait`, which catches and only
  logs a thrown error — a genuine SES failure (bad `EMAIL_FROM` identity,
  throttling) never reaches the signup/reset caller, which still reports success.
  There is no config knob to change this; mitigate by keeping SES healthy
  (verified domain, production access) and watching Worker logs, not by relying
  on client-visible errors.
- **Purge is unbounded within one transaction** (like the ADR 0013 connection
  delete). Fine at current org sizes; a mature multi-year org may need batched
  deletion before large-org GA. An org-of-one is small by definition, so this is
  lower-risk than the connection-delete case.
- **Known limitation, accepted: the org purge and Better Auth's user-row deletion
  are two separate operations, not one transaction.** `beforeDelete` commits the
  org purge; Better Auth then deletes the `user` row as a further step. A failure
  in that second step (a transient Hyperdrive error) after the purge commits would
  strand a userless purge — the workspace is gone, the account survives, and the
  caller sees a generic error. Rare (requires a failure in the narrow window
  between the two steps) and not fixable without Better Auth exposing a shared
  transaction; not worth blocking on.
