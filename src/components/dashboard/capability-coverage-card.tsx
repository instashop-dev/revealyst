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
  /** DEPTH: team mean mastery in [0,1] (T3.3) — null when not supplied. */
  meanMastery?: number | null;
  /** SPREAD: population stddev of mastery in [0,1] (T3.3) — null when absent. */
  spread?: number | null;
};

/** Plain-English band for the dispersion statistic (T3.3): a small stddev means
 * the team is at a similar level; a large one means it's uneven. Aggregate only. */
function spreadWord(spread: number): string {
  if (spread < 0.1) return CAPABILITY_COVERAGE_COPY.spreadEven;
  if (spread < 0.2) return CAPABILITY_COVERAGE_COPY.spreadMixed;
  return CAPABILITY_COVERAGE_COPY.spreadUneven;
}

export function CapabilityCoverageCard({
  rows,
  floorNote,
}: {
  rows: readonly CapabilityCoverageCardRow[];
  /** Optional small-group suppression note (U4.1). Below-floor capabilities are
   * dropped from `rows` entirely by the caller, so a standing footer states the
   * rule — otherwise the omission is silent. Count-free by construction. */
  floorNote?: string;
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
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {CAPABILITY_COVERAGE_COPY.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.slug}
                className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {row.mastered} of {row.total}{" "}
                    {CAPABILITY_COVERAGE_COPY.peopleWord}
                  </span>
                </div>
                {/* T3.3: depth (team average) + spread — count-only, shown only
                    when the aggregate stats are present. */}
                {row.meanMastery !== null && row.meanMastery !== undefined ? (
                  <span className="text-xs text-muted-foreground">
                    {CAPABILITY_COVERAGE_COPY.depthLabel(
                      Math.round(row.meanMastery * 100),
                    )}
                    {row.spread !== null && row.spread !== undefined
                      ? ` · ${spreadWord(row.spread)}`
                      : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {floorNote ? (
          <p className="text-xs text-muted-foreground">{floorNote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
