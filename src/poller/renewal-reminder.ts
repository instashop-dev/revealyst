import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { listDigestRecipients } from "../db/system";
import {
  isEmailConfigured,
  sendEmail,
  type EmailEnv,
  type EmailMessage,
} from "../lib/email";
import {
  renderRenewalReminderEmail,
  renewalReminderEmailSubject,
} from "../lib/renewal-reminder-email";
import { dueRenewalThreshold } from "../lib/renewal-reminders";

// Renewal-reminder EMAIL scan (W6-G). Runs on a daily cron (one message per
// org, src/worker.ts) — NOT on a request; zero request-path cost. Mirrors the
// budget-alert sender's discipline (src/poller/budget-alert.ts):
//  - isEmailConfigured guard BEFORE any CAS claim, so a missing-SES window
//    doesn't burn a reminder's one email on a send that no-ops.
//  - compare-and-set (connection, renewal_date, threshold) in
//    renewal_reminder_state BEFORE sending (claim-then-send), so an
//    at-least-once cron redelivery re-sends NOTHING — each (connection, date,
//    threshold) reminder emails EXACTLY once.
//  - per-recipient try/catch, so one bad admin address doesn't block the rest.
// Audience: the org's verified admins (governance-adjacent, like the digest /
// budget alerts). The renewal date is USER-ENTERED (invariant b) — no vendor
// reports it, and the copy says so.

export type RenewalReminderDeps = {
  emailEnv: EmailEnv;
  /** App origin for the connections-page CTA link, e.g. https://app.revealyst.com. */
  appOrigin: string;
  now?: () => Date;
  /** Test seam — defaults to the real SES sender. */
  sendEmail?: (env: EmailEnv, msg: EmailMessage) => Promise<void>;
};

export type RenewalReminderRunResult = {
  orgId: string;
  /** One entry per reminder actually claimed+sent this run. */
  reminders: Array<{ connectionId: string; threshold: number; sent: number }>;
  /** Why the run produced no send (all safe, non-error outcomes). */
  skipped?: "email-unconfigured" | "no-recipients" | "none-due";
};

/**
 * Scan one org's connections for user-entered renewal dates that are exactly 30
 * or 7 days out and, for each newly-due (connection, date, threshold), email the
 * org's verified admins exactly once. Safe to call daily: when nothing is due or
 * everything already fired, it is a cheap read and a no-op.
 */
export async function maybeSendRenewalReminders(
  db: Db,
  orgId: string,
  deps: RenewalReminderDeps,
): Promise<RenewalReminderRunResult> {
  const now = deps.now?.() ?? new Date();
  const send = deps.sendEmail ?? sendEmail;

  // SES-config guard BEFORE any claim (mirrors budget-alert): claiming then
  // sending into an unconfigured SES would burn a reminder's single email on a
  // no-op. Only guards the REAL sender; an injected test seam doesn't depend on
  // SES config.
  if (!deps.sendEmail && !isEmailConfigured(deps.emailEnv)) {
    return { orgId, reminders: [], skipped: "email-unconfigured" };
  }

  const scope = forOrg(db, orgId);
  const today = now.toISOString().slice(0, 10);
  const connections = await scope.connections.list();
  const due = connections.flatMap((c) => {
    if (!c.renewalDate) return [];
    const threshold = dueRenewalThreshold(today, c.renewalDate);
    return threshold === null
      ? []
      : [{ connectionId: c.id, displayName: c.displayName, renewalDate: c.renewalDate, threshold }];
  });
  if (due.length === 0) {
    return { orgId, reminders: [], skipped: "none-due" };
  }

  // Confirm recipients BEFORE claiming: if there are no verified admins to
  // email, don't burn any reminder's claim — so a still-due reminder can fire
  // once an admin verifies. (Audience mirrors the digest's admin+verified rule;
  // renewal reminders are transactional, so they ignore the digest opt-in.)
  const { recipients } = await listDigestRecipients(db, orgId);
  if (recipients.length === 0) {
    return { orgId, reminders: [], skipped: "no-recipients" };
  }

  const reminders: RenewalReminderRunResult["reminders"] = [];
  for (const item of due) {
    // Compare-and-set this exact (connection, date, threshold) BEFORE sending. A
    // lost claim (redelivery, or the threshold already fired for this date) →
    // no send.
    const won = await scope.renewalReminderState.claim(
      item.connectionId,
      item.renewalDate,
      item.threshold,
    );
    if (!won) continue;

    const input = {
      displayName: item.displayName,
      renewalDate: item.renewalDate,
      threshold: item.threshold,
    };
    const subject = renewalReminderEmailSubject(input);
    const connectionUrl = `${deps.appOrigin}/connections?src=renewal-reminder`;
    const html = renderRenewalReminderEmail(input, { connectionUrl });

    let sent = 0;
    for (const recipient of recipients) {
      try {
        await send(deps.emailEnv, { to: recipient.email, subject, html });
        sent += 1;
      } catch (error) {
        // One bad address must not block the rest or re-trigger the scan. The
        // reminder is already claimed, so that admin simply misses it.
        console.error(
          `[renewal-reminder] org ${orgId}: send failed for a recipient`,
          error,
        );
      }
    }
    reminders.push({
      connectionId: item.connectionId,
      threshold: item.threshold,
      sent,
    });
  }
  if (reminders.length > 0) {
    console.log(
      `[renewal-reminder] org ${orgId}: fired ${reminders.length} reminder(s) recipients=${recipients.length}`,
    );
  }
  return { orgId, reminders };
}
