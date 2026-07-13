import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { listDigestRecipients } from "../db/system";
import {
  budgetAlertEmailSubject,
  renderBudgetAlertEmail,
} from "../lib/budget-alert-email";
import {
  isEmailConfigured,
  sendEmail,
  type EmailEnv,
  type EmailMessage,
} from "../lib/email";
import {
  budgetAlertFor,
  monthKeyForDay,
  readMonthToDateSpend,
} from "../lib/spend-governance";

// Budget-threshold EMAIL alerts (W5-I). Evaluated on spend refresh (after a
// successful connector poll, src/poller/run.ts) — NOT on a request. Mirrors the
// weekly-digest sender's discipline (src/poller/digest.ts):
//  - isEmailConfigured guard BEFORE the crossing-state claim, so a missing-SES
//    window doesn't burn a threshold's one email on a send that no-ops.
//  - compare-and-set the crossed threshold in `budget_alert_state` BEFORE
//    sending (claim-then-send), so an at-least-once poll redelivery that
//    re-crosses the same threshold is a no-op — each threshold emails EXACTLY
//    once per (org, month).
//  - per-recipient try/catch, so one bad admin address doesn't block the rest.
// Audience: the org's verified admins (governance data, like the in-app banner
// that readBudgetAlertForRole gates to admins). Measured on VENDOR-REPORTED
// spend only (invariant b) — the same number the /spend view shows.

export type BudgetAlertDeps = {
  emailEnv: EmailEnv;
  /** App origin for the spend-page CTA link, e.g. https://app.revealyst.com. */
  appOrigin: string;
  now?: () => Date;
  /** Test seam — defaults to the real SES sender. */
  sendEmail?: (env: EmailEnv, msg: EmailMessage) => Promise<void>;
};

export type BudgetAlertRunResult = {
  orgId: string;
  /** The crossed threshold that was claimed+emailed this run, else null. */
  threshold: number | null;
  sent: number;
  /** Why the run produced no send (all safe, non-error outcomes). */
  skipped?:
    | "email-unconfigured"
    | "no-budget-or-not-crossed"
    | "no-recipients"
    | "already-alerted";
};

/**
 * Evaluate the org's budget against vendor-reported month-to-date spend and, if
 * a NEW threshold has been crossed this month, email the org's verified admins
 * exactly once. Safe to call after every successful poll: when no budget is set
 * or nothing new crossed, it is a cheap read and a no-op.
 */
export async function maybeSendBudgetAlert(
  db: Db,
  orgId: string,
  deps: BudgetAlertDeps,
): Promise<BudgetAlertRunResult> {
  const now = deps.now?.() ?? new Date();
  const send = deps.sendEmail ?? sendEmail;

  // SES-config guard BEFORE any claim (mirrors the digest sender): claiming
  // then sending into an unconfigured SES would burn this threshold's single
  // email on a no-op. Only guards the REAL sender; an injected test seam
  // doesn't depend on SES config.
  if (!deps.sendEmail && !isEmailConfigured(deps.emailEnv)) {
    return { orgId, threshold: null, sent: 0, skipped: "email-unconfigured" };
  }

  const scope = forOrg(db, orgId);
  const today = now.toISOString().slice(0, 10);
  const { budget, reportedCents } = await readMonthToDateSpend(scope, today);
  const alert = budgetAlertFor(budget, reportedCents);
  if (!budget || !alert) {
    return { orgId, threshold: null, sent: 0, skipped: "no-budget-or-not-crossed" };
  }

  // Confirm recipients BEFORE claiming: if there are no verified admins to
  // email, don't burn the threshold's claim — so the still-crossed threshold
  // can alert once an admin verifies. (Recipient audience mirrors the digest's
  // admin+verified rule; budget alerts are transactional governance, so they
  // ignore the digest opt-in.)
  const { recipients } = await listDigestRecipients(db, orgId);
  if (recipients.length === 0) {
    return { orgId, threshold: null, sent: 0, skipped: "no-recipients" };
  }

  // Compare-and-set the crossed threshold for this month BEFORE sending. A lost
  // claim (redelivery that re-crossed an already-emailed threshold) → no send.
  const monthKey = monthKeyForDay(today);
  const won = await scope.budgetAlertState.claimThreshold(
    monthKey,
    alert.crossedThreshold,
  );
  if (!won) {
    return { orgId, threshold: null, sent: 0, skipped: "already-alerted" };
  }

  const subject = budgetAlertEmailSubject({
    reportedCents,
    monthlyLimitCents: budget.monthlyLimitCents,
    threshold: alert.crossedThreshold,
    pctUsed: alert.pctUsed,
    overBudget: alert.overBudget,
  });
  const spendUrl = `${deps.appOrigin}/spend?src=budget-alert&mo=${encodeURIComponent(
    monthKey,
  )}`;
  const html = renderBudgetAlertEmail(
    {
      reportedCents,
      monthlyLimitCents: budget.monthlyLimitCents,
      threshold: alert.crossedThreshold,
      pctUsed: alert.pctUsed,
      overBudget: alert.overBudget,
    },
    { spendUrl },
  );

  let sent = 0;
  for (const recipient of recipients) {
    try {
      await send(deps.emailEnv, { to: recipient.email, subject, html });
      sent += 1;
    } catch (error) {
      // One bad address must not block the rest or re-trigger the poll. The
      // threshold is already claimed, so that admin simply misses this alert.
      console.error(`[budget-alert] org ${orgId}: send failed for a recipient`, error);
    }
  }
  console.log(
    `[budget-alert] org ${orgId}: threshold=${alert.crossedThreshold}% month=${monthKey} recipients=${recipients.length} sent=${sent}`,
  );
  return { orgId, threshold: alert.crossedThreshold, sent };
}
