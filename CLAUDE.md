# Revealyst — fleet shared brain

Multi-tool AI-adoption analytics for CTOs: "who's using AI, how well, and are we
getting our money's worth." Built by parallel AI-agent workstreams against frozen
contracts. Every session auto-loads this file — it is the interface between agents.

> Ground truth: [Product Spec](docs/Revealyst_Product_Spec_V2.md) ·
> [Execution Plan](docs/Revealyst_Execution_Plan.md) ·
> [Claude Code Workflow](docs/Revealyst_Claude_Code_Workflow.md) ·
> [Harness setup status](docs/Revealyst_Harness_Setup.md)

## Stack facts
- Next.js / TypeScript monolith, deployed to **Cloudflare Workers** via OpenNext.
- **Neon Postgres** via Hyperdrive; **Drizzle** migrations from day one.
- Polling via **Cron Triggers → Queues** (one queue message per connection).
- Single database, `org_id` on every row. **Personal mode = an org of one** —
  identical machinery to Team.
- **Production (live since W0-B):** https://revealyst.thapi.workers.dev — deploy via
  the manual `Deploy` GitHub workflow (migrations → queue → deploy → Worker-secret
  sync from repo secrets); CI uploads a preview version per PR. Founder infra steps
  + local no-credential dev loop (`npm run dev:db`): `docs/infra.md`.
- Windows dev machine: OpenNext builds use webpack, not Turbopack (adapter's chunk
  patching breaks on Win — see `open-next.config.ts`); DB/auth clients are created
  per request, never cached at module scope (Workers cancel cross-request I/O).
- `npm run dev` (plain Next dev) needs `.dev.vars`'s `BETTER_AUTH_URL` set to
  `http://localhost:3000`, not the `wrangler dev` default of `:8787` — mismatch
  fails sign-up/sign-in with "Invalid origin" 403.
- A corrupted `.next/dev/types/validator.ts` (from an interrupted `next dev`) breaks
  `tsc --noEmit` repo-wide with unrelated syntax errors; `.next` isn't in tsconfig's
  exclude — `rm -rf .next` and retype checks clean.
- Manually-created worktrees (`git worktree add`) don't get `node_modules` —
  run `npm install` in each before typecheck/test.
- `git worktree remove` can report "Permission denied" deleting the directory
  (locked by an editor/indexer) yet still succeed at unregistering the
  worktree — `git worktree prune` cleans up the stub; the leftover empty
  folder is harmless.
- **Design system (W1-G):** Tailwind v4 + shadcn/ui `base-nova` — **Base UI**
  primitives, not Radix: custom triggers use `render={...}` (and
  `nativeButton={false}` when rendering an `<a>`/`Link`). Shared components in
  `src/components` (`EmptyState`, `SyncStatusBadge`, `PageHeader`, sidebar shell);
  pages/API get session + `forOrg` scope ONLY via `src/lib/api-context.ts`
  (`appContext`/`requireAppContext`) — never call `createDb` in a page/route.

## Operating model — rules 1–7 (from the execution plan)
1. **Contracts before fan-out.** No W1+ workstream starts until W0-C is frozen.
   Post-freeze changes require an ADR (`/adr`) + re-sync of affected workstreams.
2. **Fixtures over coupling.** Engine/UI build against fixture `metric_records`/
   `score_results`; connectors against recorded vendor payloads. Live data only at gates.
3. **One agent, one workstream, one PR chain.** Independently mergeable, own tests,
   merges gated on CI. Never read another workstream's branch.
4. **Gates are human-reviewed, thin, evidence-based.** Never self-certified by the
   authoring agent; adversarial pre-review first; the founder judges *evidence, not code*.
5. **External approvals are the critical path — fire ASAP.** GitHub App/OAuth → W0
   (no site needed); Paddle MoR → the instant W2 has a live site; legal → when terms drafted.
6. **The seams have an owner (W1-S).** Standing workstream owns contract tests,
   recorded-payload fixtures, the tenant-isolation test, and the cross-workstream E2E.
7. **Scope tripwires** — stop any agent building one (see below).

## Frozen contracts — do not touch without an ADR (tag `contracts-v1`)
Frozen at the W0-C freeze ceremony. Any change requires an ADR in `docs/decisions/`
— **stop and ask before touching them.** CI blocks PRs that change a frozen path
without a `docs/decisions/` change in the same PR.
- **`src/contracts/**`** — typed interfaces: `Connector` (pure `normalize`, honesty
  gaps), `ScoreDefinition`/`ScoreResult` + zod shapes, `CANONICAL_METRICS`,
  attribution ladder + `lowestAttribution`, API-route contracts (`api.ts`), and
  **`tracked_user`** (`tracked-user.ts`): an identity-resolved person with ≥1
  metric_record in the period; unresolved key/account subjects surfaced, **not
  billed**; shared accounts count resolved identities only.
- **`src/db/schema.ts`** + **`drizzle/**`** — schema & migrations, incl. sub-daily
  signals (`subject_day_signals`: 24-slot histogram + peak concurrency per
  subject/day, for W2-K), the `metric_records` natural upsert key, the metric
  catalog as a seeded reference table (mig 0007, not an enum), score presets
  (mig 0009), and the encrypted-credential column shape (`connection_credentials`:
  base64 envelope fields only — no plaintext credential column anywhere).
- **`src/db/org-scope.ts` public API** — the tenancy contract: `forOrg` is the only
  application query surface (ADR `docs/decisions/0001-tenant-isolation.md`;
  enforced by composite tenant FKs, `scripts/check-org-scope.mjs` in CI, and the
  `tests/tenant-isolation.test.ts` sweep incl. its completeness tripwire).
- **`src/lib/credentials.ts` row format** — AES-256-GCM envelope, versioned
  Worker-secret KEK, AAD = `orgId:connectionId:kind`; rotation = DEK rewrap only.
- **`docs/connector-facts.md`** — per-vendor endpoints/auth/granularity/attribution.
- **`fixtures/**` shapes** — downstream builds against these (rule 2); adding
  coverage is fine, changing existing shapes is an ADR.

## Tripwires — never build in V1 (rule 7, verbatim)
No formula DSL · no browser extension/proxy · no prompt-content ingestion in Team mode ·
no second B2C funnel for Personal · no Kafka/ClickHouse · no separate ML service ·
no Chinese-vendor connectors. Cut order under pressure: ChatGPT-export upload →
score-card polish → Cursor connector — **never** privacy defaults or attribution honesty.

## Tenancy rule
Every query goes through the org-scoped repository layer / RLS. **Raw table access
without org scoping is a review-blocker.**

## Review invariants — every `/code-review` inherits these four (§8)
(a) every query org-scoped · (b) never fabricate per-user numbers ·
(c) frozen contracts untouched without an ADR · (d) no tripwire tech.

**Gate-check finding pattern (W2):** 2 of 3 gate blockers were "a new call
site forgot a guard its siblings already had" — `dashboard-view.ts` threaded
`visibilityMode` into `readDashboard`/`resolveSegmentSource` but not the
adjacent `resolveSharedAccountSource().flags()` call; the poller never got
the delete-then-upsert restatement guard that agent-ingest already used. When
adding a call alongside existing ones, diff it against its siblings for the
same guard — and if a new field is added to a type an audit predicate
inspects (e.g. `assertTeamOnlyPseudonymized`), update the predicate too, or
it passes vacuously.

**Scoring engine rule (invariant b, applied per-component):** a ratio component
needs rows on BOTH sides — absence on either side omits the component, never
floors it to a fabricated 0 (conflates "no data yet" with "measured zero").
Plain (non-ratio) metric components floor to 0 on no rows; that's intentional
and tested (`tests/scoring-evaluate.test.ts` "honesty rules").

**Content/legal-workstream rule (invariant b, W3-N):** prose is a claim surface
too — a DPIA/ToS/DPA that states a security control or product behavior the
system doesn't have is an invariant-(b) overclaim, just like a fabricated
number. Fact-check EVERY product claim in written content against the code, not
only the one you're suspicious of: W3-N shipped a "KMS envelope" claim (there is
no KMS — it's a versioned Worker-secret KEK, see `src/lib/credentials.ts`) and a
"read-only vendor scopes" claim (the admin keys are non-scoped full-access per
`docs/connector-facts.md` — Revealyst *uses* them read-only; the scope isn't).
The KMS one slipped into merged PR #75 because that PR's fact-check was scoped
narrowly to the claim under suspicion; a broad "check every sentence" pass in
#76 caught both. Run an adversarial content fact-check (a reviewer that did not
write the prose) over the whole document, grounded in the schema/credential/
connector-facts contracts. W3-P repeats confirmed the pattern (13 findings in
launch copy, incl. the same "read-only" claim independently re-invented) and
added a structural fix: the landing page's "Connects" strip derives from
`src/connectors/registry.ts` — never hard-code connector claims in copy, and
never present-tense an unshipped connector (Copilot is "Soon").

**Timestamp gotcha (analytics/funnels, W3-P):** `score_results.computed_at` is
REWRITTEN by the nightly recompute upsert (`org-scope.ts` `upsertResults`) —
never derive "first score" / activation timing from it (min(computed_at) reads
as days, not minutes, for any org older than a day). `connector_runs` rows are
append-only per attempt — the stable timestamp source; score-row EXISTENCE is
stable for activation booleans.

**Tailwind v4 `.dark`-scoped sections (W1-G design system):** inside a
section-level `dark` class, arbitrary-value CSS must use the raw tokens
(`var(--background)`, `var(--muted-foreground)`) — the `@theme inline`
`--color-*` vars resolve at `:root` (light) and ignore the scoped override
(painted a white vignette over a dark hero; invisible to DOM assertions, found
only by mechanism review). Also: base-nova `Card` draws its outline with
`ring-1`, so `border-*` color classes are silent no-ops on it — use `ring-*`.

- Windows dev machine: `preview_screenshot` can time out persistently while
  `preview_snapshot`/`preview_inspect`/`preview_eval` all work — verify with
  DOM/CSS-level assertions instead of blocking on the screenshot.

## How the fleet works
- **Plan mode before code, every time.** `/kickoff <workstream>` starts in plan mode;
  the founder approves the *plan*, not the diff.
- **Fresh context beats long context.** One workstream per session; new session per
  major task. State lives in the branch, the contracts, and this file — not a conversation.
- Inner loop: plan → feature-dev → build against fixtures → own tests →
  `/code-review` + **apply fixes** → `/commit-push-pr` → merge on green CI. Run
  review and land its fixes BEFORE opening the PR (see merge-race below), so the
  PR's first commit is already the reviewed state. Small PRs; a workstream is a chain.
- Custom skills: `/kickoff`, `/gate-check`, `/adr`, `/new-connector`. Gate pre-review:
  `/gate-review <wave>` workflow + the `contract-guardian` / `adversarial-reviewer` subagents.
- **Hooks run on every Edit/Write** (`.claude/settings.json`): a tripwire guard (rule 7) and
  a post-edit typecheck. Expect them to block on drift — that's the design, not a glitch.
- Keep this file current: `/revise-claude-md` at session end; `/claude-md-improver` once per wave.
- **Before deleting any branch as "merged":** check `git merge-base --is-ancestor
  <branch> main`, not the PR's GitHub state — a branch can receive a later merge
  *after* it was already merged upstream, stranding real work with a "MERGED" PR
  label (cost W1-D 10 tested fixes; recovered in PR #51).
  The ancestor check itself has a false-negative mode: an intermediate branch in
  a stacked-PR chain can show NO even when fully merged, if it got a no-op
  merge-back commit after being forked further. Before treating NO as stranded
  work, run `git log main..branch --oneline` — if the only "unique" commits are
  merges of a *later* PR in the same stack (not real diffs), it's a stale
  pointer, not lost work.
- **Merge-race: the founder merges each PR at its PR-creation-time commit**, so any
  commit pushed *after* `gh pr create` (e.g. review fixes) is silently dropped from
  the merge. Always `/code-review` + apply fixes *before* opening the PR. If fixes
  slipped in after, verify each with `git merge-base --is-ancestor <fixSHA>
  origin/<target>`; recovery for a stacked chain = retarget the still-open tip PR's
  base to the integration branch (its HEAD holds the whole reviewed stack). Cost
  W2-K all 4 PRs (#55/#57/#60), recovered via #63 retargeted to `w2-k`.
  **Stacked-PR variant (W3-P):** GitHub's merge button merges a PR into its
  *base branch* — for a stacked PR that's the parent branch, NOT main. "All
  PRs merged" can therefore leave every non-root PR stranded on stack branches
  (cost W3-P #88/#90; recovered via #91→#92 from the stack tip based on main).
  After any stack merge, verify the TIP commit with `git merge-base
  --is-ancestor <tipSHA> origin/main` before celebrating or deleting branches.
  And if a recovery PR develops conflicts with main, don't push the resolution
  to the open PR (merge-race drops it) — resolve on a fresh branch and
  recreate the PR with the resolution in its creation-time HEAD.
- Flaky, not broken: an occasional `[vitest-pool]: Worker exited unexpectedly`
  (Windows fork crash) and a rare pseudonym-collision in `tests/api-impl.test.ts`
  are known transient flakes — rerun before treating either as a regression.
