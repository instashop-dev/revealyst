import type { AttributionLevel } from "@/contracts/attribution";
import { Badge } from "@/components/ui/badge";

// §6.1: degraded attribution is surfaced honestly, never hidden. A score
// carries the LOWEST attribution of its inputs, so an "account-level" badge
// tells the reader this number is not per-person.
const LABELS: Record<
  AttributionLevel,
  { label: string; hint: string; variant: "outline" | "secondary" }
> = {
  person: {
    label: "Per-person",
    hint: "Attributed to individual people.",
    variant: "outline",
  },
  key_project: {
    label: "Key / project",
    hint: "Attributed to a key or project, not a specific person.",
    variant: "secondary",
  },
  account: {
    label: "Account-level",
    hint: "Includes shared-account data — not per-person.",
    variant: "secondary",
  },
};

export function AttributionBadge({
  attribution,
}: {
  attribution: AttributionLevel;
}) {
  const { label, hint, variant } = LABELS[attribution];
  return (
    <Badge variant={variant} title={hint}>
      {label}
    </Badge>
  );
}
