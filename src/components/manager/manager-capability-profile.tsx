import { Compass, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ConfidencePill,
  type ConfidencePillTier,
} from "@/components/confidence-pill";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { confidenceTierLabel, masteryBand } from "@/lib/capability-glossary";
import { MANAGER_DRILL_IN_COPY } from "@/lib/manager-capability-copy";
import type { ManagerCapabilityRow } from "@/lib/manager-capability-view";

/**
 * The manager per-person capability drill-in card (P3-A, ADR 0045). Renders one
 * managed-team member's capabilities with the SAME positive-first vocabulary as
 * the self-view card (`masteryBand` / `confidenceTierLabel`) — bands, never the
 * raw 0–1 number; "discovery, never deficiency"; no ranking or verdict.
 *
 * Structurally a COACHING READ, not the self-view: it deliberately renders NO
 * per-row "grow this" curriculum trigger, no recommendations, and no coaching
 * content (those stay self-view-only forever, V4 NOT-list). It shows only the
 * four mastery facts ADR 0045 authorizes — band, confidence tier, evidence
 * count, last-evidence recency — plus a visible provenance note stating what
 * this data is and is not. Server-safe, pure props.
 */

/** Plain-English "last measured" recency, UTC-pinned (house convention) so a
 * UTC calendar-day ISO never renders a day early on a west-of-UTC host. Honest
 * "not recorded" copy when the row carries no date — never invents one. */
function recencyLine(iso: string | null): string {
  if (!iso) return "Recency not recorded";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "Recency not recorded";
  return `Last measured ${when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

export function ManagerCapabilityProfile({
  rows,
}: {
  /** The member's capability rows (strongest first). */
  rows: ManagerCapabilityRow[];
}) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" aria-hidden="true" />
          {MANAGER_DRILL_IN_COPY.capabilitiesHeading}
        </CardTitle>
        {/* Honesty law: a visible, always-on note of what this is and is NOT. */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{MANAGER_DRILL_IN_COPY.provenanceNote}</span>
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            variant="inline"
            title={MANAGER_DRILL_IN_COPY.forming.headline}
            description={MANAGER_DRILL_IN_COPY.forming.body}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.capabilitySlug}
                className="flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {masteryBand(row.mastery)}
                    </Badge>
                    <ConfidencePill
                      tier={row.confidenceTier as ConfidencePillTier}
                      label={confidenceTierLabel(row.confidenceTier)}
                    />
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{recencyLine(row.lastEvidenceAt)}</span>
                  <span>
                    {MANAGER_DRILL_IN_COPY.evidenceLead(row.evidenceCount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
