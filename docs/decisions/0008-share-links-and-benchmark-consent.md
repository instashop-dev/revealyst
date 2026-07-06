# 0008 — `share_links` + `benchmark_consent` tables (additive)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** Founder (W2-H PR5 — approved "draft ADR, then build")

## Context
W2-H's charter (execution plan, Wave 2 §W2-H) includes two persisted surfaces
that did not exist at the W0-C freeze:

1. A **shareable score card** ("My AI Fluency: 78") with an **opt-in public
   link** — the §6a.1 content-moat artifact the W3-P launch loop depends on.
2. An **anonymized-benchmark opt-in** with a **stored consent record** (seeds
   the V3 network; "promise nothing").

Both need durable storage. `src/db/schema.ts`, `drizzle/**`, and the
`src/db/org-scope.ts` public API are frozen paths, so even these additive,
charter-mandated tables require an ADR in the same PR (rule 1 / CI
`frozen-contracts` job).

## Decision
Purely **additive** — no existing shape is modified.

### 1. `share_links` (org-scoped, opt-in, revocable)
`migration 0014_share-and-consent.sql`. One row per public score-card link.
- `id`, `org_id` (not null), `person_id` (the person whose card is shared),
  `score_slug` (headline metric, e.g. `fluency`), `public_label` (the name/
  handle shown on the public card — **user-chosen at creation, decoupled from
  the internal pseudonym/displayName so no PII is inferred**), `token_hash`
  (unique SHA-256 of the unguessable capability token — the plaintext token
  lives only in the share URL, never stored, exactly like invites),
  `revoked_at` (null = active), `created_at`, `created_by_user_id`.
- **Composite tenant FK** `(org_id, person_id) → people(org_id, id)` on delete
  cascade, plus the `unique(org_id, id)` anchor every org-scoped table carries.
- **Public resolution is a deliberate capability exception** (same shape as
  invite-token acceptance, ADR 0004): `resolveShareToken(db, token)` is a
  global, unauthenticated read gated by the unguessable token AND
  `revoked_at IS NULL`. It exposes ONLY the featured score value(s) +
  `public_label` for that one person — never email, other people, other orgs,
  or any non-featured data. Creation/list/revoke go through an org-scoped
  factory `shareLinksForOrg(db, orgId)` (mirrors `invitesForOrg`, ADR 0004), so
  `forOrg` in `org-scope.ts` is not widened.

### 2. `benchmark_consent` (org + user scoped)
Same migration. One row per (org, user) recording anonymized-benchmark
contribution consent.
- `id`, `org_id` (not null), `user_id` (not null, → `user.id`), `granted`
  (boolean), `updated_at`, with `unique(org_id, id)` anchor and
  `unique(org_id, user_id)` (one consent row per user per org; set = upsert).
- Simple FK `org_id → orgs(id)`. Read/written via an org-scoped factory
  `benchmarkConsentForOrg(db, orgId)` (get/set), not `forOrg`.

### 3. Tenant-isolation sweep
Both tables carry `org_id`, so `tests/tenant-isolation.test.ts`'s completeness
tripwire requires a `SCOPED_READS` entry for each — added via their factories
(`shareLinksForOrg(db, orgA).list()`, `benchmarkConsentForOrg(db, orgA).get()`),
exactly as invites are.

## Contracts affected
- `src/db/schema.ts` + `drizzle/0014_share-and-consent.sql` — two new tables.
- New modules `src/db/share-links.ts`, `src/db/benchmark-consent.ts` (schema
  zone; org-scoped factories + the one public token resolver).
- `src/db/org-scope.ts`, `src/contracts/**`, `src/lib/credentials.ts`, existing
  fixture shapes: **untouched**.

## Workstreams to re-sync
- **W3-P (launch):** the share card is the viral-loop artifact; the OG-image
  card page + share button land in W2-H PR5b against this shape.
- **W3-N (compliance) / V3 network:** `benchmark_consent` is the consent
  record that later gates anonymized aggregation — noted so it builds against
  this shape rather than inventing another.

## Consequences
- The public `resolveShareToken` read is the second capability-token exception
  after invites (ADR 0004); both are unguessable-token + status-gated reads
  that expose a deliberately minimal projection, documented so the
  tenant-isolation story stays "no AMBIENT cross-org read" rather than "no
  cross-org read ever."
- `public_label` is explicit opt-in text, so a public card never leaks the
  pseudonym or any PII the user didn't choose to publish.
- Revocation is `revoked_at`, not row deletion, so a revoked link 404s while
  retaining an audit trail. Re-sharing mints a new token.
- Richer sharing (team cards, per-metric links, expiry) is a future ADR, not a
  widening of this one.
