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
import { CAPABILITY_STATE_CONSTANTS } from "../scoring/capability-state";
import { exposureAssignment } from "../lib/experiments";
import { deriveRecInteractionView } from "../lib/rec-interactions";
import { recentlyShownRecIds } from "../lib/recommendation-catalog";
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
    capabilityGraph,
    ownerCapabilityState,
    ownerRecStates,
    ownerExposures,
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
    // W7-3 (now live): the capability graph (prerequisite edges) + the personal
    // owner's mastery — for the same eligibility gates the dashboard applies, so
    // the two surfaces select identical recs. Team lane has no single person, so
    // its recs stay org aggregates (no gating).
    scope.capabilities.graph(),
    lane === "personal"
      ? scope.mastery.forUser(recipients[0].userId)
      : Promise.resolve([]),
    // COACH-004 personal-lane rotation signals — folded into this SAME flat
    // Promise.all (still round-trip depth 1). `statesForUser` supplies the
    // "tried" fatigue set (the existing `dismissedRecIdsForOrg` read only covers
    // dismissals); `exposures.forUser` supplies the exposure-log lookback for
    // novelty. Team lane has no single person, so both stay empty (its recs are
    // org aggregates). Both are self-view (join people.auth_user_id).
    lane === "personal"
      ? scope.recInteractions.statesForUser(recipients[0].userId)
      : Promise.resolve([]),
    lane === "personal"
      ? scope.exposures.forUser(recipients[0].userId)
      : Promise.resolve([]),
  ]);

  // W7-3 personal-lane eligibility context (mirrors the dashboard, incl. the
  // forming-user safeguard: apply the fails-closed prerequisite gate only once
  // the owner has established ≥1 capability).
  const digestMastered = new Set(
    ownerCapabilityState
      .filter((s) => s.mastery >= CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD)
      .map((s) => s.capabilitySlug),
  );
  const digestPrereqs = new Map<string, string[]>();
  for (const dep of capabilityGraph.dependencies) {
    const list = digestPrereqs.get(dep.capabilitySlug);
    if (list) list.push(dep.requiresSlug);
    else digestPrereqs.set(dep.capabilitySlug, [dep.requiresSlug]);
  }
  const digestConnectedTools = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.vendor),
  );
  // COACH-004 rotation signals (personal lane; empty on team). `triedRecIds` is
  // the fatigue set; `recentlyShown` is the exposure-log novelty set — the SAME
  // pure derivations the dashboard uses. The novelty window excludes TODAY, so
  // a dashboard render on the send day (the email CTA click-through) ranks
  // identically to this email; from tomorrow this send's own exposure ages
  // into the window and the dashboard rotates the shown rec down — deliberate
  // novelty drift, the email is a weekly snapshot.
  const { triedRecIds: digestTriedRecIds } = deriveRecInteractionView(
    ownerRecStates,
    now,
  );
  const digestRecentlyShown = recentlyShownRecIds(ownerExposures, now);

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
    // W7-3 (now live): personal lane only. Role/tool always; the prerequisite
    // gate only once the owner has established ≥1 capability (forming-user
    // safeguard) — identical to the dashboard, so the two surfaces agree.
    ...(lane === "personal"
      ? {
          connectedTools: digestConnectedTools,
          // COACH-004: fatigue + novelty, personal lane only — same pure
          // derivations and same-day-identical ranking as the dashboard (see
          // the comment above for the deliberate day-after drift).
          fatigueRecIds: digestTriedRecIds,
          recentlyShownRecIds: digestRecentlyShown,
          ...(digestMastered.size > 0
            ? {
                masteredCapabilities: digestMastered,
                capabilityPrereqs: digestPrereqs,
              }
            : {}),
        }
      : {}),
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
      // Explicit, from the canonical origin — never re-derived out of
      // manageUrl (a relative manageUrl caller would silently produce a
      // broken relative link in an email otherwise; the exec-report family
      // already has such a caller).
      dashboardUrl: `${deps.appOrigin}/dashboard`,
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
  // W7-7: log which coaching recs were SHOWN in this digest (the personal lane
  // only — team digest recs are org aggregates, not one person's). Off the hot
  // path (a background poller); idempotent per day (the exposure dedupe key), so
  // an at-least-once redelivery writes exactly one row per rec. Self-view: these
  // are the owner's own exposures. Only after a real send.
  if (lane === "personal" && sent > 0) {
    const owner = (await scope.people.list()).find(
      (p) => p.authUserId === recipients[0].userId,
    );
    if (owner) {
      const shownRecIds = content.recommendations
        .filter((i) => i.kind === "recommendation" && i.recId)
        .map((i) => i.recId as string);
      const { experimentKey, variant } = exposureAssignment(owner.id);
      await scope.exposures.log(
        shownRecIds.map((recId) => ({
          personId: owner.id,
          recId,
          surface: "digest" as const,
          shownAt: to,
          experimentKey,
          variant,
        })),
      );
    }
  }
  // sent = actually handed to SES; skippedPrefs = opted out or week already
  // claimed (redelivery); failed = claimed but the send threw.
  console.log(
    `[digest] org ${orgId}: lane=${lane} recipients=${recipients.length} sent=${sent} skippedPrefs=${skippedPrefs} failed=${failed}`,
  );
  return { orgId, lane, recipients: recipients.length, suppressed: false, sent };
}
