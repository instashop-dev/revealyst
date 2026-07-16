import { Info, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCents } from "@/lib/format";
import { MANAGER_SPEND_COPY } from "@/lib/manager-capability-copy";
import type { ManagerSpendView } from "@/lib/manager-spend-view";

/**
 * The manager per-person SPEND section (P3-B, ADR 0045 spend half). Renders ONLY
 * when the page's spend loader returned `ok` (the per-team admin toggle is on);
 * otherwise the page omits it entirely — this component never renders a teaser.
 *
 * Honesty by shape (invariant b): vendor-reported and estimated spend are shown
 * in SEPARATE rows and never blended; the per-model block is TOKEN volume, never
 * dollars (no cost-per-model exists anywhere here); the allocation-confidence
 * disclosure is a plain-English count line; and the cost≠capability framing is a
 * visible, always-on note. Server-safe, pure props.
 */

function money(cents: number): string {
  return formatCents(cents);
}

export function ManagerSpendSection({ spend }: { spend: ManagerSpendView }) {
  const { reported, estimated, modelVolume, coverage } = spend;
  const hasAttributable =
    coverage.attributableSubjectCount > 0 &&
    (reported.mtdCents > 0 ||
      reported.priorCents > 0 ||
      estimated.mtdCents > 0 ||
      estimated.priorCents > 0);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-primary" aria-hidden="true" />
          {MANAGER_SPEND_COPY.heading}
        </CardTitle>
        {/* cost≠capability law, stated on the surface (ADR 0045). */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{MANAGER_SPEND_COPY.contextNote}</span>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasAttributable ? (
          <p className="text-sm text-muted-foreground">
            {MANAGER_SPEND_COPY.empty}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {" "}
              </span>
              <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {MANAGER_SPEND_COPY.mtdLabel}
              </span>
              <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {MANAGER_SPEND_COPY.priorLabel}
              </span>

              <span className="text-sm font-medium">
                {MANAGER_SPEND_COPY.reportedLabel}
              </span>
              <span className="text-right text-sm tabular-nums">
                {money(reported.mtdCents)}
              </span>
              <span className="text-right text-sm tabular-nums">
                {money(reported.priorCents)}
              </span>

              {/* Estimated is a SEPARATE row — never summed with reported. */}
              <span className="text-sm font-medium">
                {MANAGER_SPEND_COPY.estimatedLabel}
              </span>
              <span className="text-right text-sm tabular-nums">
                {money(estimated.mtdCents)}
              </span>
              <span className="text-right text-sm tabular-nums">
                {money(estimated.priorCents)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {MANAGER_SPEND_COPY.reportedSub} {MANAGER_SPEND_COPY.estimatedSub}
            </p>
          </>
        )}

        {/* Allocation-confidence / coverage disclosure — always shown, even when
         * there's nothing attributable, so the manager knows why. */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{MANAGER_SPEND_COPY.coverageLine(coverage)}</span>
        </p>

        {modelVolume.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-sm font-medium">{MANAGER_SPEND_COPY.modelHeading}</p>
            <ul className="flex flex-col gap-1.5">
              {modelVolume.map((m) => (
                <li
                  key={m.model}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="truncate">{m.model}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {Math.round(m.sharePct)}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {MANAGER_SPEND_COPY.modelSub}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
