# Infrastructure setup — founder actions (W0-B)

**Status (2026-07-05): production is live at https://revealyst.thapi.workers.dev
— all infra items complete.** Custom domains (§6) attach `app.revealyst.com`
(app/auth) + `revealyst.com` (marketing). Done: Cloudflare secrets (§1) ✅ · Neon +
migrations 0000–0002 (§2) ✅ · Hyperdrive `revealyst-neon` bound (§3) ✅ · auth
secrets `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` + `DATABASE_URL` (§4.1–2) and
GitHub *login* OAuth `GH_OAUTH_CLIENT_ID`/`GH_OAUTH_CLIENT_SECRET` (§4.3) as repo
secrets, synced to the Worker by the Deploy workflow ✅ · `revealyst-poll` queue
(§5) ✅ — verified: authenticated page + scheduled heartbeat rows landing in Neon,
and the production GitHub sign-in returns a valid authorize URL. Remaining W0-C
hardening (not an infra-setup item): remove the `DATABASE_URL` Worker-runtime
fallback + TLS workaround in `src/db/client.ts` now that Hyperdrive is bound.

## 1. Cloudflare (unblocks: preview deploys, production deploy)
1. Create/log into the Cloudflare account; note the **Account ID**. ✅
2. Create an API token with the **Edit Cloudflare Workers** template. ✅
3. Add GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. ✅
   CI's preview-deploy job activates automatically once these exist.
4. **Production deploy — run the `Deploy` workflow** (Actions tab →
   Deploy → Run workflow, or `gh workflow run deploy.yml`). It runs
   migrations (if `DATABASE_URL` repo secret is set), creates the
   `revealyst-poll` queue (needs Workers Paid), deploys, and syncs Worker
   secrets from these optional repo secrets: `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GH_OAUTH_CLIENT_ID`,
   `GH_OAUTH_CLIENT_SECRET`. Add those before (or re-run after) so the
   deployed Worker can reach the database and issue sessions.

## 0. No-credential local loop (works today)
`npm run dev:db` starts an in-memory Postgres (PGlite behind a wire-protocol
socket) with migrations applied; point `.dev.vars` `DATABASE_URL` at
`postgres://postgres:postgres@127.0.0.1:5432/postgres` and `wrangler dev
--test-scheduled` exercises the full cron → queue → heartbeat path locally.
Data vanishes on exit — dev convenience only, never a Neon substitute.

## 2. Neon Postgres (unblocks: real database)
1. Create a Neon project (region close to the Cloudflare Workers region you
   expect to serve from; EU per the positioning).
2. Copy the **pooled** connection string.
3. Local dev: put it in `.dev.vars` as `DATABASE_URL` (see `.dev.vars.example`;
   gitignored, copied into worktrees via `.worktreeinclude`).
4. Run migrations: `DATABASE_URL=<pooled-url> npx drizzle-kit migrate`.
   Migrations always run from local/CI, never from the Worker.

## 3. Hyperdrive (unblocks: pooled DB access from the Worker; do after 1+2) ✅
Bound as `revealyst-neon` (id `1f3ab3aa39ac4df793b5f8454fade3a2`), PR #13.
1. `npx wrangler hyperdrive create revealyst-neon --connection-string="<neon-direct-url>"`
2. Add to `wrangler.jsonc`:
   ```jsonc
   "hyperdrive": [
     {
       "binding": "HYPERDRIVE",
       "id": "<id from step 1>",
       "localConnectionString": "<neon-pooled-url or local pg, for wrangler dev>"
     }
   ]
   ```
3. Rerun `npm run cf-typegen` and commit the regenerated `cloudflare-env.d.ts`.

Until step 3, the Worker falls back to `DATABASE_URL` (Worker secret via
`npx wrangler secret put DATABASE_URL`, or `.dev.vars` locally) — see
`src/db/client.ts`. Remove the fallback once Hyperdrive is bound (tracked as
a W0-C hardening note: credentials contract).

## 4. Auth secrets (unblocks: production login)
1. `npx wrangler secret put BETTER_AUTH_SECRET` — 32+ char random string
   (`openssl rand -base64 32`).
2. `npx wrangler secret put BETTER_AUTH_URL` — the deployed **app** origin. Now
   `https://app.revealyst.com` (the auth origin after the §6 host split); was
   `https://revealyst.thapi.workers.dev`. Set via the `BETTER_AUTH_URL` repo
   secret, which the Deploy workflow syncs to the Worker.
3. GitHub OAuth (social login): register an OAuth app at
   github.com/settings/developers — callback URL
   `<origin>/api/auth/callback/github` — then `npx wrangler secret put
   GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. ✅ Done via repo secrets
   `GH_OAUTH_CLIENT_ID` / `GH_OAUTH_CLIENT_SECRET`, which the Deploy workflow
   syncs to the Worker's `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
   (`.github/workflows/deploy.yml`). Prod callback (after the §6 host split)
   `https://app.revealyst.com/api/auth/callback/github` — update it in the
   GitHub OAuth App at cutover.
   Email+password works without this; the GitHub button errors until set.
   (This OAuth app is for *login* — separate from the Copilot-metrics
   GitHub App in docs/approvals.md.)
4. **Platform admins (optional; ADR 0016):** `ADMIN_USER_IDS` — comma-separated
   Better Auth user ids (the `user.id` column, visible in Neon or via your
   session) granted platform-admin power without the `user.role` column being
   set. This is the *bootstrap* path: set it as an `ADMIN_USER_IDS` repo secret
   (the Deploy workflow syncs it to the Worker) with the founder's user id;
   day-2 admins are then promoted in-product via the audited set-role endpoint.
   Unset or empty = no platform admins; every `/api/auth/admin/*` endpoint
   403s and the `/admin` section is unreachable — the app behaves exactly as
   before this feature existed.

## 5. Queues (unblocks: production poller; needs Workers Paid)
`npx wrangler queues create revealyst-poll` before the first deploy —
the wrangler.jsonc producer/consumer config references it.

## 6. Custom domains (host split: marketing vs app)
ONE Worker, two custom domains: **`app.revealyst.com`** = app + Better Auth
origin; **`revealyst.com`** = public marketing site + canonical share cards.
The split is enforced in code by a GET/HEAD host redirect in `src/worker.ts`
(logic in `src/lib/domains.ts` — the single source of truth for both origins
and path classification). `/api/*`, assets, `workers.dev`, and the OpenNext
self-reference subrequest pass through untouched.

Roll out in two deploys so the live `workers.dev` URL never breaks.

### Phase A — attach + verify
1. **[founder] Pre-check:** in the `revealyst.com` zone, delete any parked DNS
   record on the apex `revealyst.com` and on `app` — an existing `CNAME`/`A` on
   the exact hostname blocks custom-domain creation.
2. **[founder] Attach both domains in the Cloudflare dashboard** (Workers &
   Pages → `revealyst` → Settings → Domains & Routes → Add → Custom Domain) for
   `revealyst.com` and `app.revealyst.com`. The dashboard auto-creates the DNS
   records + Advanced Certificate. *(Wrangler-driven creation instead needs
   DNS-Edit + SSL-and-Certificates-Edit on the zone added to
   `CLOUDFLARE_API_TOKEN`; the "Edit Cloudflare Workers" template may lack them.)*
   The committed `routes` in `wrangler.jsonc` then keep them attached
   idempotently on deploy. `wrangler versions upload` (CI preview) ignores
   routes, so previews are unaffected.
3. Verify: `curl -I https://revealyst.com` and `curl -I https://app.revealyst.com`
   → `200` + valid TLS.

### Phase B — cut auth over
4. Set the **`BETTER_AUTH_URL` repo secret** → `https://app.revealyst.com` (§4.2).
5. **GitHub OAuth App** callback → `https://app.revealyst.com/api/auth/callback/github`
   (§4.3).
6. **Paddle dashboard** (prod + sandbox): Default Payment Link / approved domains
   and the webhook URL (`/api/webhooks/paddle`) → `app.revealyst.com`.
7. Re-run the **Deploy** workflow (builds the split-enforcing code + syncs the
   new `BETTER_AUTH_URL`). Verify sign-in on `app.revealyst.com`, the marketing
   landing on `revealyst.com`, and a share link that reads
   `https://revealyst.com/s/<token>`.

**Deferred:** `workers.dev` → canonical 301 (kept live for old links/CLIs;
retire later via a Redirect Rule, then optionally `"workers_dev": false`);
`www.revealyst.com` redirect rule; `robots.ts`/`metadataBase` (marketing SEO
work). The agent CLI default API is now `https://app.revealyst.com`
(`packages/revealyst-agent/src/cli.ts`; `--api` override unchanged).

## 7. Amazon SES (unblocks: signup email verification + password reset; account management, ADR 0015)
Account signup now requires a confirmed email (`requireEmailVerification: true`,
`src/lib/auth.ts`) and forgot-password sends a reset link — both go through
`src/lib/email.ts`, which calls Amazon SES v2's `SendEmail` action over a
SigV4-signed HTTPS request (`aws4fetch`; no SMTP on Workers). Without SES
configured, `sendEmail()` silently no-ops — new signups get stuck at "check your
inbox" forever, since sandbox/unconfigured SES never actually sends. The Deploy
workflow already syncs all four env vars below as Worker secrets (see its
"Sync Worker secrets" step); only the AWS + DNS + GitHub-secrets side remains.

1. **[founder] Create the SES domain identity.** AWS Console → SES → us-east-1
   → Verified identities → Create identity → Domain → `revealyst.com` (the
   marketing/apex domain — matches `EMAIL_FROM`'s default,
   `"Revealyst <noreply@revealyst.com>"`, not `app.revealyst.com`). Enable
   **Easy DKIM** (SES-managed keypair — simplest option, no BYODKIM).
2. **[founder] Add the DNS records SES gives you, in Cloudflare DNS** (the
   `revealyst.com` zone — same zone as §6's custom-domain records). SES
   provides 3 CNAME records for DKIM; add each as **DNS only** (grey-clouded,
   not proxied — Cloudflare's orange-cloud proxy breaks DKIM's CNAME chain).
   Optionally add the SES-suggested MAIL FROM / SPF TXT record too for
   deliverability (not required to exit sandbox).
3. **[founder] Wait for verification** (Console shows "Verified" on the
   identity — usually minutes, since DNS is already on Cloudflare's edge).
4. **[founder] Create an IAM user for programmatic sending** (IAM → Users →
   Create user, e.g. `revealyst-ses-sender`, no console access, access-key
   credential type). Attach an inline least-privilege policy — not
   `AmazonSESFullAccess` — scoped to exactly what `email.ts` calls:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "ses:SendEmail",
       "Resource": "*",
       "Condition": {
         "StringEquals": { "ses:FromAddress": "noreply@revealyst.com" }
       }
     }]
   }
   ```
   Save the generated **Access Key ID** and **Secret Access Key** — shown once.
5. **[founder] Request SES production access** (Console → SES → Account
   dashboard → "Request production access"). Sandbox mode only sends to
   SES-verified individual addresses, so with `requireEmailVerification: true`
   live, sandbox means real signups can never verify. Use case: transactional
   password reset + signup email verification for a B2B SaaS app. AWS review
   is typically same-day to ~24h — **start this step first**, everything else
   can happen while it's pending.
6. **[founder] Populate the four repo secrets** (Settings → Secrets and
   variables → Actions → New repository secret — `deploy.yml` already reads
   these):
   - `SES_ACCESS_KEY_ID` — from step 4
   - `SES_SECRET_ACCESS_KEY` — from step 4
   - `SES_REGION` — `us-east-1`
   - `EMAIL_FROM` — `Revealyst <noreply@revealyst.com>`
7. **[founder] Confirm production access was granted** (Console → SES →
   Account dashboard no longer shows "Sandbox").
8. Re-run the **Deploy** workflow — applies the `email_verified` backfill
   migration (so existing users aren't locked out by the new requirement) and
   syncs the four secrets above to the Worker in the same run. Verify: sign up
   with a real address → confirm the verification email arrives → click it →
   land in the app.

If mail doesn't arrive after deploying, check Worker logs (`wrangler tail`) for
`[email] SES not configured` (a secret didn't sync — re-check step 6) or a
thrown `SES send failed: ...` (SES rejected the request — check the identity is
verified and production access is active).
