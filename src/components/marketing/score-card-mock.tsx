import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

// Static, clearly-illustrative replica of the /s/[token] share card for the
// landing hero. Values are fixed demo numbers — never sourced from data.
export function ScoreCardMock({
  label,
  scoreLabel,
  value,
  className,
  "aria-hidden": ariaHidden,
}: {
  label: string;
  scoreLabel: string;
  value: number;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <div
      aria-hidden={ariaHidden}
      className={cn(
        "flex w-64 flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center shadow-lg",
        className,
      )}
    >
      <BrandMark />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-base text-muted-foreground">{scoreLabel}</span>
      </div>
      <div className="flex items-end justify-center gap-1">
        <span className="font-heading text-6xl font-semibold tabular-nums">
          {value}
        </span>
        <span className="pb-2 text-base text-muted-foreground">/ 100</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Example card — scores are measured from real AI-tool usage, not
        self-reported.
      </p>
    </div>
  );
}
