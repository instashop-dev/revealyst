import type { ReactNode } from "react";
import type { AgenticAdoption, AgenticTrendPoint } from "@/lib/agentic-adoption";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AGENTIC_ADOPTION_COPY, methodologyAnchor } from "@/lib/metrics-glossary";
import { formatDelta, type DeltaResult } from "@/lib/score-insights";
import { cn } from "@/lib/utils";

/**
 * F1.4 "Agentic adoption rate" (research M6): the org-level share of AI-active
 * person-days on which an AI agent (not just autocomplete or chat) was used,
 * over the last 12 weeks, with a weekly trend and a delta between the last two
 * COMPLETE weeks. Server-safe — one typed data prop, all math done in
 * `src/lib/agentic-adoption.ts`.
 *
 * Honesty (G4 / review F2, F3):
 * - `noAgenticData` is "no agent-capable telemetry yet" (Claude Code / Copilot
 *   / Cursor emit the flag; OpenAI does not), NEVER a measured 0% adoption.
 * - `noActivity` with unresolved subjects is "usage exists but isn't linked to
 *   people yet" — its own state, not "no activity".
 * - The incomplete current week renders as a labeled "week to date" line and
 *   never enters the sparkline or the delta.
 * - Unresolved-subject exclusions are disclosed on the measured card.
 *
 * Aggregate-only: the data prop carries person-day COUNTS, so this surface has
 * no per-person agentic ranking on either the team or personal view (F1.4
 * constraint; the personal view is an org of one, so the aggregate IS the
 * viewer's own rate).
 */
export function AgenticAdoptionCard({
  data,
  qualifier,
}: {
  data: AgenticAdoption;
  /** Optional inline data-confidence qualifier (e.g. a "Partial" chip) rendered
   * beside the title when a live disclosure affects the activity totals. */
  qualifier?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {AGENTIC_ADOPTION_COPY.title}
          <InfoTip
            label={AGENTIC_ADOPTION_COPY.title}
            short={AGENTIC_ADOPTION_COPY.shortWhat}
            detail={AGENTIC_ADOPTION_COPY.detail}
            learnMoreHref={`/methodology#${methodologyAnchor("agent_active")}`}
          />
          {qualifier}
        </CardTitle>
        <CardDescription>
          Share of AI-active days that used an agent —{" "}
          {AGENTIC_ADOPTION_COPY.windowLabel}, identity-resolved people only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {data.kind === "measured" ? (
          <MeasuredBody data={data} />
        ) : (
          <EmptyBody data={data} />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyBody({
  data,
}: {
  data: Extract<AgenticAdoption, { kind: "noActivity" | "noAgenticData" }>;
}) {
  // "Nothing linked to a person yet" is a different fact from "nothing
  // synced" — usage exists, it just can't be honestly attributed to people.
  const copy =
    data.kind === "noAgenticData"
      ? AGENTIC_ADOPTION_COPY.emptyNoAgentic
      : data.unresolvedSubjects > 0
        ? AGENTIC_ADOPTION_COPY.emptyUnresolvedOnly
        : AGENTIC_ADOPTION_COPY.emptyNoActivity;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{copy.title}</p>
      <p className="text-muted-foreground">{copy.body}</p>
    </div>
  );
}

function unresolvedNote(count: number): string {
  return `${count} account${count === 1 ? "" : "s"} with usage in this window ${
    count === 1 ? "isn't" : "aren't"
  } linked to a person yet and ${count === 1 ? "isn't" : "aren't"} included.`;
}

function MeasuredBody({
  data,
}: {
  data: Extract<AgenticAdoption, { kind: "measured" }>;
}) {
  const toolCount = data.coveragePerVendor.length;
  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <span className="font-heading text-4xl font-semibold tabular-nums">
          {Math.round(data.ratePct)}%
        </span>
        <div className="flex flex-col pb-1">
          <DeltaBadge delta={data.delta} />
          <span className="text-xs text-muted-foreground">
            {data.agenticDays} of {data.activeDays} AI-active person-day
            {data.activeDays === 1 ? "" : "s"} used an agent
          </span>
        </div>
      </div>

      {data.trend.length >= 2 ? <Sparkline trend={data.trend} /> : null}

      {data.weekToDate ? (
        <p className="text-xs text-muted-foreground">
          Week to date ({data.weekToDate.label}):{" "}
          <span className="tabular-nums">
            {Math.round(data.weekToDate.ratePct)}%
          </span>{" "}
          — {data.weekToDate.agenticDays} of {data.weekToDate.activeDays} day
          {data.weekToDate.activeDays === 1 ? "" : "s"}. Not compared against
          full weeks until the week completes.
        </p>
      ) : null}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {toolCount > 0 ? (
          <p>
            Agent activity reported by {toolCount} connected tool
            {toolCount === 1 ? "" : "s"}. {AGENTIC_ADOPTION_COPY.toolsNote}
          </p>
        ) : null}
        {data.unresolvedSubjects > 0 ? (
          <p>{unresolvedNote(data.unresolvedSubjects)}</p>
        ) : null}
      </div>
    </>
  );
}

function DeltaBadge({ delta }: { delta: DeltaResult }) {
  if (delta.kind !== "delta") {
    // Weekly buckets never produce `notComparable`; `first` means fewer than
    // two complete weeks — nothing to compare against yet.
    return (
      <span className="text-xs text-muted-foreground">
        First full week tracked
      </span>
    );
  }
  // `formatDelta`'s srText says "Score …" — wrong noun for a rate card
  // (review F6), so only its rounding/direction/text conventions are reused
  // and the screen-reader sentence is written for this card.
  const { text, direction } = formatDelta(delta);
  if (direction === "none") {
    return (
      <span className="text-xs text-muted-foreground">
        No change vs {delta.previousPeriodLabel}
        <span className="sr-only">
          Agentic adoption is unchanged versus the previous week (
          {delta.previousPeriodLabel}).
        </span>
      </span>
    );
  }
  const up = direction === "up";
  const magnitude = Math.abs(Math.round(delta.delta));
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        up ? "text-primary" : "text-destructive",
      )}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span aria-hidden="true">
        {text} pts vs {delta.previousPeriodLabel}
      </span>
      <span className="sr-only">
        Agentic adoption {up ? "increased" : "decreased"} by {magnitude}{" "}
        percentage point{magnitude === 1 ? "" : "s"} versus the previous week (
        {delta.previousPeriodLabel}).
      </span>
    </span>
  );
}

/**
 * A minimal, dependency-free trend line of the weekly rate — COMPLETE weeks
 * only (the partial current week renders as the labeled "week to date" line
 * instead, review F3). Pure SVG so it stays server-safe;
 * `preserveAspectRatio="none"` lets it stretch to the card width. Values are
 * the 0–100 weekly ratePct, so the y-axis is the full 0–100 range (no
 * misleading auto-zoom). Decorative — the numbers above carry the accessible
 * meaning, so the SVG is aria-hidden.
 */
function Sparkline({ trend }: { trend: readonly AgenticTrendPoint[] }) {
  const w = 100;
  const h = 28;
  const n = trend.length;
  const points = trend
    .map((p, i) => {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = h - (Math.max(0, Math.min(100, p.ratePct)) / 100) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-8 w-full text-primary"
        aria-hidden="true"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{trend[0].label}</span>
        <span>{trend[n - 1].label}</span>
      </div>
    </div>
  );
}
