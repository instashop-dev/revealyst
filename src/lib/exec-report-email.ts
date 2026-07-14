import type { ExecReport } from "./exec-report";
import {
  EXEC_REPORT_COPY,
  execReportDayLabel,
  execReportMonthLabel,
} from "./exec-report-copy";

// PURE monthly executive-memo rendering (W6-F). Same email-safe layout
// discipline as the weekly digest / budget alert (inline styles + table layout,
// no external CSS/fonts, neutral greys that survive dark inboxes). ALL prose
// comes from exec-report-copy.ts via composeExecReport (G6/G7) — this module
// only lays the composed ExecReport out as HTML; it derives no numbers and
// invents no prose. The SAME body renders into both the email (a fragment SES
// carries) and the downloadable one-pager (a full HTML document the export
// route serves), so the two can never drift.

const BRAND = "#5b21b6"; // violet-800
const INK = "#1f2937"; // slate-800
const MUTED = "#6b7280"; // slate-500
const HAIRLINE = "#e5e7eb"; // slate-200
const PANEL = "#f9fafb"; // slate-50
const TAG_BG = "#ede9fe"; // violet-100 — the confidence-tier tag

const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Subject line for a composed memo — exported so the sender and tests share
 * one source. Names the month only, never a private number. */
export function execReportEmailSubject(report: ExecReport): string {
  return EXEC_REPORT_COPY.subject(execReportMonthLabel(report.monthKey));
}

function paragraph(text: string, color = INK, size = 15): string {
  return `<p style="margin:12px 0 0;font:400 ${size}px/1.6 ${SANS};color:${color}">${esc(text)}</p>`;
}

function heading(text: string): string {
  return `<h2 style="margin:28px 0 0;font:700 15px/1.4 ${SANS};color:${INK};text-transform:uppercase;letter-spacing:.04em">${esc(text)}</h2>`;
}

/** The "In brief" prose block — composeNarrative's sentences, or an honest
 * empty line when nothing is measurable yet. */
function summaryBlock(report: ExecReport): string {
  if (report.summary.length === 0) {
    return paragraph(
      "There isn't enough measured activity yet to summarize this month — active people, spend, and agentic usage over a few complete weeks fill this in.",
      MUTED,
    );
  }
  return report.summary.map((s) => paragraph(s)).join("");
}

/** The eight board numbers as a table: label + value, with the confidence tier
 * as a small tag and the honesty caveat under each. */
function boardTable(report: ExecReport): string {
  const rows = report.sections
    .map(
      (s) => `
      <tr>
        <td style="padding:14px 0;border-top:1px solid ${HAIRLINE};vertical-align:top">
          <div style="font:600 14px/1.4 ${SANS};color:${INK}">${esc(s.label)}
            <span style="display:inline-block;margin-left:8px;padding:1px 7px;border-radius:10px;background:${TAG_BG};color:${BRAND};font:600 10px/1.6 ${SANS};text-transform:uppercase;letter-spacing:.03em">${esc(s.confidenceLabel)}</span>
          </div>
          <div style="margin-top:3px;font:400 15px/1.5 ${SANS};color:${INK}">${esc(s.value)}</div>
          <div style="margin-top:3px;font:400 12px/1.5 ${SANS};color:${MUTED}">${esc(s.caveat)}</div>
        </td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${rows}</table>`;
}

/** The "what we deliberately don't measure" differentiator content. */
function notMeasuredBlock(report: ExecReport): string {
  return report.notMeasured
    .map(
      (item) => `
      <div style="margin-top:12px">
        <div style="font:600 13px/1.4 ${SANS};color:${INK}">${esc(item.label)}</div>
        <div style="margin-top:2px;font:400 12px/1.6 ${SANS};color:${MUTED}">${esc(item.why)}</div>
      </div>`,
    )
    .join("");
}

/** The composed memo BODY (a fragment) — shared by the email and the
 * downloadable one-pager so they can't drift. `manageUrl` links to the Settings
 * page where an admin can turn the memo off. */
export function renderExecReportBody(
  report: ExecReport,
  urls: { manageUrl: string },
): string {
  const C = EXEC_REPORT_COPY;
  const monthLabel = execReportMonthLabel(report.monthKey);
  const dataAsOfLine =
    report.dataAsOf === null
      ? C.footer.dataNever
      : C.footer.dataAsOf(execReportDayLabel(report.dataAsOf.slice(0, 10)));

  const preheader = `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(
    C.preheader,
  )}</span>`;

  return `<!-- monthly exec memo -->${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px">
      <tr><td style="padding:28px 32px 8px">
        <div style="font:700 20px/1.3 ${SANS};color:${BRAND}">Revealyst</div>
        <h1 style="margin:14px 0 0;font:700 20px/1.35 ${SANS};color:${INK}">${esc(C.title)} — ${esc(monthLabel)}</h1>
        ${paragraph(C.intro(report.orgName, monthLabel))}

        ${heading(C.headings.summary)}
        ${summaryBlock(report)}

        ${heading(C.headings.maturity)}
        ${paragraph(report.maturityLine)}
        ${paragraph(report.trajectoryLine, MUTED, 14)}
        ${paragraph(report.plateauLine, MUTED, 14)}
        ${paragraph(report.spendLine)}
        ${paragraph(report.honestyLine)}
        ${report.capabilityCoverageLine ? paragraph(report.capabilityCoverageLine, MUTED, 14) : ""}

        ${heading(C.headings.board)}
        ${boardTable(report)}

        ${heading(C.headings.notMeasured)}
        ${notMeasuredBlock(report)}
      </td></tr>
      <tr><td style="padding:20px 32px 28px">
        <hr style="border:none;border-top:1px solid ${HAIRLINE};margin:16px 0 16px">
        <p style="margin:0 0 8px;font:400 12px/1.6 ${SANS};color:${MUTED}">${esc(dataAsOfLine)}</p>
        <p style="margin:0 0 8px;font:400 12px/1.6 ${SANS};color:${MUTED}">${esc(C.spend.basis)}</p>
        <p style="margin:0 0 8px;font:400 12px/1.6 ${SANS};color:${MUTED}">${esc(C.footer.honesty)}</p>
        <p style="margin:0;font:400 12px/1.6 ${SANS};color:${MUTED}">${esc(C.footer.manage)} <a href="${esc(urls.manageUrl)}" style="color:${BRAND}">Manage in Settings</a>.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

/** The email body SES carries (identical layout to the printable one-pager). */
export function renderExecReportEmail(
  report: ExecReport,
  urls: { manageUrl: string },
): string {
  return renderExecReportBody(report, urls);
}

/** A self-contained HTML DOCUMENT for the downloadable / printable one-pager
 * the export route serves — the same body wrapped in a minimal document shell
 * (print-friendly: white background, system fonts). */
export function renderExecReportDocument(
  report: ExecReport,
  urls: { manageUrl: string },
): string {
  const title = `${EXEC_REPORT_COPY.title} — ${execReportMonthLabel(report.monthKey)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(report.orgName)}</title>
<style>@media print { body { background: #ffffff; } }</style>
</head>
<body style="margin:0;background:${PANEL}">
${renderExecReportBody(report, urls)}
</body>
</html>`;
}
