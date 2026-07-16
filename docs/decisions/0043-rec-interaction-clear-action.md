# 0043 — Rec-interaction `cleared` action (honest undo)

**Date:** 2026-07-16 · **Status:** Accepted · **Wave:** UI/UX U0 (U0.3 RecommendationCard undo)

## Context

U0.3 (UI/UX Execution Plan §5.9) adds a 10-second undo toast after snoozing or
dismissing a coaching recommendation. Undo must restore the person's ACTUAL
prior state. But `rec_interaction_state.state` is a closed three-value enum
(`snoozed | dismissed | tried`, W5-D/ADR 0028) with upsert-only semantics — the
API had no way to return a rec to "never interacted". The only in-contract
workaround was re-writing `tried`, which fabricates positive feedback the
person never gave (an invariant-(b) violation rendered as a "Marked as tried"
indicator) and biases the COACH-004 fatigue ranking.

## Decision

Add a `cleared` **API action** (not a stored value) to the interaction seam:

- `src/contracts/api.ts` `recInteractionSet.request.state` gains `"cleared"`
  (frozen contract — this ADR). The route stays write-only, self-view-only,
  same ownership check.
- `src/db/org-scope/rec-interactions.ts` gains `clear({personId, recId})` —
  an org-scoped DELETE of the person's row for that rec. Idempotent (clearing
  an absent row is a no-op success). Frozen org-scope public API — this ADR.
- The stored enum stays three-valued; no migration. After `cleared`, the
  person's state is literal absence — exactly as if they had never touched the
  rec. No history is kept (unchanged from ADR 0028).
- The undo toast posts `tried` when the rec was already tried before the
  snooze/dismiss, else `cleared`.

## Consequences

- Undo is exact in both cases; no fabricated `tried` rows, no fatigue-ranking
  bias from undone actions.
- `cleared` is self-view-only like every other action on this route; the
  digest's "a dismissed rec never re-mails" rule is unaffected (a cleared
  dismissal legitimately makes the rec mailable again — that is the undo).
- Affected workstreams: companion UI (RecommendationCard/CoachingCard) only.
  No read surface changes; `statesForUser`/`deriveRecInteractionView` are
  untouched.

## Contracts affected

`src/contracts/api.ts` (recInteractionSet request union), `src/db/org-scope/`
rec-interactions namespace (additive `clear`). No schema/migration change.
