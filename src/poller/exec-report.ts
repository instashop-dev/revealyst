import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { listDigestRecipients, readOrgName } from "../db/system";
import {
  execReportEmailSubject,
  renderExecReportEmail,
} from "../lib/exec-report-email";
import { readExecReport } from "../lib/exec-report";
import {
  isEmailConfigured,
  sendEmail,
  type EmailEnv,
  type EmailMessage,
} from "../lib/email";
import { addUtcDays } from "../lib/raw-metric-delta";

// Monthly executive-memo send orchestrator (W6-F). One queue message = one org,
// fanned out through the existing poll queue (no new queue) on a MONTHLY cron.
// Poller-time only — ZERO request-path cost. Reads via forOrg in a flat
// Promise.all (G10), composes the honest board memo (src/lib/exec-report.ts —
// pure, template, zero LLM), and emails it to every opted-in admin with a
// verified address.
//
// Idempotent under the at-least-once queue, ORG-LEVEL (unlike the per-user
// weekly digest): `execReportState.claimMonth` compare-and-sets the calendar
// month for the whole org BEFORE the send, so a redelivery for the same month
// is a no-op and a mid-send crash under-delivers (safe) rather than re-mailing.
// The claim is gated on the workspace opt-in in the SAME CAS, so a disabled org
// never claims and never sends. Guard-before-claim: an SES-unconfigured run
// bails before ANY claim so the month can still send once secrets are present.
//
// Anchoring: the cron fires on the 1st of each month, so the memo reports the
// month that JUST ENDED. `today` is the fire day (e.g. 2026-08-01); the reported
// month is the day before it (2026-07-31 → month "2026-07"). Maturity/movement
// windows end at `today − 1` (their standard "today excluded" convention =
// the last day of the reported month); the spend view is anchored at that last
// day so its month-to-date window is the FULL reported month.

export type ExecReportDeps = {
  emailEnv: EmailEnv;
  /** App origin for the Settings "manage memo" link, e.g. https://app.revealyst.com. */
  appOrigin: string;
  now?: () => Date;
  /** Test seam — defaults to the real SES sender. */
  sendEmail?: (env: EmailEnv, msg: EmailMessage) => Promise<void>;
};

export type ExecReportRunResult = {
  orgId: string;
  monthKey: string;
  recipients: number;
  sent: number;
  /** True when the org-level month CAS was lost: the workspace opted out, OR a
   * redelivery for a month already sent. Distinct from a skip. */
  claimLost?: boolean;
  /** Set when the run bailed before ANY claim (SES unconfigured / no
   * recipients) — the month is untouched and can still send later. */
  skipped?: "email-unconfigured" | "no-recipients";
};

export async function runMonthlyExecReport(
  db: Db,
  orgId: string,
  deps: ExecReportDeps,
): Promise<ExecReportRunResult> {
  const now = deps.now?.() ?? new Date();
  const send = deps.sendEmail ?? sendEmail;

  const today = now.toISOString().slice(0, 10);
  // The reported month is the one that ended yesterday (cron fires on the 1st).
  const reportedMonthEnd = addUtcDays(today, -1);
  const monthKey = reportedMonthEnd.slice(0, 7);

  // SES-config guard BEFORE any claim (mirrors the digest): the real sender
  // no-ops when SES is unconfigured, but this sender compare-and-sets the month
  // BEFORE sending — so bail here instead of burning the month on sends that go
  // nowhere. Only guards the REAL sender; an injected test seam is independent.
  if (!deps.sendEmail && !isEmailConfigured(deps.emailEnv)) {
    console.warn(
      `[exec-report] org ${orgId}: SES not configured — skipped WITHOUT claiming ${monthKey} (will send when configured)`,
    );
    return {
      orgId,
      monthKey,
      recipients: 0,
      sent: 0,
      skipped: "email-unconfigured",
    };
  }

  // Audience = admins/owners with a verified email (reused from the digest).
  const { recipients } = await listDigestRecipients(db, orgId);
  if (recipients.length === 0) {
    console.log(`[exec-report] org ${orgId}: no eligible recipients — skipped`);
    return { orgId, monthKey, recipients: 0, sent: 0, skipped: "no-recipients" };
  }

  const scope = forOrg(db, orgId);

  // Compose the memo (reads via forOrg in one flat Promise.all inside
  // readExecReport — round-trip depth 1, G10; the SAME path the on-demand
  // export route uses, so the emailed memo can't drift from the downloadable
  // one-pager). Pure, zero LLM.
  const orgName = await readOrgName(db, orgId);
  const report = await readExecReport(scope, {
    today,
    orgName: orgName ?? "your workspace",
  });

  // Claim the month for the WHOLE org (claim-then-send). A lost claim means the
  // workspace opted out OR this month already sent (redelivery) — no send.
  const claimed = await scope.execReportState.claimMonth(monthKey);
  if (!claimed) {
    console.log(
      `[exec-report] org ${orgId}: month ${monthKey} not claimed (opted out or already sent) — no send`,
    );
    return {
      orgId,
      monthKey,
      recipients: recipients.length,
      sent: 0,
      claimLost: true,
    };
  }

  const manageUrl = `${deps.appOrigin}/settings`;
  const html = renderExecReportEmail(report, { manageUrl });
  const subject = execReportEmailSubject(report);

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      await send(deps.emailEnv, { to: recipient.email, subject, html });
      sent += 1;
    } catch (error) {
      // One bad address must not block the rest or trigger a whole-message
      // retry that re-sends the already-delivered admins. The month is already
      // claimed, so this admin simply misses this month's memo (safe).
      failed += 1;
      console.error(
        `[exec-report] org ${orgId}: send failed for a recipient`,
        error,
      );
    }
  }
  console.log(
    `[exec-report] org ${orgId}: month=${monthKey} recipients=${recipients.length} sent=${sent} failed=${failed}`,
  );
  return { orgId, monthKey, recipients: recipients.length, sent };
}
