import { InfoTip } from "@/components/info-tip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MaturityLevelValue } from "@/lib/maturity-glossary";
import {
  MATURITY_LEVEL_COPY,
  MATURITY_LEVEL_NONE_COPY,
  MATURITY_LEVELS,
} from "@/lib/maturity-glossary";
import { cn } from "@/lib/utils";

/**
 * The maturity level banner — the report's headline. Renders the modeled level
 * name + tagline + description, a L0→L4 scale with the current rung marked, and
 * the "data as of" line. The level is a MODELED reading over uncalibrated
 * thresholds (labeled as such), NOT a certified grade; a null level renders the
 * honest "not enough data" state, never a placeholder L0 (which is a measured
 * low, a different fact). Server-safe — pure props.
 */
export function MaturityLevelBanner({
  level,
  dataAsOf,
}: {
  level: MaturityLevelValue | null;
  dataAsOf: string | null;
}) {
  const copy = level === null ? MATURITY_LEVEL_NONE_COPY : MATURITY_LEVEL_COPY[level];
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {level !== null ? (
              <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">
                Level {level}
              </span>
            ) : null}
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {copy.name}
            </h2>
            <Badge variant="outline" className="font-normal">
              Modeled
            </Badge>
            <InfoTip
              label="AI maturity level"
              short="A modeled reading of usage sophistication across three measured axes — a leading indicator, not a measure of realized productivity. Levels use uncalibrated thresholds, so they're directional."
            />
          </div>
          <p className="text-sm font-medium text-foreground">{copy.tagline}</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>

        <LevelScale current={level} />

        {dataAsOf ? (
          <p className="text-xs text-muted-foreground">
            Data as of{" "}
            {new Date(dataAsOf).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
            . Covers the last 12 complete weeks; today is excluded while it's
            still in progress.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No successful sync yet — connect a tool to populate this report.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LevelScale({ current }: { current: MaturityLevelValue | null }) {
  return (
    <ol className="flex gap-1" aria-label="Maturity level scale, level 0 to 4">
      {MATURITY_LEVELS.map((lvl) => {
        const active = current === lvl;
        return (
          <li key={lvl} className="flex flex-1 flex-col gap-1">
            <div
              className={cn(
                "h-1.5 rounded-full",
                active ? "bg-primary" : "bg-muted",
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-[10px] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              L{lvl} {MATURITY_LEVEL_COPY[lvl].name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
