"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DIAGNOSTIC_COPY } from "@/lib/companion-glossary";

/**
 * Demotes the three raw 0–100 ScoreCards behind an expander (W5-C deliverable
 * 4). Collapsed by DEFAULT so the raw score is never the headline of the
 * default render — the level + next step above are. The score cards are passed
 * as `children` (server-rendered) so this thin client wrapper adds only the
 * disclosure interaction, no data. No blended "AI health" number is introduced
 * anywhere (errata §1.2(9)).
 */
export function DiagnosticDetails({ children }: { children: ReactNode }) {
  return (
    <Collapsible defaultOpen={false} className="rounded-lg border">
      <CollapsibleTrigger
        className="group flex w-full items-center justify-between gap-2 p-4 text-left"
        aria-label={DIAGNOSTIC_COPY.triggerLabel}
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            {DIAGNOSTIC_COPY.triggerLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {DIAGNOSTIC_COPY.description}
          </span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-4 pt-0">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
