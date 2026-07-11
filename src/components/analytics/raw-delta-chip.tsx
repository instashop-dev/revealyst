import { formatRawMetricDelta, type RawMetricDelta } from "@/lib/raw-metric-delta";
import { RECENT_MOVEMENT_COPY } from "@/lib/analytics-glossary";
import { InfoTip } from "@/components/info-tip";
import { cn } from "@/lib/utils";

/**
 * Renders one raw-metric period-over-period delta (M1) as a small chip,
 * matching the score-card delta visual language (▲/▼, up = primary, down =
 * destructive, screen-reader sentence). The honest non-delta kinds never fake
 * a magnitude: `first` shows a "new" tag (no prior period), `notComparable`
 * renders nothing at all. `unit` names the quantity for the a11y sentence.
 */
export function RawDeltaChip({
  delta,
  unit,
  formatValue,
}: {
  delta: RawMetricDelta;
  unit: string;
  formatValue?: (n: number) => string;
}) {
  if (delta.kind === "notComparable") {
    return null;
  }
  if (delta.kind === "first") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        {RECENT_MOVEMENT_COPY.newLabel}
        <InfoTip label="New this period" short={RECENT_MOVEMENT_COPY.newHint} />
      </span>
    );
  }
  const { text, pctText, direction, srText } = formatRawMetricDelta(
    delta,
    unit,
    formatValue,
  );
  if (direction === "none") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        No change vs {delta.previousPeriodLabel}
        <span className="sr-only">{srText}</span>
      </span>
    );
  }
  const up = direction === "up";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        up ? "text-primary" : "text-destructive",
      )}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span aria-hidden="true">
        {text}
        {pctText ? ` (${pctText})` : ""} vs {delta.previousPeriodLabel}
      </span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}
