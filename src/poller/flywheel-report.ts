import type { Db } from "../db/client";
import {
  listPlatformAdminRecipients,
  readLaunchFunnelRows,
} from "../db/system";
import {
  isEmailConfigured,
  sendEmail,
  type EmailEnv,
  type EmailMessage,
} from "../lib/email";
import {
  FLYWHEEL_REPORT_SUBJECT,
  renderFlywheelReportEmail,
} from "../lib/flywheel-email";
import { deriveLaunchFunnel } from "../lib/launch-funnel";

// §14 flywheel report sender (W5-I): makes the MVP exit-gate funnel MEASURABLE
// on a schedule ("instrumented, not aspirational"), not just via the manual
// scripts/launch-metrics.ts. Runs weekly off the cron (one system message,
// src/worker.ts) — poller-time, zero request-path cost. Reads the cross-org
// funnel rows (system.ts), derives the funnel (pure), and emails the platform
// admins the aggregate report. Aggregates only — no org/person identity leaves
// this path. The at-least-once queue can redeliver: a redelivered weekly report
// simply re-sends the same aggregate email (low-harm, no state mutation), so no
// crossing-state table is needed here.

export type FlywheelReportDeps = {
  emailEnv: EmailEnv;
  /** Platform-admin ids from ADMIN_USER_IDS (src/lib/admin-access.ts). */
  adminUserIds: string[];
  now?: () => Date;
  /** Test seam — defaults to the real SES sender. */
  sendEmail?: (env: EmailEnv, msg: EmailMessage) => Promise<void>;
};

export type FlywheelReportResult = {
  recipients: number;
  sent: number;
  skipped?: "email-unconfigured" | "no-recipients";
};

export async function runFlywheelReport(
  db: Db,
  deps: FlywheelReportDeps,
): Promise<FlywheelReportResult> {
  const now = deps.now?.() ?? new Date();
  const send = deps.sendEmail ?? sendEmail;

  // SES-config guard (only the real sender depends on SES; a test seam doesn't).
  if (!deps.sendEmail && !isEmailConfigured(deps.emailEnv)) {
    console.warn("[flywheel] SES not configured — skipped");
    return { recipients: 0, sent: 0, skipped: "email-unconfigured" };
  }

  const recipients = await listPlatformAdminRecipients(db, deps.adminUserIds);
  if (recipients.length === 0) {
    console.warn("[flywheel] no verified platform-admin recipients — skipped");
    return { recipients: 0, sent: 0, skipped: "no-recipients" };
  }

  const funnel = deriveLaunchFunnel(await readLaunchFunnelRows(db));
  const asOf = now.toISOString().slice(0, 10);
  const html = renderFlywheelReportEmail(funnel, asOf);

  let sent = 0;
  for (const to of recipients) {
    try {
      await send(deps.emailEnv, { to, subject: FLYWHEEL_REPORT_SUBJECT, html });
      sent += 1;
    } catch (error) {
      console.error("[flywheel] send failed for a recipient", error);
    }
  }
  console.log(`[flywheel] recipients=${recipients.length} sent=${sent}`);
  return { recipients: recipients.length, sent };
}
