import { Badge } from "@/components/ui/badge";
import {
  CONFIDENCE_LABELS,
  type ConfidenceTier,
} from "@/lib/analytics-glossary";

/**
 * The confidence-tier badge (G2) shown next to every inferred number on the
 * F1.2 analytics surfaces. `detail` overrides the bare tier label with a
 * method note ("derived, straight-line", "directional · token volume") from
 * CONFIDENCE_DETAIL, so the how sits right next to the number.
 */
export function ConfidenceBadge({
  tier,
  detail,
}: {
  tier: ConfidenceTier;
  detail?: string;
}) {
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {detail ?? CONFIDENCE_LABELS[tier]}
    </Badge>
  );
}
