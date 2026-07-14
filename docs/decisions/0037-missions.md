# 0037 — Missions & progression (measured, un-gamified)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** W7-5 (AI Capability Execution Plan, phase P5) — founder
  anti-gamification sign-off received.

## Context

P5 adds **missions**: bounded, finish-lined challenges that bundle a short
ordered sequence of steps toward a capability ("run an AI agent on one task and
keep the result"). This is the behavior-change lever the plan calls for and the
honest evolution of the milestone surface. Spec V4 §8.4 forbids gamification, so
the design is deliberately constrained: completion is a **measured capability
crossing**, never a self-asserted click, and there are **no** XP / streak /
league / points mechanics anywhere. The founder confirmed this shape.

Three new tables touch frozen `schema.ts` + `drizzle/**`, and the opt-in "start"
write needs a frozen `contracts/api.ts` route — so the addition is ADR-gated
(rule 1).

## Decision

Add migration `0032_missions.sql` — two **global reference tables** (seeded, like
capabilities) and one **org-scoped** per-person table.

**`missions`** (global) — `slug` PK, `title`, `summary`, `sort`, `is_active`.
Seeded with 3 starter missions.

**`mission_steps`** (global) — PK `(mission_slug, step_order)`, `capability_slug`
FK → `capabilities.slug`, `target_mastery` (numeric(6,4), the stepping-stone bar,
typically below the "mastered" threshold), `label`. A step is DONE when the
person's mastery of `capability_slug` reaches `target_mastery`.

**`mission_progress`** (org-scoped, self-view) — PK `(org_id, person_id,
mission_slug)`, composite tenant FK `(org_id, person_id) → people(org_id, id)`
ON DELETE CASCADE, `started_at` (set on opt-in), `completed_at` (set by the
reducer on a measured crossing, once), index `(org_id, person_id)`. **No
`streak_count` / `xp` / `league` / `points` column exists** — a schema-shape test
(`tests/missions.test.ts`) fails if one is ever added (Spec V4 §8.4).

**Completion is measured, never self-asserted.** The capability-state reducer
(`recompute-capability-state.ts`) — already running nightly — gains a step: for
each person's started-but-open mission, it completes the mission iff every step's
just-computed mastery meets its target (`isMissionComplete`, a pure helper). It
stamps `completed_at` only when still null, so the celebration fires exactly
once. This reuses the milestone plumbing's "measured crossing, strict, once"
discipline; a user cannot mark a step done.

**Reads/writes** go through a new `forOrg` namespace `missions`
(`src/db/org-scope/missions.ts`): `catalog()` (global reference), `progressForUser`
(self-view — joins `people.auth_user_id`), `progressForOrg` (the reducer's read +
the isolation-sweep surface), `start` (opt-in, idempotent), `markComplete` (the
reducer's stamp).

Add ONE frozen route to `src/contracts/api.ts`: **`missionStart`** —
`POST /api/missions/start`, body `{ missionSlug }`, served via `handleApi`. It is
the person's own opt-in (self-view): the handler resolves the caller's tracked
person from the session (never a request param) and calls `missions.start`. Only
`{ ok }` comes back (write-only). Completion is NOT a route — it's the reducer's
job, so there is no "mark done" endpoint by construction.

**UI:** a `MissionCard` on the personal companion (opt-in): not-started → a
"Start" button; in-progress → plain "N of M steps done" text (no game-style
meter); complete → a grounded celebration in the `MILESTONE_COPY` voice. A copy
test asserts none of the banned gamification words appear.

## Contracts affected

- **`src/db/schema.ts` + `drizzle/**`** — `missions`/`mission_steps` (global,
  seeded) + `mission_progress` (org-scoped). Migration `0032`.
- **`src/contracts/api.ts`** — new route `missionStart` (additive).
- Tenancy: new `missions` namespace on `forOrg` (public API grows by one member).
- Not affected: the frozen score/capability engines, `tracked_user`, credentials,
  `connector-facts.md`.

## Three registrations (all in this PR)

1. **`tests/tenant-isolation.test.ts`** — `SCOPED_READS` gains
   `missions.progressForOrg` with a non-vacuous B-org seed (B's alice starts a
   mission).
2. **This ADR.**
3. **`src/db/account-deletion.ts`** — `mission_progress` added to `PURGE_TABLES`,
   ordered **before `people`**. The global `missions`/`mission_steps` reference
   tables have no `org_id` and correctly stay outside both tripwires.

## Consequences

- A person completes a mission end-to-end **from measured signals**, not a
  self-claim; the finish fires once.
- No gamification mechanic exists at the schema, engine, or copy layer — enforced
  by tests, not just convention.
- Missions are seeded/authored via migration (no admin CRUD UI), like the
  capability catalog.
