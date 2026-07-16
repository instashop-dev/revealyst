import { ConfidencePill } from "@/components/confidence-pill";
import { RawDeltaChip } from "@/components/analytics/raw-delta-chip";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONFIDENCE_LABELS,
  RECENT_MOVEMENT_COPY,
} from "@/lib/analytics-glossary";
import { formatCents } from "@/lib/format";
import type { MovementMetric, RecentMovement } from "@/lib/recent-movement";

const numberFmt = new Intl.NumberFormat("en-US");

function renderValue(metric: MovementMetric): string {
  return metric.unit === "cents"
    ? formatCents(metric.current)
    : numberFmt.format(metric.current);
}

/** Formats a signed delta MAGNITUDE for the chip in the metric's own unit. */
function magnitudeFormatter(metric: MovementMetric): (n: number) => string {
  return metric.unit === "cents"
    ? (n) => formatCents(n)
    : (n) => numberFmt.format(Math.round(n));
}

/**
 * Recent-movement strip (M1): a few headline raw quantities with honest
 * period-over-period deltas. Aggregate-only (a spend figure and two org-level
 * counts — never a per-person value). The values themselves are measured; the
 * confidence badge says so.
 */
export function RecentMovementPanel({ movement }: { movement: RecentMovement }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {RECENT_MOVEMENT_COPY.title}
          <InfoTip label={RECENT_MOVEMENT_COPY.title} short={RECENT_MOVEMENT_COPY.info} />
          <ConfidencePill
            tier={RECENT_MOVEMENT_COPY.confidence}
            label={CONFIDENCE_LABELS[RECENT_MOVEMENT_COPY.confidence]}
          />
        </CardTitle>
        <CardDescription>
          {RECENT_MOVEMENT_COPY.description(movement.periodDays)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {movement.metrics.map((metric) => {
          const copy = RECENT_MOVEMENT_COPY.metrics[metric.key];
          return (
            <div key={metric.key} className="flex flex-col gap-1">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {copy.label}
                <InfoTip label={copy.label} short={copy.short} />
              </span>
              <span className="font-heading text-2xl font-semibold tabular-nums">
                {renderValue(metric)}
              </span>
              <RawDeltaChip
                delta={metric.delta}
                unit={copy.label}
                formatValue={magnitudeFormatter(metric)}
                // Spend movement is judgment-free: cost going up isn't "good"
                // and down isn't "bad", so no verdict color (F10). Activity
                // metrics keep the up-good language shared with score cards.
                sentiment={metric.key === "reported_spend" ? "neutral" : "upGood"}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
