# Infrastructure setup — founder actions (W0-B)

The walking skeleton's code paths are complete and tested against in-memory
Postgres (PGlite); connecting real infrastructure requires accounts and
credentials only the founder holds. Each item below unblocks the noted piece.

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

## 3. Hyperdrive (unblocks: pooled DB access from the Worker; do after 1+2)
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
2. `npx wrangler secret put BETTER_AUTH_URL` — the deployed origin
   (e.g. `https://revealyst.<account>.workers.dev`, later the real domain).
3. GitHub OAuth (social login): register an OAuth app at
   github.com/settings/developers — callback URL
   `<origin>/api/auth/callback/github` — then
   `npx wrangler secret put GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
   Email+password works without this; the GitHub button errors until set.
   (This OAuth app is for *login* — separate from the Copilot-metrics
   GitHub App in docs/approvals.md.)

## 5. Queues (unblocks: production poller; needs Workers Paid)
`npx wrangler queues create revealyst-poll` before the first deploy —
the wrangler.jsonc producer/consumer config references it.
