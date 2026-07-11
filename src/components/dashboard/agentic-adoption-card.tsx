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
 * F1.4 "Agentic adoption rate" (research M6): the org-level share of active
 * days on which an AI agent (not just autocomplete or chat) was used, with a
 * weekly trend and a delta vs the previous week. Server-safe — one typed data
 * prop, all math done in `src/lib/agentic-adoption.ts`.
 *
 * The two empty kinds are honest by design (G4): `noAgenticData` is "no
 * agent-capable telemetry yet" (Claude Code / Copilot / Cursor emit the flag;
 * OpenAI does not), NEVER a measured 0% adoption; `noActivity` is "nothing has
 * synced". Both render the why + what-fills-it copy from
 * `AGENTIC_ADOPTION_COPY`, never a teaser number.
 *
 * Aggregate-only: the data prop carries subject-day COUNTS, so this surface has
 * no per-person agentic ranking on either the team or personal view (F1.4
 * constraint; the personal view is an org of one, so the same aggregate IS the
 * viewer's own rate).
 */
export function AgenticAdoptionCard({ data }: { data: AgenticAdoption }) {
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
        </CardTitle>
        <CardDescription>
          Share of active days that used an AI agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {data.kind === "measured" ? (
          <MeasuredBody data={data} />
        ) : (
          <EmptyBody kind={data.kind} />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyBody({ kind }: { kind: "noActivity" | "noAgenticData" }) {
  const copy =
    kind === "noAgenticData"
      ? AGENTIC_ADOPTION_COPY.emptyNoAgentic
      : AGENTIC_ADOPTION_COPY.emptyNoActivity;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{copy.title}</p>
      <p className="text-muted-foreground">{copy.body}</p>
    </div>
  );
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
            {data.agenticDays} of {data.activeDays} active day
            {data.activeDays === 1 ? "" : "s"} used an agent
          </span>
        </div>
      </div>

      {data.trend.length >= 2 ? <Sparkline trend={data.trend} /> : null}

      {toolCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          Agent activity reported by {toolCount} connected tool
          {toolCount === 1 ? "" : "s"}. Tools that don&apos;t report agent
          activity aren&apos;t counted as agentic — the rate reflects only
          agent-capable tools.
        </p>
      ) : null}
    </>
  );
}

function DeltaBadge({ delta }: { delta: DeltaResult }) {
  if (delta.kind !== "delta") {
    // Weekly buckets never produce `notComparable`; `first` means only one
    // week of data — nothing to compare against yet.
    return <span className="text-xs text-muted-foreground">First week tracked</span>;
  }
  const { text, direction, srText } = formatDelta(delta);
  if (direction === "none") {
    return (
      <span className="text-xs text-muted-foreground">
        No change vs {delta.previousPeriodLabel}
        <span className="sr-only">{srText}</span>
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
        {text} pts vs {delta.previousPeriodLabel}
      </span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}

/**
 * A minimal, dependency-free trend line of the weekly rate. Pure SVG so it
 * stays server-safe; `preserveAspectRatio="none"` lets it stretch to the card
 * width. Values are the 0–100 weekly ratePct, so the y-axis is the full 0–100
 * range (no misleading auto-zoom). Decorative — the numbers above carry the
 * accessible meaning, so the SVG is aria-hidden.
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
