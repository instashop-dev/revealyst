// Renewal-reminder email copy (W6-G, G7 — prose is a claim surface). ALL prose
// for the T-30/T-7 reminder email lives here so the subject, heading, body, and
// footer share one reviewed source and can't drift across the renderer, tests,
// or a future preview surface.
//
// Honesty discipline (invariant b): the renewal date is USER-ENTERED — no
// vendor reports renewal dates to Revealyst. Every string here says so plainly,
// so the reminder is never mistaken for a verified, vendor-sourced date. The
// copy states only what the user told us and never implies Revealyst confirmed
// the actual contract terms.

/** Generic subject — carries the connection name and the lead time in plain
 * words (never a precise "N days", which the exact-date body makes concrete). */
export function renewalReminderSubject(
  displayName: string,
  threshold: number,
): string {
  return threshold >= 30
    ? `Revealyst: ${displayName} renews in about a month`
    : `Revealyst: ${displayName} renews in about a week`;
}

export const RENEWAL_REMINDER_COPY = {
  /** Hidden preview text — sets the user-entered framing before the body. */
  preheader:
    "A renewal date you entered for a Revealyst connection is coming up.",

  /** Lead heading — the connection and how far out its entered date is. */
  heading: (displayName: string, threshold: number): string =>
    `${displayName} renews in about ${threshold} days`,

  /** One honest sentence: what you entered, and when. `renewalDateText` is the
   * formatted user-entered date; `threshold` the lead time in days. */
  body: (opts: {
    displayName: string;
    renewalDateText: string;
    threshold: number;
  }): string =>
    `The renewal date you entered for ${opts.displayName} is ${opts.renewalDateText} — about ${opts.threshold} days from now. It's a good moment to review the contract or budget before it renews.`,

  /** Grounds the reminder: user-entered, unverifiable by Revealyst. */
  basis:
    "You entered this renewal date yourself. No vendor reports renewal dates to Revealyst, so this reminder reflects only the date you set — Revealyst can't confirm the actual renewal terms.",

  /** CTA back to the connections page where the date is managed. */
  cta: "Review this connection",

  footer: {
    why: "You're receiving this because you added a renewal date to this connection. Edit or remove the date on the connections page to change or stop these reminders.",
    honesty:
      "Revealyst only reminds you of dates you enter yourself. It never infers renewal or contract dates from vendor data.",
  },
} as const;
