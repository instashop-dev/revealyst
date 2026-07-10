# 0018 — Settings surface: org-scoped visibility-mode + rename write path

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Founder
- **Workstream:** W4-W (trust UX)

## Context

V1 rendered the org **visibility mode** (`orgs.visibility_mode`,
`"private" | "managed" | "full"`, default `"private"`) read-only — there was no
writer anywhere in the codebase, and `forOrg` (the org-scoped repository,
`src/db/org-scope.ts`) exposed no `orgs` writer at all (the only `orgs` write is
the signup bootstrap insert in `ensureOrgOfOne`). The V1.5 Settings page
(Spec V3 §9 / §9.1) makes visibility mode **changeable** — described there as
"the single most privacy-sensitive mutation in the product" — and also hosts an
org **rename**. Both need:

1. A **frozen `api.ts` route contract** — Spec V3 §9.1 explicitly requires the
   route be added via ADR because `src/contracts/api.ts` is a frozen contract.
2. A **`forOrg` writer** for the `orgs` row — raw table access outside the
   org-scoped repository is a review-blocker (tenancy rule), so the first-ever
   `orgs` mutation must live inside `src/db/org-scope.ts`.

Both files are frozen contracts, so this additive change is gated on this ADR.

## Decision

Three additive changes, no change to any existing signature or semantics:

- **`src/contracts/api.ts` — new `settingsUpdate` route contract** (added to the
  frozen `apiRoutes` map):
  - `PATCH /api/settings`
  - request: `{ name?: string(min 1), visibilityMode?: "private" | "managed" | "full" }`,
    `.refine(non-empty)` — an empty patch is a 400 (a no-op "update" would
    fabricate audit-trail entries, mirroring `connectionsUpdate`, ADR 0013).
  - response: `{ org: { id, name, kind, visibilityMode } }` — the same
    `org` shape the frozen `me` route already exposes.
  - No read route is added: the Settings page is a server component that reads
    the current values from `ctx.org` directly (no client round-trip needed for
    initial render), exactly as the dashboard already does.

- **`src/db/org-scope.ts` — new `org.update()` writer** on `forOrg`:
  `scope.org.update({ name?, visibilityMode? })` runs
  `db.update(orgs).set(patch).where(eq(orgs.id, orgId)).returning()`. The
  `orgId` is bound by the `forOrg(db, orgId)` closure — the caller never passes
  it, so a cross-org write is unrepresentable, same as every other method on the
  surface. Additive; no existing method changes.

- **`GET`/`PATCH` semantics** are enforced at the handler with the existing
  `handleApi(fn, { adminOnly: true })` gate (403 for non-admin members) and
  `allowOverFreeBand: true` (see Consequences).

## Contracts affected

- `src/contracts/api.ts` — additive: one new entry in `apiRoutes`
  (`settingsUpdate`). No existing route contract changed. Privacy-by-shape is
  preserved: the response carries only the non-sensitive `org` fields the `me`
  route already exposes.
- `src/db/org-scope.ts` public API — additive: one new `org.update()` method.
  No existing signature or return type changed.
- No schema change — `orgs.visibility_mode` and `orgs.name` already exist
  (`src/db/schema.ts`); a write path needs no migration. `drizzle/**` untouched.

## Workstreams to re-sync

None. The route and writer are pure additions. W1-S contract tests gain a new
route to cover; no existing binding changes.

## Consequences

- **Privacy controls are never paywalled.** `PATCH /api/settings` uses
  `allowOverFreeBand: true`, and `/settings` is added to the app layout's
  `PAYWALL_EXEMPT_PREFIXES`, so an admin over the free band can always reach the
  Settings page and **tighten** privacy (switch back to `private`). This mirrors
  the existing exemptions for `/account` (delete) and the connection-delete route
  (usage-reducing action) — a privacy guardrail is never-cut (CLAUDE.md cut
  order), so it must not sit behind the upgrade wall.
- **Every visibility change is audited.** The handler writes an `audit_log`
  entry per changed field: `org.visibility_set`
  (`metadata: { from, to }`) and/or `org.rename` (`metadata: { from, to }`),
  `targetKind: "org"`, `targetId: ctx.org.id`, `actorUserId: ctx.user.id`.
  The append-only `audit_log` (ADR 0010) is the change trail — the `orgs` row
  stores only the current value.
- **Admin-only, both surfaces.** The page redirects non-admins to `/dashboard`
  and the route returns 403 (`adminOnly`), so a member can neither see nor call
  the mutation — the same double-gate pattern as `/members` (ADR 0004).
- **Team-only concept, not surfaced to personal orgs.** In a personal org (an
  org of one) there are no other people to pseudonymize, so the visibility
  control has no meaning; the Settings page renders the rename card only for
  `kind === "personal"` and never shows the visibility toggle there.
- **Playbook-at-the-toggle (§9.1 / §6.3).** Switching *away* from team-only
  (`private` → `managed`/`full`) surfaces the visibility-readiness playbook —
  the GDPR DPIA / works-council notification / EU AI Act worker-notification
  framing (Spec V2 §7) — in a confirmation step *before* the switch commits.
  Tightening (→ `private`) needs no confirmation.
