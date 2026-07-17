# 0053 — Manager notes on a managed team member

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Founder decision **D-TCI-7** (`docs/product-signoffs.md`,
  ratified 2026-07-17): "build it", with constraints carried from the TCI
  analysis (TCI-PRIV-004) + the ADR 0045 posture.
- **Implemented:** branch `p6-manager-notes` — migration `0043_manager-notes`
  (`manager_notes` in `src/db/schema/core.ts`), the `forOrg().managerNotes`
  namespace (`src/db/org-scope/manager-notes.ts` — org-scope frozen path, this
  ADR is the required same-PR change), the `loadManagerNotes` loader
  (`src/lib/manager-notes-view.ts`), `POST /api/team/:personId/notes` +
  `DELETE /api/team/:personId/notes/:noteId` (impl in `src/lib/api-impl.ts`),
  and the `ManagerNotesSection` on the `/team/[personId]` drill-in.

## Context

D-TCI-7 ratified private manager notes: a qualitative coaching journal a
manager keeps about a member of a team they manage, rendered in the existing
per-person drill-in (`/team/[personId]`, ADR 0045) below the capability and
spend sections. The signed constraints: org-scoped new table (three
registrations + its own ADR — this one), manager-of-that-team authors/reads
(the same access derivation as the drill-in), notes NEVER feed scoring (pinned
by a test), purge-registered, visible in the drill-in only, plain-English copy.

Notes are free-text a manager typed — human coaching content, not telemetry.
That makes them categorically different from every other org-scoped table: they
are neither a metric input nor derived from one, and the honesty invariants
apply to the fixed UI copy around them, not to the note body itself.

## Decision

Add `manager_notes` (migration 0043): `id`, `org_id`, `person_id`,
`author_user_id`, `body`, optional `follow_up_on` date, `created_at`.
**Append-only**: no `updated_at` column and no edit flow — the two mutations
are create and author-delete, so the surface stays a factual log of
who-observed-what-when rather than a silently mutable record.

### Read visibility: any current manager of the subject's team(s), author-attributed

A note is readable by **ANY current manager of a team the subject person
belongs to** — not only its author. This is the ADR 0045 minimal-surface
scoping applied again: access derives from the person-∈-caller-managed-team
join (`teamManagers.managedTeamIds(callerUserId)` → membership JOIN,
fail-closed, unauthorized indistinguishable from missing), exactly like the
capability and spend halves. Notes are author-ATTRIBUTED (every note renders a
byline naming its author) rather than author-PRIVATE because co-managers of the
same team share the coaching context the drill-in already gives them; hiding
notes per-author would create N private shadows of the same surface while the
byline keeps accountability explicit. WRITE stamps the session user as author
(never a body field); DELETE is **author-only** (`deleteByAuthor` scopes by
`(org, id, author_user_id)` — a co-manager's delete matches no row → 404).

The visibility-mode rule is shared with the whole manager drill-in: in
`private` mode the surface is UNAVAILABLE (absent, not pseudonymized) — the
loader short-circuits via `managerSurfaceAvailable`, and both write routes
re-check it. The SUBJECT person never sees notes about them: there is no
self-view read path at all (the only read is the manager loader), which is the
honest shape for a manager's private working notes — the alternative (subject-
visible notes) is a different product (feedback), not this decision.

### Author cascade: a note dies with its author's account

`author_user_id → user.id ON DELETE CASCADE`. A note is the author's own
observation — an opinion held by a person, not an org record. When the
author's account is deleted there is no honest way to keep the note: orphaning
it ("a former manager wrote…") strips the accountability the byline exists to
provide, and reassigning it fabricates authorship. Cascade is the only shape
where every visible note always has a real, attributable author. (The
composite tenant FK `(org_id, person_id) → people ON DELETE CASCADE` handles
the other direction: the subject's deletion — and the org purge, which deletes
people — tears their notes down.)

### Impersonated writes blocked (403)

A platform admin impersonating a user (ADR 0016) may READ the drill-in — the
established ADR 0045 posture, needed for support. But CREATING or DELETING a
note while impersonating would mint a persistent, author-attributed record in
the user's name that the user never wrote — the same reasoning that blocks
impersonated workspace creation (`/api/workspaces`). Both write routes throw
403 `forbidden while impersonating` before any authorization work.

### No audit rows

`createManagerNote`/`deleteManagerNote` write NO `audit_log` row — a deliberate
contrast with `setTeamManager`/`setTeamSettings`, which do. The audit log
records security-relevant **configuration** changes (who can see what). A note
is coaching **content**: it grants nothing, reveals nothing new (its readers
are exactly the drill-in's existing audience), and it already carries its own
provenance (author + timestamp on the row, rendered as the byline). Auditing
content writes would also copy note metadata into a second table with a
different retention story for no access-control benefit.

### No identity-surface registry entry

`MANAGER_AUTHORIZED_IDENTITY_SURFACES` (`src/lib/visibility.ts`, ADR 0045) is
unchanged. Notes never fold into `TeamVisibleView` or any team aggregate — the
loader returns them only on the drill-in, which already registered the subject
person's name (capability half). The only new name on the surface is the
AUTHOR's, and the author is an auth USER (org member) — not a tracked person —
so the tracked-person pseudonymization machinery does not apply to it; org
members' names are already visible to each other everywhere (members list,
invites, managers UI).

### Never feeds scoring

The table and namespace are structurally isolated from every metric path: no
scoring, `deriveAttention`, or capability-state module imports them, pinned by
`tests/manager-notes-scoring-isolation.test.ts` (a structural import grep, the
missions-isolation pattern). The schema comment states it; the test enforces it.

## Registrations (the org-scoped-table triple)

1. `tests/tenant-isolation.test.ts` `SCOPED_READS` (`managerNotes.listForPerson`)
   with a non-vacuous B-org seed note + a dedicated cross-org test.
2. This ADR.
3. `src/db/account-deletion.ts` `PURGE_TABLES`, ordered BEFORE `people` (the
   composite tenant FK edge `manager_notes → people`); the FK-order anti-vacuity
   floor in `tests/account-deletion.test.ts` bumps accordingly.

## Consequences

- Managers get a durable, private coaching journal per managed person; the
  subject never sees it, the team view never aggregates it, and it can never
  leak into a score or recommendation.
- Append-only means no edit affordance; correcting a note = delete + rewrite.
  Acceptable for v1 (notes are short); an edit flow would need an ADR revising
  the no-`updated_at` decision.
- Co-manager read visibility means a manager's candid note is visible to peers
  who share the team — stated plainly in the section's on-surface copy
  (`MANAGER_NOTES_COPY.description`), so an author is never surprised.
- Notes are free text; they are deliberately NOT swept by the banned-phrasing
  copy tests (user content), only the fixed UI strings are.
