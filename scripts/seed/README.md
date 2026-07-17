# Rich demo seed (`npm run dev:seed:demo`)

A comprehensive, internally consistent dataset that exercises every dashboard
panel, metric, filter, insight, and edge case — loaded through the SAME
production seams the app uses (`loadFixture` → `forOrg` repo layer, sibling
factories, `recomputeOrg`), never raw table writes except where no writer
exists (`benchmarks` verified flip; auth users, mirroring
`tests/personal-presets-seed.test.ts`).

The existing `npm run dev:seed` (two small static June-2026 fixtures) is left
untouched. This seed is **generated relative to an anchor day** (yesterday
UTC when run as a script; a fixed day in tests) because most read paths use
windows relative to "today": month-to-date budget alerts, trailing-28d
movement/distribution/concentration, 84d agentic window, 56d model-mix trend,
12 usage-week attribution trend, complete Mon–Sun weeks. A static dataset
goes stale in a week; a generated one is always in-window. Generation is
deterministic: a seeded PRNG (`rng.ts`) + explicit anchor. Same anchor + seed
⇒ byte-identical plan.

## Data narrative

**Org 1 — "Acme Robotics"** (team, `visibilityMode: managed`, active Team
subscription): 3 teams (Platform, Product Eng, Data), 14 people covering
every persona: 2 power users (near-daily, one spanning anthropic+cursor+
claude-code subjects for person-day dedupe), regulars, occasionals, a
new joiner (first activity ~10 days ago), a churned user (silent for the
last 5 weeks → drives declining movement + skeptic segment), and one person
with no exclusive subject (→ unsegmented). Plus: a shared Anthropic console
account linked to 3 people (round-the-clock ≥16h + peakConcurrency ≥2 + ≥3×
median volume ⇒ high confidence), an unresolved CI service key
(key_project), and an org-level account subject carrying billed
`spend_cents`. Five healthy connections (anthropic, openai, cursor, copilot,
claude_code_local) + one `error` + one `paused`. 13 ISO weeks of history:
attribution mix shifts account→person, model mix shifts gpt-5→claude-sonnet-5,
`agent_active` adoption grows week over week. Budget row tuned to ~85% of
month-to-date billed spend (fires the 80% alert). The Data team is engineered
weak (coaching recommendations, different signal groups); Product Eng's
suggestion acceptance collapses in the current month (≥10-pt fluency drop
with a nameable driver); Platform loses its `suggestions_offered` side
entirely in the current month (ratio omission + `newlyUnmeasured` copy).
Extras: custom indexes (one active using `agent_active`, one archived), a
share link, a pending invite, benchmark consent, connector_runs with all five
honesty-gap kinds incl. an exact duplicate pair (dedupe check), audit events.

Post-W5 surfaces (all DERIVED where a real engine exists — the loader replays
the poller's capability-state → capability-history → team-insights chain at
two asOfDays, prev-month end + anchor, so `user_capability_state`,
`team_capability_history`, and `team_insights` come from the real reducers,
never hand-written rows): every persona has an engineering role (mig 0026);
Marco Lynx manages Product Eng (`team_managers`) and Product Eng alone flips
the D-TCI-2 individual-cost toggle (`team_settings`); exec report opted in
with the anchor month pre-claimed; renewal dates on two connections (anchor
+21d and +5d) with both reminder thresholds pre-claimed; budget alerts
claimed through 80; one digest opt-out + one opt-in; brisk-falcon's local
agent also ships **OTel markers** (`claude-code-otel@1`, mig 0034) so
`effective-prompting` + `ship-with-ai` render the **measured** tier while
`agentic-delivery` (1 bound marker) stays directional; missions tri-state —
brisk-falcon's two starts complete via the reducer, sable-wren's
`ship-work-with-ai` is honestly stuck in-progress (OpenAI-only ⇒ no
effective-prompting evidence), everyone else not-started; sable-wren carries
all three rec-interaction states (snoozed/dismissed/tried) + exposure rows
inside the COACH-004 novelty window — NOTE these Acme self-view rows have no
rendered surface until the gated companion-in-team-orgs slice (W6-A/T5.1)
ships; they exist for the tests, the interaction API, and that future
surface. The LIVE coaching-lifecycle demo is Jordan's (below). Sign in as
`amber-lynx@` (manager view) alongside the existing users.

**Org 2 — "Jordan Lee"** (personal): created through the real signup path
(`ensureOrgOfOne` clones person-level presets). Anthropic api_key + Claude
Code agent subjects, exclusive identity links, current + previous month
activity ⇒ person-level scores with a delta; verified benchmark row visible;
consent + share link. His agent ships OTel markers too ⇒ measured-tier rows
activate the Growth-Journey capability-band headline; both missions
completed; carries the LIVE coaching-lifecycle states (a "tried" + a
dismissed rec, an exposure inside the novelty window — the only rendered
coaching card while companion-in-team-orgs stays gated); ALSO a member of
Acme Robotics with the personal org pinned active (`switchActiveOrg`) — the
workspace-switcher demo.

**Org 3 — "Globex Pilot"** (small team, no subscription): over-budget
(≥100% of limit, all three alert thresholds claimed) + estimated-only spend
stretch. Gets a derived capability pass too: with 3 people, EVERY capability
sits under the MIN_PEOPLE naming floor — the team card's honest small-team
empty state (the floored contrast to Acme).

Deliberately NOT seeded: `desktop_pairing_codes` (≤10-min-TTL hashed codes
with no rendered surface after the exchange — a seeded row is expired
garbage; the paired connection itself is already in the graph as
`claude_code_local`).

**Orgs 4–7 — onboarding states** (tiny, no records): `same_day` (usable poll
connection), `overnight` (agent connection, synced), `awaiting_agent` (agent
connection, never synced), `mixed` — the interim guide's four channels.

Global: one `benchmarks` row flipped to `verified` (all migration-seeded rows
are `draft`, so the personal benchmarks card is otherwise a placeholder
forever).

## Layout / ownership

- `plan.ts` — shared SeedPlan types (the contract between generator and loader)
- `rng.ts` — deterministic PRNG helpers
- `personas.ts` + `activity.ts` — pure generators: personas → FixtureGraph +
  extras (`buildDemoSeedPlan(anchorDay)`)
- `load.ts` — loads a SeedPlan through repo-layer/factory seams + recomputes
- `prod-safety.ts` — transform that makes the plan safe for production
- `teardown.ts` — removes the demo footprint (refresh cycle / cleanup)
- `../seed-demo.ts` — CLI entry (`npm run dev:seed:demo`; `SEED_PROD_SAFE=1`
  applies the transform) · `../seed-demo-teardown.ts` —
  `npm run dev:seed:demo:teardown` (`SEED_TEARDOWN_UNPREFIXED=1` for local
  DBs seeded without prod-safe mode — never against prod)
- `../../tests/seed-demo.test.ts` — end-to-end validation on PGlite: seeds
  with a fixed anchor and asserts every dashboard panel/insight/API read
  renders non-degenerate against the checklist above ·
  `../../tests/seed-demo-prod-safe.test.ts` — pins the prod-safety
  invariants + teardown exact-footprint behavior

## Production

Prod seeding runs ONLY through the `Seed demo data (production)` workflow
(`.github/workflows/seed-demo.yml`, manual dispatch, typed confirm
`production`, action `seed`/`teardown`) — the `DATABASE_URL` repo secret is
the sanctioned Neon path, same as deploy.yml's migrations. It always sets
`SEED_PROD_SAFE=1` (`prod-safety.ts`), which differs from the local seed in
five reviewed ways: `[Demo] `-prefixed org names (also the teardown match
key); random unlogged passwords + no platform-admin user (base-plan
passwords are committed to this repo — view prod demo orgs via admin
impersonation instead); subscriptions forced to `past_due` (entitling per
`resolveEntitlement`, but the daily metering dispatcher enumerates only
active/trialing, so fake Paddle ids never generate API traffic); no global
benchmark flip; no share links (public `/s/` pages must never present
fabricated scores as measured usage — invariant b). The demo decays as its
anchor ages (~4 weeks until trailing windows thin out): refresh with
`action=teardown` then `action=seed`. Teardown deletes exactly the demo
footprint — prefixed orgs, the demo users (.example emails), and their
signup side-effect orgs; unprefixed base names ("Acme Robotics") are
matched only behind the local-only opt-in because real orgs can collide
with them (a regression test pins the collision-org-survives behavior).

## Invariants (do not violate)

- Every write goes through `forOrg`/factories; raw inserts only for auth
  users, the benchmarks status flip (documented above), cross-org
  `org_members` rows (same insert `ensureOrgOfOne` uses), BACKDATED
  `mission_progress` opt-ins (the frozen `missions.start` seam can't set
  `started_at`, and a wall-clock start would postdate the reducer's
  asOfDay-derived completion stamp), and BACKDATED `people.created_at`
  (`peopleCreatedOn` — maturity's activation denominator counts people known
  AS OF each window end; a seed-run `created_at` postdates every data
  window, making the level structurally unplaceable).
- Derived state is never fabricated: `user_capability_state`,
  `team_capability_history`, `team_insights`, and every mission COMPLETION
  come exclusively from replaying the real reducers (`derivedRecompute`).
- Every send-state table (`exec_report_state`, `renewal_reminder_state`,
  `budget_alert_state`) is pre-claimed for exactly what the seeded data has
  "already sent", so a live cron against a seeded DB never emails a fixture
  address.
- Never fabricate person-level rows from key/account data — attribution is
  carried per record and mixes across the ladder deliberately.
- Ratio components need BOTH sides seeded except where omission is the
  scenario under test.
- `ai_credits` stays in credits; estimated spend stays on
  `spend_cents_estimated`; Copilot subjects get no `hours` histograms;
  Anthropic/OpenAI hourly signals carry `peakConcurrency: null`.
- No prompt/conversation content anywhere (product tripwire).
