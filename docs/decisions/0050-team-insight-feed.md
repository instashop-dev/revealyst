# 0050 — Aggregate manager insight feed (`team_insights`)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Team Capability Intelligence roadmap, Phase 2-F (per the gap
  analysis §9 Phase-2 item 5; the manager-facing aggregate layer the founder
  cleared with D-TCI-3/D-TCI-6, `docs/product-signoffs.md`).
- **Implemented:** by the `p2f-insights-brief` build PR — migration **0040**
  (`team_insights` + three pg enums), pure generator
  `src/lib/team-insights.ts` + glossary `src/lib/team-insights-glossary.ts`,
  writer `src/scoring/recompute-team-insights.ts` (poller `score-recompute`
  slot, after the ADR-0046 history rollup), read/lifecycle namespace
  `forOrg().teamInsights`, dashboard card + growth-trend card, and a manager
  team-brief section folded into the existing weekly digest.

## Context

TCI §6.9 asks for a manager insight feed — a short, prioritized list of what
changed and what's worth acting on, with a lifecycle so a manager can dismiss
what they've handled. The team dashboard already computes the raw material
(coverage counts, capability history deltas, connection freshness), but there is
**no persisted feed** — nothing to give an insight a stable identity across
nights, a `viewed`/`dismissed` state, or a cap so the surface stays minimal.

Two hard constraints shape the design:

1. **Claim-surface law (invariant b / W3-N).** A rendered insight sentence is a
   product claim. Storing prose in the database would put a claim outside the
   code modules that the banned-phrasing / honesty tests guard.
2. **Count-only, no per-person leak (the team-view privacy posture).** Per-person
   capability mastery is self-view-only (ADR 0036/0038); a manager insight must
   never attach a weakness (or a name) to an individual. TCI itself flags
   `affectedUserIds` as the self-view crossing — so the feed carries none.

## Decision

Add ONE new org-scoped table, **`team_insights`** — a persisted, **count-only**
feed of at most **3 open** aggregate insights, each with a `new|viewed|dismissed`
lifecycle.

### No stored prose; count-only typed params

A row stores a `category` (one of `capability_gap | plateau | concentration |
low_adoption | data_incomplete | positive_growth`), a `severity` (`info |
opportunity | attention`), a `subject` discriminator (a capability slug, or `""`
for org-wide categories), and a small **`params` jsonb of COUNTS and capability
SLUGS only**. The TypeScript `TeamInsightParams` union admits only numeric and
capability-slug keys — **no person id / name / email is representable**, and a
structural test pins it. Plain-English **titles/bodies are rendered at READ time**
from `src/lib/team-insights-glossary.ts`, never stored.

### Deterministic generator — NO LLM (tripwire)

`deriveTeamInsights` (`src/lib/team-insights.ts`) is a pure function of existing
org aggregates: `mastery.coverageCounts` (gap/concentration bands), the ADR-0046
`team_capability_history` period-over-period mastered deltas (plateau /
positive_growth), `personIdsWithState` vs member count (low_adoption), and
connection freshness (data_incomplete). No prompt content, no ML service — a
hard tripwire. It applies the **`MIN_PEOPLE` floor**: an insight whose evidence
cohort is below the floor is **not generated** (never a suppressed-but-implied
insight). Org-wide categories are additionally gated on total members ≥
MIN_PEOPLE.

### 3-insight cap + documented priority order

The feed shows at most **3 open insights** (minimal-by-default). Candidates are
ranked by a fixed, documented category priority —
`data_incomplete → capability_gap → plateau → low_adoption → concentration →
positive_growth` (trust first: a stale connection undermines every other number;
good news last but still surfaced when slots remain) — then by descending
count-magnitude, then by subject slug (a total order, so ties never depend on
insertion order). The reducer excludes dismissed subjects **before** the cap, so
dismissing one frees a slot for the next-ranked candidate.

### Idempotent nightly regeneration; sticky dismissal

Natural key **`(org_id, team_id, category, subject)`** (NULLS NOT DISTINCT, so
the org-wide feed — `team_id NULL`, the common case — conflicts with itself). The
reducer reads existing rows once, deletes open (`new`/`viewed`) rows whose
condition is no longer chosen, and upserts the current ≤3 candidates in place
(refreshing count-only params only, `setWhere status != 'dismissed'`). A run with
the same aggregates converges to the same open feed (idempotent). A **dismissed**
insight is **sticky** — never resurrected under the same key.

### Org-level rows, optional `team_id`

Like `team_capability_history` (ADR 0046): rows are org-wide by default with an
optional `team_id` (composite tenant FK to `teams`, cascade) so a multi-team org
can carry per-team feeds later **without a schema change**. `org_id` carries no
FK to `orgs`; account deletion purges these rows explicitly, ordered before
`teams`.

### Lifecycle authorization

`markViewed` / `dismiss` are driven from `handleApi`. **An org admin OR a team
manager** (≥1 `team_managers` grant, ADR 0044) may dismiss; a plain member 403s.
A dismissal writes an audit row (count-only metadata: category/subject/severity).

### The weekly manager brief — no second table

TCI §6.11 asks for a weekly manager brief. The obvious `team_brief_state`
week-CAS would be a **second** state table. The existing digest CAS
(`digest_preferences.last_sent_week`) is keyed **per (org, user)** with a single
`last_sent_week` column — it **structurally cannot carry a second lane** keyed by
`(org, week, lane)` without a schema change (a lane column would break the
`(org, user)` uniqueness the toggle/CAS depends on). Per the build plan's
preferred path, the brief is therefore **folded as an aggregate section of the
existing weekly digest**, sent to a recipient set unioned with the team's
**managers** (`listManagerRecipients`, verified-email, deduped). No new state
table; the per-user week-CAS already dedupes a both-roles user to one send. The
brief content is aggregate-only and built from the **same** dashboard sources
(shared `buildCapabilityCoverage`, the ADR-0046 history, this feed) — a
shared-source parity test pins brief == dashboard. Managers inherit the existing
team-lane opt-in default (off) + the same Settings toggle + the same footer
unsubscribe — no new opt-out surface.

## Contracts affected

- **`src/db/schema/**` + `drizzle/**`** — new org-scoped table + 3 enums
  (additive; migration 0040). No existing shape changed.
- **`src/db/org-scope.ts` public API** — a new `teamInsights` namespace
  (feed read + lifecycle writes + the reducer surface).
- **`src/db/system.ts`** — `listManagerRecipients` (counts-only cross-org shape,
  §14 law).
- Poller: the `score-recompute` message gains a parallel insight-generation step
  (no new message kind; re-delivery harmless — idempotent per period).
- Not affected: `tracked_user` semantics, credential shape,
  `connector-facts.md`, the frozen score engine (this reads its outputs).

## The three registrations this table PR carries

1. **`tests/tenant-isolation.test.ts`** — a `SCOPED_READS` entry
   (`teamInsights.list`) with a **non-vacuous** team-scoped B-org seed row.
2. **This ADR** (the frozen-contract change record).
3. **`src/db/account-deletion.ts`** — `team_insights` added to `PURGE_TABLES`,
   ordered before `teams` (org-wide rows have no cascade), so the
   purge-completeness tripwire stays green.

## Consequences

- Managers get a persisted, prioritized, dismissible aggregate feed and a weekly
  brief — with **no per-person data path** at any layer (the row shape makes a
  leak structurally impossible, and a structural test pins the params).
- A second deliberate compute-derived store now exists (like ADR 0046), its
  drift contained by the shared-source parity test and the deterministic
  generator; a dismissed insight never re-opens, keeping the feed quiet.
- The weekly brief ships with **no new state table** — a documented consequence
  of the per-user digest CAS's shape.

## Follow-ups (not in this build)

- Per-team feeds/briefs (multi-team orgs) — the `team_id` column is ready; no
  schema change needed.
- A retention window for dismissed rows (they are count-only and few; no pressure
  today).
- The brief's maturity headline reuses the digest's team score snapshot rather
  than the modeled maturity-level ladder (avoids a heavy `readMaturityView` read
  in the weekly sender); wiring the ladder is a later, honest option.
