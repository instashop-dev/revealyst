import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import type { AttributionLevel } from "@/contracts/attribution";
import { ATTRIBUTION_GLOSSARY } from "@/lib/metrics-glossary";
import {
  interpretScore,
  type ComponentDetailRow,
  type DeltaResult,
} from "@/lib/score-insights";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { InfoTip } from "@/components/info-tip";
import { ScoreMeter } from "@/components/scores/score-meter";

// The unified score card for the metrics-UX redesign (personal self-view and
// team dashboard both render through this one component + its two adapters
// in score-card-model.ts). Server-safe: InfoTip and Collapsible carry their
// own "use client" boundaries, so this file needs no directive of its own —
// a server component may render client components directly.
//
// Honesty rules baked into rendering (invariant b): `value === null` never
// shows a fabricated 0 — it renders the computing state. A component row
// with `omitted: true` never shows a 0 meter — it renders "Not enough data
// yet" with an em-dash placeholder instead.

export type ScoreCardData = {
  slug: "adoption" | "fluency" | "efficiency";
  title: string;
  /** One-liner surfaced via the header InfoTip, not printed directly. */
  shortWhat: string;
  /** `null` renders the "still computing" empty state — never a fabricated 0. */
  value: number | null;
  attribution?: AttributionLevel | null;
  /** `undefined`/`null` renders no delta chip. */
  delta?: DeltaResult | null;
  componentRows: ComponentDetailRow[];
  methodologyHref: string;
  footer?: ReactNode;
  /** e.g. a share button, rendered top-right alongside the attribution badge. */
  headerSlot?: ReactNode;
};

function DeltaChip({ delta, title }: { delta: DeltaResult; title: string }) {
  if (delta.kind === "first") {
    return (
      <span className="text-xs text-muted-foreground">First scored period</span>
    );
  }
  if (delta.kind === "notComparable") {
    const reason =
      delta.reason === "grain"
        ? "The previous period covered a different number of days, so comparing the two directly could be misleading."
        : "The score definition changed since the previous period, so comparing the two directly could be misleading.";
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        Not comparable to last period
        <InfoTip label="Why not comparable" short={reason} />
      </span>
    );
  }
  const rounded = Math.round(delta.delta);
  const up = rounded >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        up ? "text-primary" : "text-destructive",
      )}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span aria-hidden="true">
        {up ? "+" : ""}
        {rounded} vs {delta.previousPeriodLabel}
      </span>
      <span className="sr-only">
        {title} {up ? "increased" : "decreased"} by {Math.abs(rounded)} point
        {Math.abs(rounded) === 1 ? "" : "s"} versus the previous period (
        {delta.previousPeriodLabel}).
      </span>
    </span>
  );
}

function ComponentRow({ row }: { row: ComponentDetailRow }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{row.label}</span>
        <InfoTip label={row.label} short={row.calcSimple} />
      </div>
      {row.omitted ? (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-1.5 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] leading-none text-muted-foreground"
          >
            &mdash;
          </span>
          <span className="text-xs text-muted-foreground">Not enough data yet</span>
          <InfoTip
            label="Why this is missing"
            short="This part needs both of its inputs measured. Missing data is never counted as zero."
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ScoreMeter
            value={row.normalized ?? 0}
            label={`${row.label} component`}
            size="sm"
            className="flex-1"
          />
          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {Math.round(row.normalized ?? 0)}/100 · counts for{" "}
            {Math.round(row.weight * 100)}% of the score
          </span>
        </div>
      )}
    </div>
  );
}

function ComponentBreakdown({ rows }: { rows: ComponentDetailRow[] }) {
  if (rows.length === 0) return null;
  const anyOmitted = rows.some((row) => row.omitted);
  return (
    <Collapsible className="flex flex-col gap-2">
      <CollapsibleTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "group w-fit gap-1.5 px-1.5 text-muted-foreground hover:text-foreground",
        )}
      >
        How this score is calculated
        <ChevronDown className="size-3.5 shrink-0 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 pt-1 pb-0.5">
          {rows.map((row) => (
            <ComponentRow key={row.key} row={row} />
          ))}
          {anyOmitted ? (
            <p className="text-xs text-muted-foreground">
              Parts without enough data are left out of the total — never
              counted as zero.
            </p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ScoreCard({ data }: { data: ScoreCardData }) {
  const computed = data.value !== null;
  const attribution =
    data.attribution && data.attribution !== "person" ? data.attribution : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{data.title}</CardTitle>
            <InfoTip
              label={data.title}
              short={data.shortWhat}
              learnMoreHref={data.methodologyHref}
            />
          </div>
          {(attribution || data.headerSlot) && (
            <div className="flex items-center gap-2">
              {attribution ? (
                <Badge variant="outline" className="gap-1 pr-1.5">
                  {ATTRIBUTION_GLOSSARY[attribution].label}
                  <InfoTip
                    label={ATTRIBUTION_GLOSSARY[attribution].label}
                    short={ATTRIBUTION_GLOSSARY[attribution].shortWhat}
                    detail={ATTRIBUTION_GLOSSARY[attribution].caveat}
                  />
                </Badge>
              ) : null}
              {data.headerSlot}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {computed ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <div className="flex items-baseline gap-1">
                <span className="font-heading text-4xl font-semibold tabular-nums">
                  {Math.round(data.value as number)}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              {data.delta ? <DeltaChip delta={data.delta} title={data.title} /> : null}
            </div>
            <ScoreMeter value={data.value as number} label={`${data.title} score`} />
            <p className="text-sm text-muted-foreground">
              {interpretScore(data.value as number).guidance}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              Computing from your connected data — check back shortly.
            </p>
            <Link
              href={data.methodologyHref}
              className="w-fit text-xs text-primary underline-offset-4 hover:underline"
            >
              How scores work →
            </Link>
          </div>
        )}
        <ComponentBreakdown rows={data.componentRows} />
        {data.footer ? (
          <div className="border-t pt-3 text-sm text-muted-foreground">
            {data.footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
