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

## How the fleet works
- **Plan mode before code, every time.** `/kickoff <workstream>` starts in plan mode;
  the founder approves the *plan*, not the diff.
- **Fresh context beats long context.** One workstream per session; new session per
  major task. State lives in the branch, the contracts, and this file — not a conversation.
- Inner loop: plan → feature-dev → build against fixtures → own tests →
  `/commit-push-pr` → `/code-review` → merge on green CI. Small PRs; a workstream is a chain.
- Custom skills: `/kickoff`, `/gate-check`, `/adr`, `/new-connector`. Gate pre-review:
  `/gate-review <wave>` workflow + the `contract-guardian` / `adversarial-reviewer` subagents.
- **Hooks run on every Edit/Write** (`.claude/settings.json`): a tripwire guard (rule 7) and
  a post-edit typecheck. Expect them to block on drift — that's the design, not a glitch.
- Keep this file current: `/revise-claude-md` at session end; `/claude-md-improver` once per wave.
