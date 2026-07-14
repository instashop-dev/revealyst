# 0034 — Erratum: migration 0018 ADR citation (0014 → 0015)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** founder (docs cleanup)

## Context
The inline comment in `drizzle/0018_backfill-email-verified.sql` cited **ADR 0014**
as the decision behind required email verification. That is a miscitation: the
email-verification-and-account-deletion decision is **[ADR 0015](0015-account-management-email-verification-and-deletion.md)**,
which explicitly names `0018_backfill-email-verified` as its own migration artifact.
Neither ADR 0014 (`0014-org-scope-batch-read-methods` / `0014-personal-person-level-presets`,
a number collision on an unrelated topic) covers email verification at all. The same
miscitation existed in `src/middleware.ts` and was corrected in the prior docs-cleanup PR;
this erratum closes the remaining instance in the migration file.

`drizzle/**` is a frozen-contract path (CLAUDE.md rule 1), so even a comment-only
correction trips the CI frozen-contract guard and requires an ADR — hence this record.

## Decision
Correct the comment in `drizzle/0018_backfill-email-verified.sql` from "(ADR 0014)"
to "(ADR 0015)". **Comment-only** — the executable SQL is unchanged.

## Contracts affected
None in substance. The change is a comment inside an existing migration; the SQL
statement (`UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false`)
is byte-for-byte unchanged, so no schema or data behavior changes.

Migration-safety note: this is a no-op for already-migrated databases. drizzle-orm's
Postgres migrator (`drizzle-orm@^0.45.2`) selects pending migrations by the
`_journal.json` `when` timestamp — which is untouched — not by SQL content hash, so
0018 will not re-run; and the backfill is idempotent regardless.

## Workstreams to re-sync
None. No workstream built against the comment text; no code path reads it.

## Consequences
Frozen-path guard satisfied by this ADR. The migration file's citation now matches
reality (ADR 0015). No follow-up work.
