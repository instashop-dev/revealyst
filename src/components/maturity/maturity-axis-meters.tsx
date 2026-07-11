import { InfoTip } from "@/components/info-tip";
import { ScoreMeter } from "@/components/scores/score-meter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MaturityAxes, MaturityAxis } from "@/lib/maturity";
import type { MaturityAxisKey } from "@/lib/maturity-glossary";
import { MATURITY_AXIS_COPY } from "@/lib/maturity-glossary";

// The three measured axes (Breadth / Depth / Consistency) as score-card-style
// meters. Each axis VALUE is measured from real usage; the meter shows 0–100 or
// an honest "not enough data" state (never a floored 0) when no component had a
// denominator. The LEVEL these roll up into is modeled — that disclosure lives
// on the banner; here the numbers themselves are measured.

const AXIS_ORDER: MaturityAxisKey[] = ["breadth", "depth", "consistency"];

export function MaturityAxisMeters({ axes }: { axes: MaturityAxes }) {
  const byKey: Record<MaturityAxisKey, MaturityAxis> = {
    breadth: axes.breadth,
    depth: axes.depth,
    consistency: axes.consistency,
  };
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {AXIS_ORDER.map((key) => (
        <AxisMeterCard key={key} axisKey={key} axis={byKey[key]} />
      ))}
    </div>
  );
}

function AxisMeterCard({
  axisKey,
  axis,
}: {
  axisKey: MaturityAxisKey;
  axis: MaturityAxis;
}) {
  const copy = MATURITY_AXIS_COPY[axisKey];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {copy.label}
          <InfoTip label={copy.label} short={copy.shortWhat} detail={copy.inputs} />
        </CardTitle>
        <CardDescription>{copy.what}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {axis.available ? (
          <>
            <div className="flex items-end justify-between">
              <span className="font-heading text-3xl font-semibold tabular-nums">
                {Math.round(axis.value)}
              </span>
              <span className="text-xs text-muted-foreground">out of 100</span>
            </div>
            <ScoreMeter value={axis.value} label={`${copy.label} score`} />
          </>
        ) : (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>Not enough data to score this axis yet.</p>
            <p>What feeds it: {copy.inputs}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
