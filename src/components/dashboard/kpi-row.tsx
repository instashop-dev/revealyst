import type { ReactNode } from "react";
import { ConfidencePill } from "@/components/confidence-pill";
import { InfoTip } from "@/components/info-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConfidenceTier } from "@/lib/maturity";
import { CONFIDENCE_TIER_LABEL } from "@/lib/maturity-glossary";

/**
 * P0b — the four compact indicators at the top of the Manager Command Center
 * (Team Manager Dashboard plan §3 P0). A tight KPI row that replaces the old
 * three full-size score cards + movement + spend line as the FIRST thing a
 * manager reads. Pure presentation: every value is computed upstream from data
 * already in the dashboard view (no new read), and each tile shows either a
 * measured value or an honest "—" / "Not enough data yet" (invariant b — never
 * a fabricated number). Count-only; no per-person data reaches this surface.
 */
export type KpiTileData = {
  /** Manager-language label (never a jargon slug). */
  label: string;
  /** Plain-English InfoTip explaining the tile in one sentence. */
  info: string;
  /** Honesty tier for the paired confidence badge. */
  tier: ConfidenceTier;
  /** The headline value — a rounded number or "—" when withheld. */
  value: ReactNode;
  /** A short qualifying sub-line (denominator, unit, or the withheld reason). */
  sub?: ReactNode;
};

export function KpiRow({ tiles }: { tiles: readonly KpiTileData[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <KpiTile key={tile.label} tile={tile} />
      ))}
    </div>
  );
}

function KpiTile({ tile }: { tile: KpiTileData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {tile.label}
          <InfoTip label={tile.label} short={tile.info} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-heading text-3xl font-semibold tabular-nums">
              {tile.value}
            </span>
            <ConfidencePill
              tier={tile.tier}
              label={CONFIDENCE_TIER_LABEL[tile.tier]}
            />
          </div>
          {tile.sub ? (
            <span className="text-xs text-muted-foreground">{tile.sub}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
