import type {
  AttributionCoverageDelta,
  AttributionTrend,
  AttributionTrendPoint,
} from "@/lib/attribution-trend";
import type { AttributionLevel } from "@/contracts/attribution";
import { ATTRIBUTION_LEVELS } from "@/contracts/attribution";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ATTRIBUTION_GLOSSARY,
  CONCEPT_GLOSSARY,
  methodologyAnchor,
} from "@/lib/metrics-glossary";

// F1.7 — attribution coverage over time: what share of tracked usage the
// vendors attribute to a specific individual, and whether that share is
// climbing. Every number here is MEASURED (counted from stored active_day
// rows), so the card says so — no inferred/derived figure appears. Team-only
// surface (see the dashboard page): "how completely can usage be attributed
// across the fleet" is a CTO-scoped completeness question, not something a
// single person's self-view is asking about their own scores.
//
// Copy discipline (invariant b): "person-attributed" means the VENDOR reported
// the usage at per-individual granularity — it does NOT mean the individual is
// identity-resolved to a tracked person in /reconcile. This card must never
// say "identity-resolved" (the same page can honestly show unresolved subjects
// alongside 100% person-attributed usage).
//
// Headline basis: the big % is the LATEST week's share — the same weekly
// series the sparkline and the "up from" endpoints are drawn from, so the
// headline can never contradict the delta beside it. The multi-week aggregate
// renders below, explicitly labeled as the window average.

const W = 200;
const H = 36;

function fmtWeek(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Sparkline of weekly person-attributed share (0–100). A single week draws a
 * dot, never an invented line — same idiom as ScoreTrend. */
function CoverageSparkline({ trend }: { trend: AttributionTrendPoint[] }) {
  const x = (i: number) =>
    trend.length <= 1 ? W / 2 : (i / (trend.length - 1)) * W;
  const y = (pct: number) => H - (Math.max(0, Math.min(100, pct)) / 100) * H;

  const first = Math.round(trend[0].pct);
  const last = Math.round(trend[trend.length - 1].pct);
  const label =
    trend.length === 1
      ? `Attribution coverage: 1 week of data, at ${first}% person-attributed`
      : `Attribution coverage: ${trend.length} weeks, from ${first}% to ${last}% person-attributed`;

  if (trend.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <circle cx={x(0)} cy={y(trend[0].pct)} r={2.5} fill="var(--primary)" />
      </svg>
    );
  }
  const d = trend
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.pct)}`)
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
    </svg>
  );
}

/** The "up from N%" line — rendered only for a real two-endpoint delta with a
 * non-zero move. A single week ({ kind: "first" }) or a flat delta says
 * nothing here (silence, not a fabricated "no change" boast). The comparison
 * week is named by its absolute date only — a relative "N weeks ago" would go
 * stale the moment a connector stops syncing. */
function CoverageDelta({ delta }: { delta: AttributionCoverageDelta }) {
  if (delta.kind !== "delta" || delta.deltaPct === 0) return null;
  const up = delta.deltaPct > 0;
  const magnitude = Math.abs(delta.deltaPct);
  const srText = `Person-attributed share ${
    up ? "rose" : "fell"
  } ${magnitude} percentage point${magnitude === 1 ? "" : "s"} versus the week of ${fmtWeek(
    delta.previousWeekStart,
  )}, when it was ${delta.previousPct}%.`;
  return (
    <p className="text-xs text-muted-foreground">
      <span
        className={up ? "font-medium text-primary" : "font-medium text-destructive"}
        aria-hidden="true"
      >
        {up ? "▲" : "▼"} {up ? "up" : "down"} from {delta.previousPct}%
      </span>{" "}
      <span aria-hidden="true">
        the week of {fmtWeek(delta.previousWeekStart)}
      </span>
      <span className="sr-only">{srText}</span>
    </p>
  );
}

/**
 * Attribution coverage: the share of tracked usage the vendors attribute to a
 * specific individual, over time. `trend.kind === "empty"` renders an honest
 * empty state (why it's empty + what fills it), never a placeholder
 * percentage.
 */
export function AttributionTrendCard({ trend }: { trend: AttributionTrend }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Attribution coverage
          <InfoTip
            label="Attribution coverage"
            short={CONCEPT_GLOSSARY.attribution.shortWhat}
            detail="Share of usage-days your vendors attribute to a specific individual, versus a shared key/project or a whole account. Higher means more of your usage can be honestly reported per person. Vendor attribution is separate from linking those individuals to people on the Match accounts page."
            learnMoreHref={`/methodology#${methodologyAnchor("attribution")}`}
          />
        </CardTitle>
        <CardDescription>
          How much of your tracked usage vendors attribute to a specific
          individual — measured, not estimated.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {trend.kind === "empty" ? (
          <p className="text-muted-foreground">
            No usage in the period this dashboard covers. Once a connected tool
            syncs activity, this shows what share of it vendors attribute to a
            specific individual.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div className="flex flex-col">
                <span className="flex items-baseline gap-2">
                  <span className="font-heading text-3xl font-semibold tabular-nums">
                    {Math.round(trend.currentPct)}%
                  </span>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Measured
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  of usage person-attributed, week of{" "}
                  {fmtWeek(trend.currentWeekStart)}
                </span>
                <CoverageDelta delta={trend.delta} />
              </div>
              <CoverageSparkline trend={trend.trend} />
            </div>

            {trend.trend.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                Across all {trend.trend.length} weeks shown: {trend.windowPct}%
                of {trend.totalDays} usage-days person-attributed.
              </p>
            ) : null}

            <dl className="flex flex-col gap-1.5">
              {ATTRIBUTION_LEVELS.filter(
                (level) => trend.byLevel[level].days > 0,
              ).map((level: AttributionLevel) => (
                <div
                  key={level}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="text-muted-foreground">
                    {ATTRIBUTION_GLOSSARY[level].label}
                  </dt>
                  <dd className="tabular-nums">
                    {trend.byLevel[level].pct}%
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({trend.byLevel[level].days} usage-day
                      {trend.byLevel[level].days === 1 ? "" : "s"})
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
