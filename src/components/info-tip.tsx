"use client"

import Link from "next/link"
import { Info } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * A small "i" icon button that opens a popover with a plain-language
 * explanation of a metric/score. Takes plain strings only — it must not
 * import a glossary module, so it stays reusable across dashboard, score
 * card, and any future surface without coupling to a specific content model.
 */
export function InfoTip({
  label,
  short,
  detail,
  learnMoreHref,
  className,
}: {
  label: string
  short: string
  detail?: string
  learnMoreHref?: string
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-slot="info-tip-trigger"
        aria-label={`About ${label}`}
        className={cn(
          // Visual icon stays small (size-3.5, below); the hit target grows
          // to the 24px accessibility minimum via padding + a negative
          // margin, so surrounding layout doesn't shift.
          "-m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        )}
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent data-slot="info-tip-content" className="max-w-72 text-sm">
        <PopoverTitle className="font-medium text-foreground">{label}</PopoverTitle>
        <PopoverDescription className="mt-1 text-muted-foreground">{short}</PopoverDescription>
        {detail ? (
          <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
        ) : null}
        {learnMoreHref ? (
          <Link
            href={learnMoreHref}
            className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
          >
            How scores work →
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
