import { scoreComponentsSchema } from "../contracts/scores";
import type { Db } from "../db/client";
import { forOrg } from "../db/org-scope";
import { listDigestRecipients } from "../db/system";
import { readScoreTrends } from "../lib/dashboard-trends";
import {
  assembleDigest,
  DIGEST_WINDOW_DAYS,
  isoWeekString,
  type DigestConnection,
  type DigestLane,
} from "../lib/digest-content";
import {
  digestListUnsubscribeHeaders,
  renderDigestEmail,
} from "../lib/digest-email";
import type { ScoreSlug } from "../lib/metrics-glossary";
import { DASHBOARD_SLUGS } from "../lib/dashboard-read";
import {
  isEmailConfigured,
  sendEmail,
  type EmailEnv,
  type EmailMessage,
} from "../lib/email";
import { addUtcDays } from "../lib/raw-metric-delta";
import { computeRecentMovement } from "../lib/recent-movement";
import {
  formatComponentDetail,
  type ComponentDetailRow,
} from "../lib/score-insights";

// Weekly-digest send orchestrator (F2.2). One queue message = one org. Reads
// via forOrg in a SINGLE flat Promise.all (G10), assembles the honest lane-aware
// content (src/lib/digest-content.ts — pure), and sends one email per opted-in
// admin/owner with a verified address. Idempotent under the at-least-once queue:
// `claimWeekAndRotateToken` compare-and-sets the ISO week BEFORE the send, so a
// redelivery for the same week is a no-op and a mid-send crash under-delivers
// (safe) rather than double-sending.

export type DigestDeps = {
  emailEnv: EmailEnv;
  /** App origin for unsubscribe + manage links, e.g. https://app.revealyst.com. */
  appOrigin: string;
  now?: () => Date;
  /** Test seam — defaults to the real SES sender. */
  sendEmail?: (env: EmailEnv, msg: EmailMessage) => Promise<void>;
};

export type DigestRunResult = {
  orgId: string;
  lane: DigestLane;
  recipients: number;
  suppressed: boolean;
  sent: number;
  /** Set when the run bailed before ANY week-claim (e.g. SES unconfigured) —
   * distinct from `suppressed` (a deliberate staleness decision) and from a
   * normal 0-sent run (everyone opted out / already claimed). */
  skipped?: "email-unconfigured";
};

/** Builds the per-preset-slug component rows the gated coaching engine needs,
 * from the org's team-level score rows + definitions. The breakdown a row was
 * computed against comes from the SAME row, so components can never
 * desynchronize from the version they were scored at. */
function buildScoreComponents(
  teamRows: Array<{
    definitionId: string;
    subjectLevel: string;
    periodEnd: string;
    components: unknown;
  }>,
  definitions: Array<{ id: string; slug: string; components: unknown }>,
): { slug: ScoreSlug; components: ComponentDetailRow[] }[] {
  const defById = new Map(definitions.map((d) => [d.id, d]));
  const out: { slug: ScoreSlug; components: ComponentDetailRow[] }[] = [];
  for (const slug of DASHBOARD_SLUGS) {
    const rows = teamRows.filter(
      (r) => defById.get(r.definitionId)?.slug === slug,
    );
    if (rows.length === 0) continue;
    const latest = rows.reduce((best, r) =>
      r.periodEnd > best.periodEnd ? r : best,
    );
    const def = defById.get(latest.definitionId);
    if (!def) continue;
    const parsed = scoreComponentsSchema.safeParse(def.components);
    const defComponents = parsed.success ? parsed.data : [];
    out.push({
      slug,
      components: formatComponentDetail(
        defComponents,
        (latest.components ?? null) as Record<string, unknown> | null,
      ),
    });
  }
  return out;
}

export async function runWeeklyDigest(
  db: Db,
  orgId: string,
  deps: DigestDeps,
): Promise<DigestRunResult> {
  const now = deps.now?.() ?? new Date();
  const send = deps.sendEmail ?? sendEmail;

  // SES-config guard BEFORE any claim. `sendEmail` no-ops (warn) when SES is
  // unconfigured, but this sender compare-and-sets last_sent_week BEFORE
  // sending — so a Monday with missing secrets would burn every org's week on
  // sends that silently went nowhere, logged as success. Bail here instead
  // (nothing claimed → the week can still send once secrets are back). In
  // local dev this same skip is the intended no-op — the log line is the dev
  // signal, matching sendEmail's own warn path. Only guards the REAL sender;
  // an injected test seam doesn't depend on SES config.
  if (!deps.sendEmail && !isEmailConfigured(deps.emailEnv)) {
    console.warn(
      `[digest] org ${orgId}: SES not configured — skipped WITHOUT claiming the week (will send when configured)`,
    );
    return {
      orgId,
      lane: "personal",
      recipients: 0,
      suppressed: false,
      sent: 0,
      skipped: "email-unconfigured",
    };
  }

  const { recipients, memberCount } = await listDigestRecipients(db, orgId);
  const lane: DigestLane = memberCount > 1 ? "team" : "personal";
  if (recipients.length === 0) {
    console.log(`[digest] org ${orgId}: no eligible recipients — skipped`);
    return { orgId, lane, recipients: 0, suppressed: false, sent: 0 };
  }

  const scope = forOrg(db, orgId);
  const to = now.toISOString().slice(0, 10);
  const from = addUtcDays(to, -DIGEST_WINDOW_DAYS);

  // EVERY read the digest needs, in ONE Promise.all — round-trip depth 1 (G10).
  // W5-D: dismissed rec ids join the batch so a dismissed rec never re-mails.
  // Only the personal lane (org of one) applies them — a team digest's
  // recommendations are org aggregates, not one person's, so we don't read
  // anyone's per-person dismissals there.
  const [
    rawScores,
    definitions,
    connections,
    spendRecords,
    activeDayRecords,
    identities,
    dismissedRecIds,
    recommendations,
  ] = await Promise.all([
    scope.scores.results({ from, to }),
    scope.scores.definitions(),
    scope.connections.list(),
    scope.metrics.records({ metricKey: "spend_cents", from, to }),
    scope.metrics.records({ metricKey: "active_day", from, to, dim: "" }),
    scope.identities.all(),
    lane === "personal"
      ? scope.recInteractions.dismissedRecIdsForOrg()
      : Promise.resolve<string[]>([]),
    // W6-C (ADR 0033): the per-org recommendation catalog — ONE read folded
    // into this single Promise.all (§8.2 perf floor), evaluated in memory by
    // `assembleDigest` → `deriveAttention`.
    scope.catalog.list(),
  ]);

  const teamRows = rawScores.filter((r) => r.subjectLevel === "team");
  const trends = await readScoreTrends(
    scope,
    { from, to },
    { rows: teamRows, definitions },
  );
  const movement = computeRecentMovement({
    today: to,
    spendReportedRecords: spendRecords,
    activeDayRecords,
    identities,
  });
  const scoreComponents = buildScoreComponents(teamRows, definitions);
  const digestConnections: DigestConnection[] = connections.map((c) => ({
    vendor: c.vendor,
    status: c.status,
    lastSuccessAt: c.lastSuccessAt,
  }));

  const content = assembleDigest({
    lane,
    now,
    connections: digestConnections,
    movement,
    trends,
    scoreComponents,
    recommendations,
    dismissedRecIds: new Set(dismissedRecIds),
  });

  // G5 staleness gate: no usable connection synced within the window → suppress
  // the whole send (an honest silence beats a misleading stale digest).
  if (content.suppressed) {
    console.log(
      `[digest] org ${orgId}: suppressed (${content.suppressReason ?? "stale"})`,
    );
    return { orgId, lane, recipients: recipients.length, suppressed: true, sent: 0 };
  }

  const week = isoWeekString(now);
  const manageUrl = `${deps.appOrigin}/settings`;
  let sent = 0;
  let skippedPrefs = 0; // disabled / lost the week-CAS (redelivery)
  let failed = 0; // claimed but SES threw
  for (const recipient of recipients) {
    const pref = await scope.digestPreferences.getForUser(recipient.userId);
    // Absent-row LANE default: personal owner on, team admin off.
    const enabled = pref ? pref.digestEnabled : lane === "personal";
    if (!enabled) {
      skippedPrefs += 1;
      continue;
    }
    // A default-on personal owner may have no row yet — create it so the CAS
    // below has a row to claim (and a token to rotate).
    if (!pref) {
      await scope.digestPreferences.setEnabled(recipient.userId, true);
    }
    // Compare-and-set the week + rotate the unsubscribe token BEFORE sending
    // (record-then-send): a lost CAS (redelivery, already-sent, or disabled)
    // returns null and we skip — never a second send.
    const claim = await scope.digestPreferences.claimWeekAndRotateToken(
      recipient.userId,
      week,
    );
    if (!claim) {
      skippedPrefs += 1;
      continue;
    }
    const unsubscribeUrl = `${deps.appOrigin}/api/digest/unsubscribe?token=${encodeURIComponent(
      claim.token,
    )}`;
    // isoWeek tags the app-return CTA with `wk` for digest return-rate
    // instrumentation (W5-I) — href-only, no layout change.
    const html = renderDigestEmail(content, {
      unsubscribeUrl,
      manageUrl,
      isoWeek: week,
    });
    try {
      await send(deps.emailEnv, {
        to: recipient.email,
        subject: content.subject,
        html,
        headers: digestListUnsubscribeHeaders(unsubscribeUrl),
      });
      sent += 1;
    } catch (error) {
      // One bad address must not block the rest or trigger a whole-message
      // retry that re-sends the already-claimed recipients. The week is already
      // claimed, so this recipient simply misses this week's digest (safe).
      failed += 1;
      console.error(`[digest] org ${orgId}: send failed for a recipient`, error);
    }
  }
  // sent = actually handed to SES; skippedPrefs = opted out or week already
  // claimed (redelivery); failed = claimed but the send threw.
  console.log(
    `[digest] org ${orgId}: lane=${lane} recipients=${recipients.length} sent=${sent} skippedPrefs=${skippedPrefs} failed=${failed}`,
  );
  return { orgId, lane, recipients: recipients.length, suppressed: false, sent };
}
