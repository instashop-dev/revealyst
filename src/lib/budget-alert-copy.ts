// Budget-alert email copy (W5-I, G7 — prose is a claim surface). ALL prose for
// the threshold-crossing alert email lives here so the subject, heading, body,
// and footer share one reviewed source and can't drift across the renderer,
// tests, or a future preview surface.
//
// Honesty discipline (invariant b):
//  - The alert is measured against VENDOR-REPORTED spend only (spend_cents),
//    never estimated/derived spend — the same rule the /spend view and the
//    in-app banner follow (src/lib/spend-governance.ts). The copy says
//    "reported" so the number is never mistaken for a final bill.
//  - Vendor cost reports are day-grain and can restate, so the framing is
//    "so far this month", never a real-time or to-the-cent claim.
//  - No per-person values ever appear — this is an org-level spend total vs an
//    admin-configured budget (governance data, like /billing).

/** Generic subject — carries the crossed threshold (a budget setting, not a
 * private metric) but never the dollar figure (inbox-preview privacy). */
export function budgetAlertSubject(threshold: number, overBudget: boolean): string {
  return overBudget
    ? "Revealyst: your AI spend has reached your monthly budget"
    : `Revealyst: your AI spend passed ${threshold}% of your monthly budget`;
}

export const BUDGET_ALERT_COPY = {
  /** Hidden preview text — value-free framing. */
  preheader:
    "A budget threshold you set has been crossed by reported AI spend this month.",

  /** Lead heading, over-budget vs approaching. */
  heading: (threshold: number, overBudget: boolean): string =>
    overBudget
      ? "You've reached your monthly AI budget"
      : `You've passed ${threshold}% of your monthly AI budget`,

  /** One honest sentence stating what crossed. `pctText` is the rounded
   * percent-of-budget; numbers are formatted by the renderer. */
  body: (opts: {
    reportedText: string;
    limitText: string;
    pctText: string;
  }): string =>
    `Reported AI spend so far this month is ${opts.reportedText} — ${opts.pctText} of your ${opts.limitText} monthly budget.`,

  /** Grounds the number: reported, day-grain, month-to-date. */
  basis:
    "This counts vendor-reported spend only (not estimated usage) and is measured from the first of the month to today. Vendor cost reports are day-grain and can be restated, so treat this as a close guide, not a final bill.",

  /** CTA into the app's spend view. */
  cta: "View your spend breakdown",

  footer: {
    why: "You're receiving this because you set a monthly budget for your Revealyst workspace — adjust or turn off budget alerts anytime on the spend page.",
    honesty:
      "Every number here traces to real, vendor-reported usage. Revealyst never estimates a bill or ranks you against other companies.",
  },
} as const;
