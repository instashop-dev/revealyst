// Pure renewal-reminder window logic (W6-G). No DB, no I/O — the poller and its
// unit tests share this one source. Reminders fire at EXACTLY two lead times
// before a user-entered renewal date; a date 30 or 7 days out fires, 29/8/31
// does not (strict per-threshold equality, so a daily scan hits each threshold
// on exactly one calendar day and the CAS de-dups redeliveries).

/** Lead times (whole days before renewal) a reminder fires at, high to low. */
export const RENEWAL_REMINDER_THRESHOLDS = [30, 7] as const;
export type RenewalThreshold = (typeof RENEWAL_REMINDER_THRESHOLDS)[number];

/**
 * Whole UTC calendar days from `today` to `renewalDate` (both "YYYY-MM-DD").
 * Positive when the renewal is in the future, 0 on the day, negative once past.
 * Both are midnight-UTC instants, so DST never shifts the day count.
 */
export function daysUntilRenewal(today: string, renewalDate: string): number {
  const t = Date.parse(`${today}T00:00:00Z`);
  const r = Date.parse(`${renewalDate}T00:00:00Z`);
  return Math.round((r - t) / 86_400_000);
}

/**
 * The reminder threshold to fire for `renewalDate` when scanning on `today`, or
 * null if the date is not exactly one of the lead times out. Strict equality:
 * 30 → 30, 7 → 7, everything else (29, 8, 31, past dates) → null.
 */
export function dueRenewalThreshold(
  today: string,
  renewalDate: string,
): RenewalThreshold | null {
  const days = daysUntilRenewal(today, renewalDate);
  return (RENEWAL_REMINDER_THRESHOLDS as readonly number[]).includes(days)
    ? (days as RenewalThreshold)
    : null;
}
