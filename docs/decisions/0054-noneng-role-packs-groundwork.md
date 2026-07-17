# 0054 — Non-engineering role-pack groundwork (role→domain link + pending pack definitions)

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** P8-NE (non-engineering role-pack groundwork); founder decision D-TCI-8

## Context

The founder asked whether the resident desktop agent could extract data for
**non-engineering** roles (Product, Marketing, Sales, Customer Success, HR,
Finance, Operations — the TCI §4.2 set). The answer is *yes in principle*: with
**D-DA-5** ratified (2026-07-17 — the on-device extractor may read prompt TEXT
and emit ONLY metadata: bounded enums/counts, never text), the desktop agent is
the plausible honest telemetry source that vendor admin APIs cannot provide.

But that source **does not exist yet**. Every connector today is a developer
tool; all 29 `CANONICAL_METRICS` are coding families; non-engineering capability
telemetry is an already-recorded gate (**OQ-003/OQ-004**). The TCI gap analysis
(§4, conflict **C4**) recorded the seven non-eng packs as *Blocked* on that gate,
with the note "architecture should stay role-agnostic (it already is — the
capability graph is generic)."

This ADR turns that assertion into something **proven and ready** without
fabricating any score. The change touches frozen contracts (`src/db/schema/*` +
`drizzle/**`), so it is ADR-gated (rule 1) even though it is purely additive.

### What the investigation found

1. **The mastery engine is already honesty-safe.** `computeCapabilityStates`
   (`src/scoring/capability-state.ts`) returns **no row** for a capability with
   no bound signal or no evidence — never a floored 0, never a fabricated tier.
   A capability bound to zero signals therefore renders the honest not-measured
   / forming state by construction. (Proven by `tests/capability-noneng-honesty`.)

2. **The one architectural gap is domain scoping.** The graph read
   (`capabilities.graph()` / the reducer) returns **all active capabilities
   across all domains**, and `nextCapability` is computed over the whole graph.
   Seeding a second *active* domain would therefore change an engineering
   person's `nextCapability` frontier and break the engineering byte-identity
   guarantee. Domain-scoping the graph per the person's role is the fix — but it
   is only *needed once packs go live*, so it is **deferred to the desktop-agent
   activation PR** (see §Deferred) rather than half-built now against a frozen,
   heavily-tested engine.

3. **The honest telemetry source is not built.** Seeding seven *active*
   assignable packs now would create role assignments whose Growth surface is a
   permanent empty "forming" state with no path to data — misleading. So the
   packs seed **pending** (`is_active = false`), the "registered, not yet live"
   posture the connector registry already uses for Copilot (`NLV_PENDING_VENDORS`).

## Decision

Migration `0044_noneng-role-packs.sql`, additive only:

**`roles.domain_slug`** (new nullable column, FK → `domains.slug`) — the
role → domain → capabilities link that makes the capability read role-aware. A
simple lazy `.references` thunk (not a composite FK), so it imposes no
schema-barrel ordering even though `domains` is re-exported after `roles`. The
eight engineering roles (0026) backfill to `engineering`.

**Seven non-engineering `domains`** (product, marketing, sales,
customer-success, hr, finance, operations), each seeded `is_active = false`.

**Seven `roles`** (one assignable role per pack), each linked to its domain via
`domain_slug`, seeded `is_active = false`. `role_assignments` accepts them
structurally today — the FK is on `roles.slug`, not on `is_active` — so a person
CAN be tagged with a pending pack via the repository layer (proven by the role
CRUD tests). They are simply off the live picker (`roles.list()` filters
`isActive`) until a founder activates a pack.

**The Marketing proof pack** — seven `capabilities` under the `marketing`
domain, `is_active = false`, bound to **ZERO** `capability_signals` and **ZERO**
`capability_dependencies`. Plain-English, beginner-friendly summaries (a claim
surface — swept for banned phrasing). One pack, not all seven, because the packs
have no data path yet; the pack proves the schema is role-agnostic and gives the
desktop workstream concrete slugs to bind real signals to (the full pack
catalogue lives in `docs/product/noneng-role-packs-spec.md`, Part A).

### The invariant-(b) guarantee

Non-engineering capabilities **never render a computed score**. Two independent
mechanisms enforce it:

- **Engine (the hard guarantee):** an unbound capability produces no state row
  (no evidence → no row). Even in a mixed graph, a bound capability's data never
  spills into an unbound sibling. Pinned by `tests/capability-noneng-honesty`.
- **Gate (defence in depth):** `is_active = false` keeps every pending
  definition out of `list()` / `graph()` / `labels()` / coverage — so the
  engineering surface is **byte-identical** and no non-eng capability reaches any
  live consumer at all yet.

## Seed provenance (W3-N)

Every seeded row is a **product-defined pack definition** — authored by the team
as reference/scaffolding data, NOT invented by an agent from data. The migration
comment and the spec say so explicitly. The pack summaries describe the *work*
(e.g. "Draft marketing copy with AI"), never a measurement we can make.

## Contracts affected

- **`src/db/schema/roles.ts` + `drizzle/**`** — additive `roles.domain_slug`
  column; no existing shape changed. Migration `0044_noneng-role-packs.sql`.
- **Global reference data only** — `domains`, `capabilities`, `roles` carry no
  `org_id`. No new org-scoped table.
- Not affected: `tracked_user` semantics, credential shape, `connector-facts.md`
  (this adds ZERO connectors and ZERO signals), the mastery engine
  (`capability-state.ts` unchanged), the reducer (unchanged), and every live
  capability surface (the `is_active` gate keeps the engineering graph
  byte-identical — pinned by `tests/capability-catalog` graph assertions).

## Three-registration law

`roles`/`domains`/`capabilities` are **global reference data (no `org_id`)**, so
— like `metric_catalog` — both completeness tripwires
(`tests/tenant-isolation.test.ts` SCOPED_READS, `src/db/account-deletion.ts`
PURGE_TABLES) skip them; no registration needed. `role_assignments` (the only
org-scoped table involved) was already registered by ADR 0030 and is unchanged.
**No new org-scoped table is introduced.**

## Deferred (the desktop-agent activation PR, gated)

The following are **identified, not built** — each is only needed *when a pack
goes live*, which requires a genuine telemetry source (D-DA-5 emitter) first:

1. **Domain-scope the graph read.** Load role assignments once, map person →
   role → domain (engineering default), and filter the in-memory graph per
   person before `computeCapabilityStates`, so a non-eng person is evaluated
   against THEIR domain's capabilities (and `nextCapability` doesn't cross
   domains). One extra batched read; query count stays person-independent. Only
   then may a non-eng domain be flipped `is_active = true`. Engineering
   byte-identity holds trivially because a role-less/engineering person maps to
   the engineering domain — exactly today's graph.
2. **Bind the pack signals.** Add `capability_signals` rows binding each non-eng
   capability to the desktop-agent metadata signals the D-DA-5 emitter produces
   (task-category counts, tool-usage, iteration depth, verification behaviours —
   mapped per-capability in the spec). This is the desktop workstream's build
   target and needs its own feature-signal-contract ADR (plan T5.2).
3. **Role-aware forming copy** on the Growth/profile surface (an honest "AI
   maturity for [pack] needs the desktop app" note) — a UI nicety; the existing
   forming empty state is already honest (no fabricated numbers) in the interim.

## Consequences

- The schema is now **provably** role-agnostic: it holds arbitrary domains,
  role→domain links, and capability definitions, and the engine renders honest
  not-measured for any unbound capability (both proven by tests).
- The desktop-agent workstream has a concrete, product-defined target: the spec
  (`docs/product/noneng-role-packs-spec.md`) maps every pack capability to the
  signal(s) that would feed it and the confidence tier it would earn, flagging
  exactly which signals don't exist yet.
- The V4 NOT-list ("no non-engineering role libraries in MVP or V1") is
  overridden for *definitions and scaffolding only* — the founder decision
  D-TCI-8 records the override and the honest-empty-until-desktop-source posture.
