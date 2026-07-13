import { COACHING_RECOMMENDATIONS } from "./coaching-recommendations";

// Pure helpers for recommendation interaction state (W5-D, ADR 0028) — the
// Outcomes-loop forerunner (§8.3). No React, no I/O: the ONE place the
// snooze-expiry + suppression rules live, so the companion card, the digest
// dismiss-filter, and the API route can never disagree about when a rec is
// hidden.

/** The three states a person can put a recommendation in. */
export const REC_INTERACTION_STATES = ["snoozed", "dismissed", "tried"] as const;
export type RecInteractionStateValue = (typeof REC_INTERACTION_STATES)[number];

/** Default snooze length when the caller doesn't specify one. */
export const DEFAULT_SNOOZE_DAYS = 7;

/** Every valid rec_id — the stable ids from the static coaching map. An id
 * outside this set is rejected at the API edge (a rec that can't be coached on
 * can't be interacted with either). */
export const VALID_REC_IDS: ReadonlySet<string> = new Set(
  COACHING_RECOMMENDATIONS.map((rec) => rec.id),
);

/** The stored shape the suppression rule reads (a subset of the row). */
export type RecInteractionView = {
  recId: string;
  state: RecInteractionStateValue;
  snoozeUntil: Date | string | null;
};

function toTime(value: Date | string | null): number | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Is this interaction currently HIDING the recommendation from the person?
 *  - `dismissed` → always hidden (until they clear it — there is no clear in v1).
 *  - `snoozed` → hidden only while `snoozeUntil` is in the future; once it
 *    passes, the rec resurfaces (snooze expiry). A snoozed row with no
 *    `snoozeUntil` (shouldn't happen — `set` always stamps one) is treated as
 *    NOT suppressing, failing open so a malformed row can't silently bury a rec.
 *  - `tried` → never hidden (positive feedback keeps the rec visible with a
 *    "tried" affordance).
 */
export function isRecSuppressed(
  view: Pick<RecInteractionView, "state" | "snoozeUntil">,
  now: Date,
): boolean {
  if (view.state === "dismissed") return true;
  if (view.state === "snoozed") {
    const until = toTime(view.snoozeUntil);
    return until !== null && until > now.getTime();
  }
  return false;
}

/** The `snooze_until` timestamp for a snooze taken `days` from `now`. */
export function snoozeUntilFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Partition a person's interaction rows into the derived view the companion
 * card needs: which rec_ids to HIDE (dismissed + un-expired snoozes) and which
 * are marked `tried` (shown with a "tried" affordance). Pure; `now` injected.
 */
export function deriveRecInteractionView(
  rows: readonly RecInteractionView[],
  now: Date,
): { suppressedRecIds: Set<string>; triedRecIds: Set<string> } {
  const suppressedRecIds = new Set<string>();
  const triedRecIds = new Set<string>();
  for (const row of rows) {
    if (isRecSuppressed(row, now)) {
      suppressedRecIds.add(row.recId);
    } else if (row.state === "tried") {
      triedRecIds.add(row.recId);
    }
  }
  return { suppressedRecIds, triedRecIds };
}
