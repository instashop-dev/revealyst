import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PersonSignalCoverage } from "@/lib/signal-coverage";
import { vendorLabel } from "@/lib/vendor-labels";

// W5-E deliverable (4) UI: the per-person signal-coverage badge — "3 sources"
// vs "1 source". An honesty surface: it says how many independent data sources
// feed a person's picture, so a single-source read isn't mistaken for a
// broad-based one. Positive-first framing (G7): more sources reads as a fuller
// picture, never a single source as a failing.
//
// Privacy: the count is aggregate-safe on its own. The vendor NAMES render only
// when `selfView` is set — a person may always see which of their own tools are
// connected; in a team view (selfView omitted) the badge shows the bare count,
// leaking no per-person tool list.

export function SignalCoverageBadge({
  coverage,
  selfView = false,
}: {
  coverage: Pick<PersonSignalCoverage, "sourceCount" | "vendors">;
  /** When true, reveal the connected vendor names in the tooltip. */
  selfView?: boolean;
}) {
  const { sourceCount, vendors } = coverage;
  const label = sourceCount === 1 ? "1 source" : `${sourceCount} sources`;

  // No linked sources yet — say so plainly rather than paint a "0" as a score.
  if (sourceCount === 0) {
    return <Badge variant="outline">No sources yet</Badge>;
  }

  const variant = sourceCount >= 2 ? "secondary" : "outline";
  const badge = <Badge variant={variant}>{label}</Badge>;

  const tip =
    selfView && vendors.length > 0
      ? `Signal from ${vendors.map(vendorLabel).join(", ")}. More connected sources give a fuller, more reliable picture.`
      : "How many connected tools contribute signal for this person. More sources give a fuller, more reliable picture.";

  return (
    <Tooltip>
      {/* Focusable trigger so the tooltip is keyboard-reachable (matches the
       * SyncStatusBadge idiom). */}
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        }
      >
        {badge}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
