# W1-G preview verification — app shell states, roles, invite flow

Live walkthrough of the W1-G surfaces against the zero-credential dev loop
(`npm run dev:db` + `next dev`, Claude Preview driving a real browser),
2026-07-06, branch `w1-g-4-preview-verification` (stacked on PRs #36 → #43
→ #46). Contributes the W1-G slice of the `/gate-check W1` evidence pack
("app shell live behind auth").

## How to reproduce

1. `npm run dev:db` in one terminal (in-memory Postgres, migrations
   auto-applied). **Do not** run it under an HTTP-preview supervisor — its
   readiness probe used to occupy what was a single-connection socket
   (fixed: `maxConnections: 16`, this PR).
2. Copy `.dev.vars.example` → `.dev.vars` with
   `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres`,
   any 32+-char `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`.
3. `npm run dev`, sign up, then (optional, for data-full states) seed the
   team fixture into your org id (from `/api/me`) via a throwaway tsx
   script calling `loadFixture(db, orgId, team-30d.json)`.

## Verified (all observed live in the browser)

### Auth + shell
- Signed-out `/dashboard` → 307 to `/sign-in`; signup → org-of-one
  bootstrap → authenticated dashboard.
- Shell renders sidebar (product mark, org name, workspace nav
  Overview/Teams/People/Connections, user footer with email + role badge,
  sign-out) and header (sidebar toggle + page title). Sidebar toggle
  expands/collapses.
- `GET /api/me` returned exactly the frozen contract shape:
  `{ userId, org: { id, name, kind: "personal", visibilityMode:
  "private" }, role: "admin" }`.

### Empty states (fresh org)
- Overview: Workspace card (org, role badge, "Private — team-level,
  pseudonymized"), Connections card "No connections yet…", Scores empty
  state "No scores yet — … Nothing here is estimated."
- Teams: "No teams yet" + personal-workspace copy; People: "No people
  yet" (identity-resolution copy); Connections: "No connections yet".

### Loading states
- `loading.tsx` table skeletons observed mid-navigation on `/connections`
  (7 skeleton blocks) before the streamed table replaced them.

### Data-full states (team fixture seeded into the org)
- Connections table: "Anthropic Console · **Synced 2h ago**" (active,
  real `lastSuccessAt`), "GitHub Copilot · **Sync error**" with
  `title="401 Unauthorized from vendor API (invalid key)"` (real
  `lastError`). Pending renders "Waiting for first sync" (unit-tested;
  fresh-connection path).
- People: 5 fixture people as pseudonyms; Name column "Hidden in Private
  mode"; header shows the Private-mode badge (§7 default).
- Teams: "Core Engineering · 2" from fixture membership.

### Admin interactions
- New-team dialog: created "Core Engineering" pre-seed (toast + table
  refresh). Manage-members dialog: listed all 5 people by pseudonym only,
  pre-checked current members, exact-replace save 2 → 3 with toast.
- Members page: roster ("Preview Founder (you) · Admin"), invite dialog
  created `dev@preview.test` (Member) and displayed the copy-once link;
  pending list showed it with 14-day expiry + Revoke.

### Invite round-trip (second browser identity)
- Signed out → opened invite link → `/sign-in?next=%2Finvite%2F<token>`.
- Signed up `dev@preview.test` → landed straight back on the invite page:
  "Join Preview Founder — invited as a Member".
- Join → `/dashboard`; `/api/me` now resolves the **inviting** org with
  `role: "member"` (ADR 0004 most-recent-membership rule, observed live).
- Member sees no Administration nav; `/members` as member → redirected to
  `/dashboard`; `POST /api/teams` → **403**; `GET /api/org/invites` →
  **403** (server-side role gates, not just hidden buttons).
- Garbage token → "Invite unavailable — this invite link isn't
  recognized" dead state.

## Fixes that fell out of verification (in this PR)

- `Button render={<Link/>}` needed `nativeButton={false}` (Base UI a11y:
  the rendered element is an `<a>`) — landing page, dashboard, invite page.
- `scripts/dev-db.mjs`: `maxConnections: 16` — the pglite-socket default
  of 1 RESETS the second concurrent connection, which killed any
  overlapping request pair (signup → dashboard) with ECONNRESET.
- `.claude/launch.json` added for Claude Preview (web only — see step 1).

## Known limitations (honest)

- "Waiting for first sync" badge verified by unit test + code path, not
  observed on a live row (fixture connections were set active/error).
- Dev-mode only: production Workers runtime (Hyperdrive) not exercised
  here — CI preview deploys cover the OpenNext build.
