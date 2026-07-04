# Infrastructure setup — founder actions (W0-B)

The walking skeleton's code paths are complete and tested against in-memory
Postgres (PGlite); connecting real infrastructure requires accounts and
credentials only the founder holds. Each item below unblocks the noted piece.

## 1. Cloudflare (unblocks: preview deploys, production deploy)
1. Create/log into the Cloudflare account; note the **Account ID**.
2. Create an API token with the **Edit Cloudflare Workers** template.
3. Add GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
   CI's preview-deploy job activates automatically once these exist.
4. First production deploy: `npm run deploy` locally (or a later CD step).

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
