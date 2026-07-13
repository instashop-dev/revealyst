import type { LaunchFunnel } from "./launch-funnel";

// PURE §14 flywheel-report email (W5-I). Renders the launch/adoption funnel
// deriveLaunchFunnel produces into a founder-facing weekly email. This is an
// INTERNAL report to platform admins, not a customer surface — but it still
// carries only AGGREGATES (org counts, rates, medians), never a person, org
// id, or per-user value (invariant b). "Instrumented, not aspirational" (§14):
// every figure is a real count from readLaunchFunnelRows, and a rate over an
// empty denominator renders "— (no data yet)", never a fabricated 0.

const BRAND = "#5b21b6";
const INK = "#1f2937";
const MUTED = "#6b7280";
const HAIRLINE = "#e5e7eb";
const PANEL = "#f9fafb";

export const FLYWHEEL_REPORT_SUBJECT = "Revealyst weekly flywheel — adoption funnel";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rate as a whole percent, or the honest empty marker for a null (empty
 * denominator) — mirrors scripts/launch-metrics.ts `fmtRate`. */
export function fmtRate(r: number | null): string {
  return r === null ? "— (no data yet)" : `${Math.round(r * 100)}%`;
}

/** Minutes as min/hours, or an em dash for null — mirrors `fmtMinutes`. */
export function fmtMinutes(m: number | null): string {
  if (m === null) return "—";
  return m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(1)} min`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid ${HAIRLINE};font:400 14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
      label,
    )}</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid ${HAIRLINE};font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
      value,
    )}</td>
  </tr>`;
}

function heading(text: string): string {
  return `<tr><td colspan="2" style="padding:20px 0 4px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:${MUTED}">${esc(
    text,
  )}</td></tr>`;
}

/**
 * Render the flywheel funnel to a self-contained HTML email. `asOf` is a human
 * date string for the report header (the send date). Pure — no I/O.
 */
export function renderFlywheelReportEmail(
  funnel: LaunchFunnel,
  asOf: string,
): string {
  const s = funnel.stages;
  const t = funnel.timeToFirstInsight;
  const sc = funnel.shareCard;
  const pt = funnel.personalToTeam;

  const rows = [
    heading("Funnel"),
    row("Orgs", String(s.orgs)),
    row("Connected a tool", String(s.connected)),
    row("Backfilled", String(s.backfilled)),
    row("Activated (has a score)", String(s.activated)),
    heading("Time to first insight (signup → first successful backfill)"),
    row("Samples", String(t.samples)),
    row("Median", fmtMinutes(t.medianMinutes)),
    row("p90", fmtMinutes(t.p90Minutes)),
    row("Under 10 min", fmtRate(t.under10MinRate)),
    heading("Share-card creation (activated orgs with a share link)"),
    row("With a share link", `${sc.withShareLink} of ${sc.activated}`),
    row("Rate", fmtRate(sc.rate)),
    heading("Personal → Team signals"),
    row("Personal orgs", String(pt.personalOrgs)),
    row("Team orgs", String(pt.teamOrgs)),
    row("Personal w/ invites", String(pt.personalWithInvites)),
    row("Personal w/ accepted invites", String(pt.personalWithAcceptedInvites)),
    row("Personal multi-member", String(pt.personalMultiMember)),
  ].join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px">
      <tr><td style="padding:28px 32px 0">
        <div style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND}">Revealyst</div>
        <h1 style="margin:12px 0 0;font:700 18px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">Weekly flywheel funnel</h1>
        <p style="margin:6px 0 0;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">As of ${esc(
          asOf,
        )} · every figure is a measured count; rates over an empty denominator read "— (no data yet)", never a fabricated 0.</p>
      </td></tr>
      <tr><td style="padding:8px 32px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
