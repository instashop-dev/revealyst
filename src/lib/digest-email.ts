import type { DigestContent, DigestScoreLine } from "./digest-content";
import { DIGEST_COPY, digestDate } from "./digest-copy";
import { formatDelta } from "./score-insights";
import { formatRawMetricDelta } from "./raw-metric-delta";
import type {
  MovementMetric,
  MovementMetricKey,
} from "./recent-movement";

// PURE email rendering for the weekly digest (F2.2). A small, self-contained
// HTML layout helper — inline styles + email-safe tables, no external CSS, no
// web fonts, light/dark-agnostic (neutral greys, never pure #fff/#000 that
// invert badly in dark inboxes). This is the FIRST product/bulk email; Better
// Auth's transactional mails don't need a layout, so this lives here rather
// than in the shared `sendEmail` seam. All prose comes from `digest-copy.ts`
// (G7) or the gated attention engine; numbers come from honest deltas.

const BRAND = "#5b21b6"; // violet-800 — readable on light and dark
const INK = "#1f2937"; // slate-800
const MUTED = "#6b7280"; // slate-500
const HAIRLINE = "#e5e7eb"; // slate-200
const PANEL = "#f9fafb"; // slate-50
const POSITIVE = "#15803d"; // green-700 — the celebratory milestone accent
const WARN = "#b45309"; // amber-700 — the "needs attention" accent (readable both modes)

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Digest return-rate instrumentation (W5-I): tag an app-return CTA href with
 * `?src=digest&wk=<isoWeek>` so a click that lands back on the app fires the
 * server-side week-keyed `digest_return` event (src/worker.ts + launch-events.ts)
 * — click-through, the honest signal (an open pixel is defeated by privacy mail
 * clients). PURE string edit only (no layout change): the `wk` value is the ISO
 * week of THIS send, passed by the sender; when absent (a direct
 * renderDigestEmail caller) only `src` is tagged. Preserves any existing query.
 */
export function appendDigestUtm(href: string, isoWeek?: string): string {
  const sep = href.includes("?") ? "&" : "?";
  const wk = isoWeek ? `&wk=${encodeURIComponent(isoWeek)}` : "";
  return `${href}${sep}src=digest${wk}`;
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Honest one-line rendering of a movement metric's delta. `first` /
 * `notComparable` never fabricate a percentage or a "+0". */
function movementValue(metric: MovementMetric): { value: string; delta: string } {
  const fmtValue =
    metric.unit === "cents"
      ? (n: number) => centsToUsd(n)
      : (n: number) => `${Math.round(n)}`;
  const value = fmtValue(metric.current);
  if (metric.delta.kind === "first") {
    return { value, delta: DIGEST_COPY.firstWeek };
  }
  if (metric.delta.kind === "notComparable") {
    return { value, delta: DIGEST_COPY.notComparable };
  }
  const f = formatRawMetricDelta(metric.delta, "", fmtValue);
  const pct = f.pctText ? ` (${f.pctText})` : "";
  return { value, delta: f.direction === "none" ? DIGEST_COPY.noChange : `${f.text}${pct}` };
}

function movementLabel(key: MovementMetricKey): string {
  return DIGEST_COPY.movementLabels[key];
}

/** Honest one-line rendering of a score line's delta. */
function scoreDeltaText(line: DigestScoreLine): string {
  if (line.currentValue === null) return DIGEST_COPY.notComparable;
  if (line.delta.kind === "first") return DIGEST_COPY.firstWeek;
  if (line.delta.kind === "notComparable") return DIGEST_COPY.notComparable;
  const f = formatDelta(line.delta);
  return f.direction === "none" ? DIGEST_COPY.noChange : f.text;
}

/** Best-effort origin extraction (`https://app.example/settings` →
 * `https://app.example`) so the companion CTA (below) can target `/dashboard`
 * without a new required caller param — the poller only ever passes an
 * absolute `manageUrl`, so this never falls back to "" in production. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * T1.1: the body "Open your companion" button. This is deliberately a
 * separate, prominent element from the footer's "Manage digest settings"
 * link — the footer CTA measures a settings visit, this one measures an
 * actual return to the companion surface (`/dashboard`), which also counts
 * as a `companion_revisit` (src/lib/launch-events.ts `isCompanionRevisit`)
 * on top of the week-keyed `digest_return` both CTAs already fire.
 */
function ctaButton(href: string, label: string): string {
  return `<tr><td style="padding:4px 0 20px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="border-radius:8px;background:${BRAND}">
        <a href="${esc(
          href,
        )}" style="display:inline-block;padding:12px 24px;font:600 15px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px">${esc(
          label,
        )}</a>
      </td>
    </tr></table>
  </td></tr>`;
}

function sectionHeading(text: string): string {
  return `<tr><td style="padding:24px 0 8px;font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">${esc(
    text,
  )}</td></tr>`;
}

function metricRow(label: string, value: string, delta: string): string {
  return `<tr><td style="padding:6px 0;border-bottom:1px solid ${HAIRLINE}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font:400 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
        label,
      )}</td>
      <td align="right" style="font:600 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
        value,
      )} <span style="font-weight:400;color:${MUTED}">${esc(delta)}</span></td>
    </tr></table>
  </td></tr>`;
}

/**
 * Render the digest to a single self-contained HTML document. `unsubscribeUrl`
 * is the one-click token URL for this exact send; `manageUrl` points at the
 * Settings digest card. Never call this for a suppressed digest — the sender
 * skips those upstream.
 */
export function renderDigestEmail(
  content: DigestContent,
  urls: {
    unsubscribeUrl: string;
    manageUrl: string;
    /** ISO week of this send (e.g. "2026-W28") — appended to the app-return
     * CTA as `wk` for digest return-rate instrumentation (W5-I). Optional so a
     * direct caller/test can omit it (then only `src=digest` is tagged). */
    isoWeek?: string;
    /** Companion surface URL (T1.1), e.g. `${appOrigin}/dashboard`. Optional —
     * defaults to `${origin of manageUrl}/dashboard` so existing callers don't
     * need to pass a new param. */
    dashboardUrl?: string;
  },
): string {
  const rows: string[] = [];

  // Companion-return CTA (T1.1): a prominent body button, not just the
  // footer settings link — measures an actual return to the companion, not a
  // settings visit. Placed first so it's the top thing a reader can act on.
  // The team lane's /dashboard shows a team overview, not a personal
  // companion — the label must say what the click actually opens.
  const dashboardUrl = urls.dashboardUrl ?? `${originOf(urls.manageUrl)}/dashboard`;
  const ctaLabel =
    content.lane === "team"
      ? DIGEST_COPY.cta.openDashboard
      : DIGEST_COPY.cta.openCompanion;
  rows.push(ctaButton(appendDigestUtm(dashboardUrl, urls.isoWeek), ctaLabel));

  // Movement
  rows.push(sectionHeading(DIGEST_COPY.sections.movement));
  for (const metric of content.movement.metrics) {
    const { value, delta } = movementValue(metric);
    rows.push(metricRow(movementLabel(metric.key), value, delta));
  }

  // Score trends
  if (content.scores.length > 0) {
    rows.push(sectionHeading(DIGEST_COPY.sections.scores));
    for (const line of content.scores) {
      const value = line.currentValue === null ? "—" : `${Math.round(line.currentValue)}`;
      rows.push(metricRow(line.label, value, scoreDeltaText(line)));
    }
  }

  // TCI Phase 2-F (ADR 0050): the manager team-brief section — TEAM LANE ONLY,
  // present only when the sender composed it for a team with manager recipients.
  // Aggregate/count-only: a compact team-health headline, capability coverage,
  // period-over-period movement, the open insight titles, and an honest
  // data-confidence line. Never a per-person value.
  if (content.teamBrief) {
    const brief = content.teamBrief;
    rows.push(sectionHeading(DIGEST_COPY.sections.teamBrief));
    const briefLines: string[] = [DIGEST_COPY.teamBrief.lead];
    const headline = brief.headline
      .filter((h) => h.value !== null)
      .map((h) => `${h.label} ${Math.round(h.value as number)}`)
      .join(" · ");
    if (headline) {
      briefLines.push(`${DIGEST_COPY.teamBrief.maturity}: ${headline}`);
    }
    if (brief.coverage.length > 0) {
      briefLines.push(`${DIGEST_COPY.teamBrief.coverage}:`);
      for (const c of brief.coverage) {
        briefLines.push(
          `• ${DIGEST_COPY.teamBrief.coverageRow(c.label, c.mastered, c.total)}`,
        );
      }
    }
    if (brief.movement.length > 0) {
      briefLines.push(`${DIGEST_COPY.teamBrief.movement}:`);
      for (const m of brief.movement) {
        briefLines.push(
          `• ${DIGEST_COPY.teamBrief.movementRow(m.label, m.direction, m.masteredNow, m.masteredBefore)}`,
        );
      }
    }
    if (brief.insights.length > 0) {
      briefLines.push(`${DIGEST_COPY.teamBrief.insights}:`);
      for (const i of brief.insights) {
        briefLines.push(`• ${i.title}`);
      }
    }
    briefLines.push(brief.dataConfidenceLine);
    rows.push(
      `<tr><td style="padding:6px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${briefLines
        .map((l) => esc(l))
        .join("<br>")}</td></tr>`,
    );
  }

  // Your growth journey (W5-F): the celebratory Growth-Journey section — the
  // digest is now the delivery channel it's specced to be (§8.4). Milestones
  // subsume the old standalone "Personal best" block (a new personal best is
  // simply the `new-best` milestone). Each gets a positive accent, visually
  // distinct from the "What to focus on" alerts below.
  if (content.milestones.length > 0) {
    rows.push(sectionHeading(DIGEST_COPY.sections.growthJourney));
    rows.push(
      `<tr><td style="padding:2px 0 8px;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
        DIGEST_COPY.growthJourneyLead,
      )}</td></tr>`,
    );
    for (const milestone of content.milestones) {
      rows.push(
        `<tr><td style="padding:10px 0;border-bottom:1px solid ${HAIRLINE}">
          <div style="border-left:3px solid ${POSITIVE};padding-left:12px">
            <div style="font:600 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
              milestone.title,
            )}</div>
            <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:4px">${esc(
              milestone.body,
            )}</div>
          </div>
        </td></tr>`,
      );
    }
  }

  // What to focus on — kind-aware (W5-F / errata §1.2(7)): a coaching rec is
  // tagged "Guidance" with a muted accent; a must-act alert (an errored
  // connection, `severity: "action"`) is tagged "Needs attention" with a
  // warn accent. The two are no longer rendered identically.
  if (content.recommendations.length > 0) {
    rows.push(sectionHeading(DIGEST_COPY.sections.focus));
    for (const item of content.recommendations) {
      const isAction = item.severity === "action";
      const isGuidance = item.kind === "recommendation";
      const accent = isAction ? WARN : isGuidance ? BRAND : MUTED;
      const label = isGuidance
        ? DIGEST_COPY.focusLabels.guidance
        : isAction
          ? DIGEST_COPY.focusLabels.actionNeeded
          : null;
      const pill = label
        ? `<span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;font:600 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.02em;color:${accent};border:1px solid ${accent}">${esc(
            label,
          )}</span>`
        : "";
      rows.push(
        `<tr><td style="padding:10px 0;border-bottom:1px solid ${HAIRLINE}">
          <div style="border-left:3px solid ${accent};padding-left:12px">
            <div style="font:600 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
              item.title,
            )}${pill}</div>
            <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:4px">${esc(
              item.body,
            )}</div>
          </div>
        </td></tr>`,
      );
    }
  }

  // Data freshness (always: data-as-of + any stale annotations)
  rows.push(sectionHeading(DIGEST_COPY.sections.freshness));
  const asOf = content.dataAsOfDate
    ? DIGEST_COPY.dataAsOf(digestDate(content.dataAsOfDate))
    : DIGEST_COPY.dataAsOfNone;
  const freshnessLines = [asOf, ...content.staleAnnotations];
  rows.push(
    `<tr><td style="padding:6px 0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${freshnessLines
      .map((l) => esc(l))
      .join("<br>")}</td></tr>`,
  );

  const preheader = `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(
    content.preheader,
  )}</span>`;

  return `<!-- weekly digest -->${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px">
      <tr><td style="padding:28px 32px 0">
        <div style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND}">Revealyst</div>
        <p style="margin:12px 0 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${esc(
          content.intro,
        )}</p>
      </td></tr>
      <tr><td style="padding:0 32px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join(
          "",
        )}</table>
      </td></tr>
      <tr><td style="padding:24px 32px 28px">
        <hr style="border:none;border-top:1px solid ${HAIRLINE};margin:0 0 16px">
        <p style="margin:0 0 8px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          DIGEST_COPY.footer.honesty,
        )}</p>
        <p style="margin:0 0 8px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${esc(
          DIGEST_COPY.footer.why,
        )}</p>
        <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">
          <a href="${esc(appendDigestUtm(urls.manageUrl, urls.isoWeek))}" style="color:${BRAND};text-decoration:underline">${esc(
            DIGEST_COPY.footer.manage,
          )}</a>
          &nbsp;·&nbsp;
          <a href="${esc(urls.unsubscribeUrl)}" style="color:${BRAND};text-decoration:underline">${esc(
            DIGEST_COPY.footer.unsubscribe,
          )}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

/**
 * RFC 8058 one-click unsubscribe headers for the digest. `List-Unsubscribe`
 * carries the HTTPS one-click URL; `List-Unsubscribe-Post` opts into one-click
 * POST so a mail client's native Unsubscribe button hits our POST handler.
 */
export function digestListUnsubscribeHeaders(
  unsubscribeUrl: string,
): { name: string; value: string }[] {
  return [
    { name: "List-Unsubscribe", value: `<${unsubscribeUrl}>` },
    { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
  ];
}
