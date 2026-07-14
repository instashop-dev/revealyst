import { Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CAPABILITY_PROFILE_COPY,
  confidenceTierLabel,
  masteryBand,
} from "@/lib/capability-glossary";

/**
 * The capability-profile card (W7-2), self-view only. A compact, positive-first
 * read of the person's strongest AI capabilities — a DECOMPOSITION of their one
 * proficiency band, never a competing third ladder. Renders bands + a plain-
 * English confidence tier + the single eligible-next focus; the raw 0–1 mastery
 * stays behind the existing diagnostic expander (no second expander here). When
 * the person has no capability evidence yet it renders the honest forming state,
 * never zeros. Server-safe, pure props — the caller (personal self-view) passes
 * only the SIGNED-IN person's own rows (`mastery.forUser`), so no per-person
 * mastery ever leaves self-view.
 */
export type CapabilityProfileRow = {
  capabilitySlug: string;
  /** Display label from the capability catalog (`capabilities.label`). */
  label: string;
  /** [0,1] mastery — rendered as a band, not the raw number. */
  mastery: number;
  confidenceTier: string;
  nextCapability: string | null;
};

export function CapabilityProfileCard({
  rows,
  labels,
}: {
  /** The signed-in person's capability state rows (strongest first). */
  rows: CapabilityProfileRow[];
  /** Capability slug → display label (for the eligible-next line). */
  labels: ReadonlyMap<string, string>;
}) {
  const nextSlug = rows.find((r) => r.nextCapability)?.nextCapability ?? null;
  const nextLabel = nextSlug ? labels.get(nextSlug) : undefined;
  const shown = rows.slice(0, CAPABILITY_PROFILE_COPY.maxRows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" aria-hidden="true" />
          {CAPABILITY_PROFILE_COPY.title}
          <Badge variant="outline" className="ml-1 font-normal">
            {CAPABILITY_PROFILE_COPY.tierBadge}
          </Badge>
        </CardTitle>
        <CardDescription>{CAPABILITY_PROFILE_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">
              {CAPABILITY_PROFILE_COPY.forming.headline}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {CAPABILITY_PROFILE_COPY.forming.body}
            </p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {shown.map((row) => (
                <li
                  key={row.capabilitySlug}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {masteryBand(row.mastery)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {confidenceTierLabel(row.confidenceTier)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {nextLabel ? (
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {CAPABILITY_PROFILE_COPY.nextLead}:
                </span>{" "}
                {nextLabel}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
