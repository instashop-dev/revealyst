import { Badge } from "@/components/ui/badge";
import type { ConfidenceTier } from "@/lib/maturity";
import { cn } from "@/lib/utils";

// The G2 three-tier confidence label (plus an explicit "not measured" rung),
// rendered as a small badge next to every board number. Nothing labeled
// `directional` or `modeled` is ever presented as a certified fact — the badge
// IS the honesty disclosure, so it renders on measured numbers too (they earn
// the stronger label) rather than only flagging the weak ones.

const LABEL: Record<ConfidenceTier, string> = {
  measured: "Measured",
  modeled: "Modeled",
  directional: "Directional",
  not_measured: "Not measured",
};

export function ConfidenceBadge({
  tier,
  className,
}: {
  tier: ConfidenceTier;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        tier === "not_measured" && "text-muted-foreground",
        className,
      )}
    >
      {LABEL[tier]}
    </Badge>
  );
}
