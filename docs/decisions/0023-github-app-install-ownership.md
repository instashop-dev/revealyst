# 0023 — Verify GitHub App installation ownership in the Copilot connect callback

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** security review, founder

## Context

A security review found a **HIGH cross-tenant vulnerability** (confused deputy)
in the Copilot GitHub-App connect callback shipped with ADR 0022.

The connect flow is: `GET /api/integrations/github/setup` signs an org-bound
CSRF `state`, drops it in an httpOnly cookie, and redirects to the App install
page; GitHub redirects back to `GET /api/integrations/github/callback` with
`installation_id` + `state`. The callback verified the state (double-submit
cookie + org-bound HMAC) and then **trusted the `installation_id` URL query
param with no proof the authenticated caller controls that installation.**

Why the state check is insufficient: the org-bound state is minted *before* the
installation exists, so it can only prove the caller started a connect flow for
their **own** org — it cannot bind to a specific installation.
`getInstallationAccount` authenticates as **Revealyst's own App**, so it
resolves **any** installation of the App, regardless of who is driving the
browser.

**Exploit.** Attacker signs up (org A) → `GET /setup` (gets a valid state +
cookie for org A) → directly `GET /callback?installation_id=<VICTIM_ID>&state=
<their own state>` with their cookie. GitHub installation ids are
sequential/enumerable. Result: **org A gets a `github_copilot` connection bound
to the victim's installation** and polls the victim organization's per-developer
Copilot usage — a cross-tenant workforce-analytics leak (invariant b/tenancy).

The reverse direction (binding the attacker's own install onto a victim org) is
already prevented by the org-bound state; only "pull a victim installation into
MY org" was exploitable.

This is a security-hardening decision recorded as an ADR for traceability. It
touches **no frozen contract**: no `schema.ts`/`drizzle` change, no
`contracts/api.ts` change (the `/api/integrations/*` routes are ad-hoc per the
house pattern), no `credentials.ts` change. The credential seam is unchanged —
still one `github_app_private_key` JSON blob; the added OAuth client id/secret
are **App-level Worker secrets, not per-connection credentials**, so they never
enter the envelope.

## Decision

Prove the connecting user controls the installation **before** binding it, using
GitHub's standard **"Request user authorization (OAuth) during installation"**
pattern:

1. The GitHub App has "Request user authorization (OAuth) during installation"
   enabled (a founder dashboard setting — see GO-LIVE below). GitHub then
   returns a temporary `code` to the callback alongside `installation_id` +
   `state`. The install URL needs no change; the setting drives the round-trip.
2. In the callback, after verifying the org-bound state (kept intact), the flow
   (`connectGithubCopilotInstall`, `src/lib/api-impl.ts`):
   a. exchanges the `code` for a **user-to-server** token
      (`POST https://github.com/login/oauth/access_token`);
   b. resolves which account the installation is on (App-authenticated
      `GET /app/installations/{id}` — works for any id, but the **resolved**
      login, never the caller's input, is what step (c) checks);
   c. **requires the user to be an ACTIVE ADMIN of that org**
      (`GET /user/memberships/orgs/{org}` → `role === "admin" && state ===
      "active"`). Admin — not mere access — is the bar, because
      `GET /user/installations` lists installations an ordinary org **member**
      with repo access can reach, so an accessibility check alone would still
      let a non-admin member bind the whole org's Copilot data. For a **non-org**
      install (personal account; enterprise is founder-gated) the flow falls
      back to installation accessibility (`GET /user/installations`), which is
      owner-only for a personal account.
   Only after that proof does it call `completeGithubCopilotInstall`. Every
   failure of the proof — missing code, failed exchange, not an org admin / not
   the installation owner, or an errored check (**fail closed**) — is an
   **audited** refusal to bind (`connection.install_rejected`, with the probed
   installation id and the precise reason) and redirects with a uniform
   `?copilot_error=ownership` (uniform on purpose: it avoids leaking whether an
   installation exists; the audit metadata distinguishes the causes). No
   connection or credential is written.

   **Idempotency runs first.** A healthy existing connection for this
   installation is reused (a reconfigure re-install can legitimately arrive
   without a fresh `code`); that connection was bound with ownership already
   proven, so reuse is safe. A credential-less **orphan** — left if a prior
   `create` succeeded but `storeCredential` crashed (they are not one
   transaction) — is not reusable; it is replaced by a full re-bind (which
   re-runs the ownership proof), so a broken connection never masquerades as
   "connected".
3. Two new App-level Worker secrets gate the flow:
   `GH_COPILOT_APP_CLIENT_ID` / `GH_COPILOT_APP_CLIENT_SECRET` (names already
   reserved in `docs/approvals.md`). `readCopilotAppConfig` requires them
   alongside the existing App id/key/slug, so the whole connect flow — and the
   connect card that reads the same config — stays **honestly disabled** until
   **all** secrets sync, never a half-wired flow that skips the security gate.

**Route-logic-in-lib:** the callback stays thin HTTP glue; the
security-critical binding lives in `connectGithubCopilotInstall` so it is
unit-tested against PGlite (`tests/github-copilot-connect.test.ts`) without a
Worker runtime — the house "route logic → lib for testability" pattern.

**Access level (review Finding 2, LOW):** `setup`/`callback` use `appContext`
directly (any org member, not admin-only). This is **baseline-consistent** —
`POST /api/connections` is likewise not admin-only ("adding a connection is open
to all members"; edit/delete are admin-only per ADR 0013). Requiring admin only
here would be an inconsistent one-off, so it is deliberately left as-is.

## Contracts affected

- **None.** No frozen path changes. `src/contracts/**`, `src/db/schema.ts`,
  `drizzle/**`, `src/lib/credentials.ts`, and `src/db/org-scope.ts` are all
  untouched.
- Non-frozen code: `src/connectors/copilot/github-app.ts`
  (`exchangeInstallationCode`, `userControlsInstallation`),
  `src/lib/github-app-config.ts` (client id/secret in `CopilotAppEnv`/config +
  gating), `src/lib/api-impl.ts` (`connectGithubCopilotInstall`), the callback +
  setup routes, and the connections-page banner (an `ownership` message).

## Workstreams to re-sync

- **W4-T (Copilot connector):** the connect flow now requires the OAuth
  secrets + the dashboard setting to operate. Connector poll/normalize paths are
  unchanged.
- No other workstream consumes the connect callback.

## Consequences

- **Cross-tenant leak closed:** an installation can be bound only by a caller
  who provably administers it. Enumerating victim installation ids is now inert.
- **Fail-closed:** any inability to verify ownership (no code, bad exchange,
  GitHub error) refuses to bind and audits — never silently binds.
- **Founder GO-LIVE (not agent work), added to `scripts/verify/copilot.mjs`:**
  - Sync **five** secrets now (was three): `GH_COPILOT_APP_ID`,
    `GH_COPILOT_APP_PRIVATE_KEY`, `GH_COPILOT_APP_SLUG`,
    **`GH_COPILOT_APP_CLIENT_ID`**, **`GH_COPILOT_APP_CLIENT_SECRET`**. The
    connect flow stays disabled until all five are present.
  - **Enable "Request user authorization (OAuth) during installation"** on the
    GitHub App. Without it GitHub sends no `code` and every connect attempt
    fails closed (`?copilot_error=ownership`).
  - These secrets are **not** wired into `deploy.yml` (mirrors the existing
    `GH_COPILOT_APP_*` deferral in ADR 0022 / `docs/approvals.md`); wire them in
    the same founder go-live step, using the existing `put`-skips-if-absent
    helper so CI never breaks on their absence.
- **Enterprise installs are the weak spot, and are founder-gated.** V1.5 targets
  Copilot **Business (org)**; an enterprise install currently falls back to the
  accessibility check (there is no per-user enterprise-admin endpoint as clean
  as `/user/memberships/orgs/{org}`). Enterprise support is deferred to the
  first enterprise customer (per `docs/approvals.md`), and the enterprise-admin
  proof must be designed then — do not treat the accessibility fallback as an
  admin gate for enterprise.
- **A few extra user-token round-trips** at connect time (code exchange, account
  resolve, admin-membership check). Connect is a rare, interactive action — the
  cost is irrelevant next to the tenancy guarantee.
