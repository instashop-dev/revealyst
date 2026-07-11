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

**Org 2 — "Jordan Lee"** (personal): created through the real signup path
(`ensureOrgOfOne` clones person-level presets). Anthropic api_key + Claude
Code agent subjects, exclusive identity links, current + previous month
activity ⇒ person-level scores with a delta; verified benchmark row visible;
consent + share link.

**Org 3 — "Globex Pilot"** (small team, no subscription): over-budget
(≥100% of limit) + estimated-only spend stretch.

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
- `../seed-demo.ts` — CLI entry (`npm run dev:seed:demo`)
- `../../tests/seed-demo.test.ts` — end-to-end validation on PGlite: seeds
  with a fixed anchor and asserts every dashboard panel/insight/API read
  renders non-degenerate against the checklist above

## Invariants (do not violate)

- Every write goes through `forOrg`/factories; raw inserts only for auth
  users + the benchmarks status flip (documented above).
- Never fabricate person-level rows from key/account data — attribution is
  carried per record and mixes across the ladder deliberately.
- Ratio components need BOTH sides seeded except where omission is the
  scenario under test.
- `ai_credits` stays in credits; estimated spend stays on
  `spend_cents_estimated`; Copilot subjects get no `hours` histograms;
  Anthropic/OpenAI hourly signals carry `peakConcurrency: null`.
- No prompt/conversation content anywhere (product tripwire).
