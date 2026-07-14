"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * A generic progressive-disclosure wrapper: a labelled trigger row that reveals
 * its (server-rendered) children. Mirrors the shipped `DiagnosticDetails`
 * pattern so the app has one disclosure look, but is content-agnostic — it takes
 * plain strings, not a glossary module — so any surface can fold its secondary
 * detail behind it. Collapsed by default (the common case: keep the headline
 * light, detail one click away).
 */
export function CollapsibleSection({
  label,
  description,
  defaultOpen = false,
  children,
}: {
  label: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border">
      <CollapsibleTrigger
        className="group flex w-full items-center justify-between gap-2 p-4 text-left"
        aria-label={label}
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {description ? (
            <span className="text-xs text-muted-foreground">{description}</span>
          ) : null}
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 p-4 pt-0">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
