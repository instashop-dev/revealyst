import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import type { AttributionLevel } from "@/contracts/attribution";
import { ATTRIBUTION_GLOSSARY } from "@/lib/metrics-glossary";
import {
  formatDelta,
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
  CardDescription,
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
        ? "The previous period covers a different kind of period (for example weekly vs monthly), so comparing the two directly could be misleading."
        : "The score definition changed since the previous period, so comparing the two directly could be misleading.";
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        Not comparable to last period
        <InfoTip label="Why not comparable" short={reason} />
      </span>
    );
  }
  const { text, direction, srText } = formatDelta(delta);
  if (direction === "none") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        No change vs previous period
        <span className="sr-only">
          {title}: {srText}
        </span>
      </span>
    );
  }
  const up = direction === "up";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        up ? "text-primary" : "text-destructive",
      )}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span aria-hidden="true">
        {text} vs {delta.previousPeriodLabel}
      </span>
      <span className="sr-only">
        {title}: {srText}
      </span>
    </span>
  );
}

/** The omitted-row explanation differs by component shape (invariant b — the
 * honesty story is different for each): a ratio needs both of its inputs
 * measured and is never floored to 0, while a plain count simply has no rows
 * recorded yet. */
function omittedReason(kind: ComponentDetailRow["kind"]): string {
  return kind === "ratio"
    ? "This rate needs both of its inputs measured. Missing data is never counted as zero."
    : "No data recorded for this yet.";
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
            label={`why ${row.label} is missing`}
            short={omittedReason(row.kind)}
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
          {attribution ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 pr-1.5">
                {ATTRIBUTION_GLOSSARY[attribution].label} — not per-person
                <InfoTip
                  label={ATTRIBUTION_GLOSSARY[attribution].label}
                  short={ATTRIBUTION_GLOSSARY[attribution].shortWhat}
                  detail={ATTRIBUTION_GLOSSARY[attribution].caveat}
                />
              </Badge>
            </div>
          ) : null}
        </div>
        {/* Always-visible one-liner (not just via the InfoTip popover) — the
         * two pre-redesign cards both surfaced a short description without
         * requiring a click; the InfoTip stays for the popover's extra
         * "how calculated" detail + methodology link, not as a replacement. */}
        <CardDescription>{data.shortWhat}</CardDescription>
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
            {data.componentRows.length > 0 &&
            data.componentRows.some((row) => row.omitted) ? (
              <span className="text-xs text-muted-foreground">
                {data.componentRows.filter((row) => !row.omitted).length} of{" "}
                {data.componentRows.length} parts measured
              </span>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {/* Band on the same rounded number the headline displays, not
               * the raw value — at 39.6 the headline reads "40", so the
               * guidance must be the 40-69 band's, not the sub-40 band's
               * (invariant b: the card can't show a number and a
               * contradicting story about that number in the same breath). */}
              {interpretScore(Math.round(data.value as number), data.slug).guidance}
              {data.componentRows.length > 0
                ? " The breakdown shows what's driving this."
                : ""}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              Not enough data yet — this score appears once your connected
              tools report the data it needs.
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
