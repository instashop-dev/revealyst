import type { CorrelationResult } from "@/lib/correlation";
import type { Narrative } from "@/lib/narrative";
import {
  CORRELATION_COPY,
  CORRELATION_PAIR_LABELS,
  NARRATIVE_CARD_COPY,
} from "@/lib/narrative-copy";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * F2.4 period summary (research I7 + I4). Renders the template-composed
 * plain-prose narrative (all sentence selection done in src/lib/narrative.ts)
 * plus the "moved together" directional panel (math in src/lib/correlation.ts,
 * copy in narrative-copy.ts). Server-safe — typed data props only, no logic.
 *
 * Honesty (G4): when nothing is measurable — no narrative sentences AND no
 * measured pair — the card renders an honest empty state (why it's empty + what
 * fills it), never a teaser. The "moved together" block is strictly directional
 * and non-causal, with the standing disclaimer always shown beneath it.
 */
export function PeriodNarrativeCard({
  narrative,
  correlations,
}: {
  narrative: Narrative;
  correlations: readonly CorrelationResult[];
}) {
  const measuredPairs = correlations.filter(
    (c): c is Extract<CorrelationResult, { kind: "measured" }> =>
      c.kind === "measured",
  );
  const hasNarrative = narrative.sentences.length > 0;

  if (!hasNarrative && measuredPairs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{NARRATIVE_CARD_COPY.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {NARRATIVE_CARD_COPY.empty}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{NARRATIVE_CARD_COPY.title}</CardTitle>
        <CardDescription>{NARRATIVE_CARD_COPY.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {hasNarrative ? (
          <p className="leading-relaxed">{narrative.sentences.join(" ")}</p>
        ) : null}

        {measuredPairs.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="font-medium">{CORRELATION_COPY.title}</p>
            <p className="text-muted-foreground">{CORRELATION_COPY.intro}</p>
            <ul className="flex flex-col gap-1">
              {measuredPairs.map((pair) => (
                <li key={pair.pair} className="tabular-nums">
                  {CORRELATION_COPY.measuredLine({
                    joint: CORRELATION_PAIR_LABELS[pair.pair].joint,
                    agreeing: pair.agreeingWeeks,
                    comparable: pair.comparableWeeks,
                  })}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {CORRELATION_COPY.disclaimer}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
