import { ConfidencePill } from "@/components/confidence-pill";
import { InfoTip } from "@/components/info-tip";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONFIDENCE_LABELS,
  COST_PER_UNIT_COPY,
  MODEL_MIX_TREND_COPY,
  SPEND_PROJECTION_COPY,
} from "@/lib/analytics-glossary";
import { formatCents } from "@/lib/format";
import type {
  CostPerUnit,
  ModelMixTrend,
  SpendProjection,
} from "@/lib/spend-governance";

/** Sub-dollar unit costs (e.g. fractions of a cent per prompt) need more
 * precision than formatCents' whole-cent rounding, or they collapse to $0.00. */
function formatUnitCost(centsPerUnit: number): string {
  const dollars = centsPerUnit / 100;
  if (dollars >= 1) return formatCents(Math.round(centsPerUnit));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(dollars);
}

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * Month-end run-rate projection (M2). DERIVED, straight-line — the badge and
 * InfoTip say so, and the page only mounts this card when there IS reported
 * spend to project from (projection is non-null).
 */
export function SpendProjectionCard({
  projection,
}: {
  projection: SpendProjection;
}) {
  const C = SPEND_PROJECTION_COPY;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {C.title}
          <InfoTip label={C.title} short={C.info} />
          <ConfidencePill
            tier={C.confidence}
            label={CONFIDENCE_LABELS[C.confidence]}
            detail={C.confidenceDetail}
          />
        </CardTitle>
        <CardDescription>{C.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex flex-col">
          <span className="font-heading text-3xl font-semibold tabular-nums">
            {formatCents(projection.projectedMonthEndCents)}
          </span>
          <span className="text-xs text-muted-foreground">
            {C.basisLabel(projection.dayOfMonth, projection.daysInMonth)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-heading text-2xl font-semibold tabular-nums text-muted-foreground">
            {formatCents(projection.reportedMtdCents)}
          </span>
          <span className="text-xs text-muted-foreground">Reported so far</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Unit economics (M5): vendor-reported cost per active day and per prompt.
 * Ratio honesty — each figure is only present when both its sides had data
 * (the lib returns null otherwise); a missing figure shows an em-dash, never a
 * fabricated zero. Reported spend only.
 */
export function CostPerUnitCard({
  costPerActiveDay,
  costPerPrompt,
}: {
  costPerActiveDay: CostPerUnit | null;
  costPerPrompt: CostPerUnit | null;
}) {
  const C = COST_PER_UNIT_COPY;
  const bothMissing = !costPerActiveDay && !costPerPrompt;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {C.title}
          <InfoTip label={C.title} short={C.info} />
          <ConfidencePill
            tier={C.confidence}
            label={CONFIDENCE_LABELS[C.confidence]}
            detail={C.confidenceDetail}
          />
        </CardTitle>
        <CardDescription>{C.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {bothMissing ? (
          <p className="text-sm text-muted-foreground">{C.emptyBody}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <UnitFigure
              label={C.perActiveDay.label}
              short={C.perActiveDay.short}
              cost={costPerActiveDay}
              // Named for the math: raw active_day rows are per tool account
              // (subject), NOT deduped person-days (F4) — see the glossary's
              // denominator discipline note.
              unitNoun="subject-day"
            />
            <UnitFigure
              label={C.perPrompt.label}
              short={C.perPrompt.short}
              cost={costPerPrompt}
              unitNoun="prompt"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UnitFigure({
  label,
  short,
  cost,
  unitNoun,
}: {
  label: string;
  short: string;
  cost: CostPerUnit | null;
  unitNoun: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <InfoTip label={label} short={short} />
      </span>
      {cost ? (
        <>
          <span className="font-heading text-2xl font-semibold tabular-nums">
            {formatUnitCost(cost.centsPerUnit)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatCents(cost.reportedCents)} ÷ {numberFmt.format(cost.units)}{" "}
            {unitNoun}
            {cost.units === 1 ? "" : "s"}
          </span>
        </>
      ) : (
        <>
          <span className="font-heading text-2xl font-semibold tabular-nums text-muted-foreground">
            —
          </span>
          <span className="text-xs text-muted-foreground">
            Not enough data to compute a ratio.
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Model-mix trend (M7): per-model share shift between the first and last
 * COMPLETE week of the window (partial endpoint weeks are dropped in lib —
 * a Monday-morning sample can't read as a week's mix). Directional
 * token-volume mix (never a dollar split) — the badge and InfoTip say so.
 * Renders the honest empty note when there aren't two complete weeks of
 * per-model data. Shift arrows are judgment-free (muted, no verdict color):
 * a model gaining share is not "good" or "bad".
 */
export function ModelMixTrendCard({ trend }: { trend: ModelMixTrend }) {
  const C = MODEL_MIX_TREND_COPY;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {C.title}
          <InfoTip label={C.title} short={C.info} />
          <ConfidencePill
            tier={C.confidence}
            label={CONFIDENCE_LABELS[C.confidence]}
            detail={C.confidenceDetail}
          />
        </CardTitle>
        <CardDescription>{C.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!trend.available ? (
          <p className="text-muted-foreground">{C.empty}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Token volume</Badge>
              <span className="text-xs text-muted-foreground">
                {trend.weeks.length} complete weeks · not a cost split
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {trend.shifts.map((shift) => {
                const up = shift.shiftPct > 0.5;
                const down = shift.shiftPct < -0.5;
                return (
                  <li
                    key={shift.model}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {shift.model}
                    </span>
                    <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                      <span>
                        {Math.round(shift.firstWeekSharePct)}% →{" "}
                        {Math.round(shift.lastWeekSharePct)}%
                      </span>
                      <span>
                        <span aria-hidden="true">
                          {up ? "▲" : down ? "▼" : "→"}
                        </span>{" "}
                        {shift.shiftPct >= 0 ? "+" : ""}
                        {Math.round(shift.shiftPct)} pts
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Share of weekly token volume by model, over complete weeks only.
              Revealyst doesn&apos;t ingest a per-model dollar split, so this is
              a usage mix, not dollars.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
