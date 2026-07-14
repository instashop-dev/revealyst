import { Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CAPABILITY_COVERAGE_COPY } from "@/lib/capability-glossary";

/**
 * Team capability-coverage card (W7-6). Aggregate, COUNT-ONLY coaching themes for
 * managers: for each capability, how many of the team are at/above the mastery
 * threshold. The row prop carries NO person id or name — a per-person shape is
 * structurally impossible here, so no individual's mastery can leak. Rows are
 * already `MIN_PEOPLE`-floored by the caller (a capability below the floor is
 * absent, never a suppressed-but-implied number). Server-safe, pure props.
 */
export type CapabilityCoverageCardRow = {
  /** Stable key + display label — never a person identifier. */
  slug: string;
  label: string;
  /** People at/above the mastery threshold. */
  mastered: number;
  /** People with any state (≥ the MIN_PEOPLE floor by construction). */
  total: number;
};

export function CapabilityCoverageCard({
  rows,
}: {
  rows: readonly CapabilityCoverageCardRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" aria-hidden="true" />
          {CAPABILITY_COVERAGE_COPY.title}
        </CardTitle>
        <CardDescription>{CAPABILITY_COVERAGE_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {CAPABILITY_COVERAGE_COPY.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.slug}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"
              >
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-sm text-muted-foreground">
                  {row.mastered} of {row.total} {CAPABILITY_COVERAGE_COPY.peopleWord}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
