"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupStepMeta } from "@/lib/onboarding-stepper";

/**
 * U4.2 — the workspace-setup progress nav. A minimal, library-free `nav` that
 * shows each step as a number + label and marks the active one with
 * `aria-current="step"` (a11y). Completed steps (before the current one) are
 * clickable so a returning user can navigate back; upcoming steps are inert
 * until reached. Presentation only — the flow owns the step state.
 */
export function SetupStepper({
  steps,
  currentIndex,
  onSelect,
}: {
  steps: readonly SetupStepMeta[];
  currentIndex: number;
  /** Navigate to a step. Only completed steps (index < currentIndex) invoke it. */
  onSelect?: (index: number) => void;
}) {
  return (
    <nav aria-label="Setup progress" className="mx-auto w-full max-w-2xl">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isComplete = index < currentIndex;
          const isNavigable = isComplete && onSelect;

          const marker = (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                isCurrent
                  ? "border-primary bg-primary text-primary-foreground"
                  : isComplete
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground",
              )}
            >
              {isComplete ? <Check className="size-3.5" /> : index + 1}
            </span>
          );

          const label = (
            <span
              className={cn(
                "text-sm",
                isCurrent
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          );

          return (
            <li key={step.key} className="flex items-center gap-2">
              {isNavigable ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  // U5: completed steps are clickable back-nav — give them the
                  // ≥44px touch floor (min-h-11 invisible hit area).
                  className="flex min-h-11 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {marker}
                  {label}
                </button>
              ) : (
                <span
                  className="flex items-center gap-2 px-1 py-0.5"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {marker}
                  {label}
                </span>
              )}
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="hidden h-px w-6 bg-border sm:block"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
