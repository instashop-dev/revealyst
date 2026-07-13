import {
  RENEWAL_REMINDER_COPY,
  renewalReminderSubject,
} from "./renewal-reminder-copy";

// PURE renewal-reminder email rendering (W6-G). Same email-safe layout
// discipline as the budget alert (src/lib/budget-alert-email.ts): inline styles
// + table layout, no external CSS/fonts, neutral greys that survive dark
// inboxes. All prose comes from renewal-reminder-copy.ts (G7). The date shown is
// USER-ENTERED — the copy module's honesty notes carry the invariant-b framing.

const BRAND = "#5b21b6"; // violet-800
const INK = "#1f2937"; // slate-800
const MUTED = "#6b7280"; // slate-500
const HAIRLINE = "#e5e7eb"; // slate-200
const PANEL = "#f9fafb"; // slate-50

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "2026-08-01" → "August 1, 2026", pinned to UTC so the calendar day the user
 * entered never shifts by a timezone. */
function formatRenewalDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The rendered reminder. `renewalDate` is the user-entered "YYYY-MM-DD";
 * `threshold` is the lead time in days (30 or 7). */
export type RenewalReminderEmailInput = {
  displayName: string;
  renewalDate: string;
  threshold: number;
};

/** Subject line for a rendered reminder — exported so the sender and tests
 * share one source (never interpolates the exact date; inbox-preview privacy). */
export function renewalReminderEmailSubject(
  input: RenewalReminderEmailInput,
): string {
  return renewalReminderSubject(input.displayName, input.threshold);
}

/**
 * Render the renewal reminder to a single self-contained HTML document.
 * `connectionUrl` is the CTA link back to the connections page. Only called
 * after a threshold is due and its CAS claim has been won.
 */
export function renderRenewalReminderEmail(
  input: RenewalReminderEmailInput,
  urls: { connectionUrl: string },
): string {
  const renewalDateText = formatRenewalDate(input.renewalDate);
  const heading = RENEWAL_REMINDER_COPY.heading(
    input.displayName,
    input.threshold,
  );
  const body = RENEWAL_REMINDER_COPY.body({
    displayName: input.displayName,
    renewalDateText,
    threshold: input.threshold,
  });

  const preheader = `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(
    RENEWAL_REMINDER_COPY.preheader,
  )}</span>`;

  return `<!-- renewal reminder -->${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px">
      <tr><td style="padding:28px 32px 0">
        <div style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND}">Revealyst</div>
        <h1 style="margin:16px 0 0;font:700 18px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
          heading,
        )}</h1>
        <p style="margin:12px 0 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
          body,
        )}</p>
        <p style="margin:16px 0 0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          RENEWAL_REMINDER_COPY.basis,
        )}</p>
      </td></tr>
      <tr><td style="padding:24px 32px 4px">
        <a href="${esc(
          urls.connectionUrl,
        )}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px 20px;border-radius:8px">${esc(
    RENEWAL_REMINDER_COPY.cta,
  )}</a>
      </td></tr>
      <tr><td style="padding:24px 32px 28px">
        <hr style="border:none;border-top:1px solid ${HAIRLINE};margin:0 0 16px">
        <p style="margin:0 0 8px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          RENEWAL_REMINDER_COPY.footer.honesty,
        )}</p>
        <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          RENEWAL_REMINDER_COPY.footer.why,
        )}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
