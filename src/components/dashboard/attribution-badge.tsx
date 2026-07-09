import type { AttributionLevel } from "@/contracts/attribution";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTRIBUTION_GLOSSARY } from "@/lib/metrics-glossary";

// §6.1: degraded attribution is surfaced honestly, never hidden. A score
// carries the LOWEST attribution of its inputs, so an "account-level" badge
// tells the reader this number is not per-person.
const VARIANT: Record<AttributionLevel, "outline" | "secondary"> = {
  person: "outline",
  key_project: "secondary",
  account: "secondary",
};

export function AttributionBadge({
  attribution,
}: {
  attribution: AttributionLevel;
}) {
  const entry = ATTRIBUTION_GLOSSARY[attribution];
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-block" />}>
        <Badge variant={VARIANT[attribution]}>{entry.label}</Badge>
      </TooltipTrigger>
      <TooltipContent>{entry.shortWhat}</TooltipContent>
    </Tooltip>
  );
}
