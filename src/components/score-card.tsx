import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AttributionLevel } from "@/contracts/attribution";

// Presentational self-view score card (W2-H): a 0–100 value with a meter and
// an optional component drill-down. A `null` value means the score isn't
// computed yet (never a fabricated 0). A component with `normalized: null` was
// omitted for lack of data (e.g. a ratio with no rows) — shown as "not enough
// data", never 0. A non-person attribution is surfaced as an honesty caveat.

export type ScoreComponentView = {
  key: string;
  label: string;
  /** 0..100, or null when the component was omitted (not enough data). */
  normalized: number | null;
};

function Meter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ScoreCard({
  title,
  description,
  value,
  attribution,
  components,
}: {
  title: string;
  description: string;
  value: number | null;
  attribution?: AttributionLevel;
  components?: ScoreComponentView[];
}) {
  const computed = value !== null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {computed && attribution && attribution !== "person" && (
            <Badge variant="outline" title={`Attributed at ${attribution} level`}>
              Likely undercounted
            </Badge>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {computed ? (
          <>
            <div className="flex items-end gap-1">
              <span className="font-heading text-4xl font-semibold tabular-nums">
                {Math.round(value)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
            </div>
            <Meter value={value} />
            {components && components.length > 0 && (
              <dl className="flex flex-col gap-2.5 pt-1">
                {components.map((c) => (
                  <div key={c.key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="tabular-nums">
                        {c.normalized === null ? "—" : Math.round(c.normalized)}
                      </dd>
                    </div>
                    {c.normalized === null ? (
                      <p className="text-xs text-muted-foreground">
                        Not enough data yet
                      </p>
                    ) : (
                      <Meter value={c.normalized} />
                    )}
                  </div>
                ))}
              </dl>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Computing from your connected data — check back shortly.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
