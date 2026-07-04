---
name: adr
description: Scaffold an Architecture Decision Record for a post-freeze contract change. Use when the founder types /adr <title>, or whenever a frozen contract must change (rule 1) — a change is blocked in review until an ADR is linked. Records context, decision, contracts affected, and which workstreams to re-sync.
---

# /adr <title>

Creates `docs/decisions/NNNN-<slug>.md` for a decision — most importantly a **post-freeze
change to a frozen contract**, which rule 1 blocks until an ADR exists and the affected
workstreams are re-synced. The title is the argument.

## Steps

1. **Pick the number.** Read `docs/decisions/` and use the next zero-padded 4-digit number
   after the highest existing record (template `0000` doesn't count). Slugify the title.

2. **Scaffold** `docs/decisions/NNNN-<slug>.md` from `docs/decisions/0000-template.md`,
   filling: **Context** (what forced this), **Decision**, **Contracts affected** (which
   frozen artifacts from `CLAUDE.md`), **Workstreams to re-sync**, **Consequences**. Status
   starts `Proposed`.

3. **If a frozen contract changes**, remind the founder of the follow-through (do not do it
   silently):
   - Merge the ADR before the contract change lands.
   - Update the frozen-contracts section of `CLAUDE.md` if paths/shapes moved.
   - Post a **re-sync note** into each affected workstream session before it continues
     (rule 1). On a multi-machine team this becomes a durable artifact — a PR comment or
     issue tagging the workstream owners (Workflow §7).

Keep it short: an ADR is a decision record, not a design doc.
