import type * as React from "react";
import { Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ConfidencePill,
  type ConfidencePillTier,
} from "@/components/confidence-pill";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CapabilityGrowTrigger } from "@/components/companion/capability-curriculum-drawer";
import {
  CAPABILITY_PROFILE_COPY,
  confidenceTierLabel,
  masteryBand,
} from "@/lib/capability-glossary";
import type { CapabilityProfileRow } from "./capability-profile-card";

/**
 * The Growth-surface capability card (U1.3), self-view only — renders EVERY
 * evidenced capability (not just the strongest few), each with a confidence
 * pill, last-evidence recency, and a per-row "See how to grow this" trigger.
 * Structurally distinct from the compact `CapabilityProfileCard` (the Today
 * glance), so it lives in its own file rather than a `fullList` branch. Guards
 * its OWN empty state (an empty rows array renders the honest forming state, or a
 * caller-supplied `emptyState`) so it can never render an empty card shell.
 * Server-safe, pure props — the caller passes only the SIGNED-IN person's own
 * rows (`mastery.forUser`), so no per-person mastery ever leaves self-view.
 */

/** Plain-English "last measured" recency, e.g. "Last measured Jul 12". UTC-
 * pinned (house convention) so a UTC calendar-day ISO string never renders a day
 * early on a west-of-UTC host. Returns the honest "not recorded" copy when the
 * row carries no date — never invents one. Pure so the row stays server-rendered. */
function recencyLine(iso: string | null | undefined): string {
  if (!iso) return CAPABILITY_PROFILE_COPY.noEvidenceDate;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return CAPABILITY_PROFILE_COPY.noEvidenceDate;
  return `${CAPABILITY_PROFILE_COPY.lastEvidenceLead} ${when.toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" },
  )}`;
}

export function CapabilityFullListCard({
  rows,
  labels,
  emptyState,
}: {
  /** The signed-in person's capability state rows (strongest first). */
  rows: CapabilityProfileRow[];
  /** Capability slug → display label (for the per-row grow trigger's path). */
  labels: ReadonlyMap<string, string>;
  /** Honest empty state rendered when there are no evidenced rows. Defaults to
   * the compact card's forming state; the Growth route passes a richer
   * connect-oriented one. */
  emptyState?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" aria-hidden="true" />
          {CAPABILITY_PROFILE_COPY.title}
        </CardTitle>
        <CardDescription>{CAPABILITY_PROFILE_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          (emptyState ?? (
            <EmptyState
              variant="inline"
              title={CAPABILITY_PROFILE_COPY.forming.headline}
              description={CAPABILITY_PROFILE_COPY.forming.body}
            />
          ))
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
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-xs text-muted-foreground">
                    {recencyLine(row.lastEvidenceAt)}
                  </span>
                  <CapabilityGrowTrigger
                    slug={row.capabilitySlug}
                    label={row.label}
                    labels={labels}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
