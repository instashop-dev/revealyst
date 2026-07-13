import { BUDGET_ALERT_COPY, budgetAlertSubject } from "./budget-alert-copy";

// PURE budget-alert email rendering (W5-I). Same email-safe layout discipline
// as the weekly digest (src/lib/digest-email.ts): inline styles + table layout,
// no external CSS/fonts, neutral greys that survive dark inboxes. All prose
// comes from budget-alert-copy.ts (G7); every number is vendor-reported
// month-to-date spend (invariant b — see the copy module's honesty notes).

const BRAND = "#5b21b6"; // violet-800
const INK = "#1f2937"; // slate-800
const MUTED = "#6b7280"; // slate-500
const HAIRLINE = "#e5e7eb"; // slate-200
const PANEL = "#f9fafb"; // slate-50
const ALERT = "#b91c1c"; // red-700 — the crossed-threshold accent

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The rendered budget-alert. Numbers are vendor-reported cents; `threshold`
 * is the crossed percent-of-budget, `pctUsed` the unrounded observed percent. */
export type BudgetAlertEmailInput = {
  reportedCents: number;
  monthlyLimitCents: number;
  threshold: number;
  pctUsed: number;
  overBudget: boolean;
};

/** Subject line for a rendered alert — exported so the sender and tests share
 * one source (never interpolates the dollar figure; inbox-preview privacy). */
export function budgetAlertEmailSubject(input: BudgetAlertEmailInput): string {
  return budgetAlertSubject(input.threshold, input.overBudget);
}

/**
 * Render the budget alert to a single self-contained HTML document. `spendUrl`
 * is the CTA link into the app's spend page. Never call this without a crossed
 * threshold — the sender only renders after `evaluateBudgetAlert` returns one.
 */
export function renderBudgetAlertEmail(
  input: BudgetAlertEmailInput,
  urls: { spendUrl: string },
): string {
  const reportedText = centsToUsd(input.reportedCents);
  const limitText = centsToUsd(input.monthlyLimitCents);
  const pctText = `${Math.round(input.pctUsed)}%`;
  const heading = BUDGET_ALERT_COPY.heading(input.threshold, input.overBudget);
  const body = BUDGET_ALERT_COPY.body({ reportedText, limitText, pctText });

  const preheader = `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(
    BUDGET_ALERT_COPY.preheader,
  )}</span>`;

  return `<!-- budget alert -->${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px">
      <tr><td style="padding:28px 32px 0">
        <div style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND}">Revealyst</div>
        <h1 style="margin:16px 0 0;font:700 18px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${
          input.overBudget ? ALERT : INK
        }">${esc(heading)}</h1>
        <p style="margin:12px 0 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
          body,
        )}</p>
        <p style="margin:16px 0 0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          BUDGET_ALERT_COPY.basis,
        )}</p>
      </td></tr>
      <tr><td style="padding:24px 32px 4px">
        <a href="${esc(
          urls.spendUrl,
        )}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px 20px;border-radius:8px">${esc(
    BUDGET_ALERT_COPY.cta,
  )}</a>
      </td></tr>
      <tr><td style="padding:24px 32px 28px">
        <hr style="border:none;border-top:1px solid ${HAIRLINE};margin:0 0 16px">
        <p style="margin:0 0 8px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          BUDGET_ALERT_COPY.footer.honesty,
        )}</p>
        <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          BUDGET_ALERT_COPY.footer.why,
        )}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
