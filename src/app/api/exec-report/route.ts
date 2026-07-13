import { handleApi } from "@/lib/api-route";
import { readExecReport } from "@/lib/exec-report";
import { renderExecReportDocument } from "@/lib/exec-report-email";

export const dynamic = "force-dynamic";

// GET /api/exec-report — the on-demand downloadable / printable monthly
// executive one-pager (W6-F). Returns the SAME composed memo the monthly email
// carries (via readExecReport — one shared compose path), wrapped in a
// self-contained, print-friendly HTML document. A user-initiated export, so it
// is allowed on the request path; the automated monthly send is poller-only.
//
// - Admin-only (`adminOnly`): the memo is an admin/board surface, like the
//   weekly digest settings and /spend governance.
// - The free-band paywall APPLIES (no `allowOverFreeBand`): a blocked org gets
//   402, so the memo export is gated exactly like every other data route.
export async function GET() {
  return handleApi(
    async (ctx) => {
      // Anchor at today (UTC). readExecReport reports the month containing
      // yesterday, up to yesterday — on-demand mid-month that's the current
      // month-to-date; identical framing to the monthly email.
      const today = new Date().toISOString().slice(0, 10);
      const report = await readExecReport(ctx.scope, {
        today,
        orgName: ctx.org.name,
      });
      const html = renderExecReportDocument(report, { manageUrl: "/settings" });
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          // A downloadable one-pager: suggest a dated filename to the browser.
          "content-disposition": `inline; filename="revealyst-exec-memo-${report.monthKey}.html"`,
        },
      });
    },
    { adminOnly: true },
  );
}
