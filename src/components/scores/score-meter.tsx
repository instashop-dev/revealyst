import { Meter as MeterPrimitive } from "@base-ui/react/meter"

import { cn } from "@/lib/utils"

// Server-component-friendly: this file has no hooks/handlers of its own, so
// it needs no "use client" directive — @base-ui/react/meter's Root/Track/
// Indicator are themselves client components (each module carries its own
// "use client" boundary), and a server component may render a client
// component directly. Base UI's MeterRoot renders role="meter" with
// aria-valuemin/max/now/text out of the box (verified against
// node_modules/@base-ui/react/meter/root/MeterRoot.js, @base-ui/react
// 1.6.0) and MeterIndicator sizes itself from the value automatically, so
// this wrapper only needs to supply the visual track/fill classes that
// match the existing div-meter look in dashboard/score-card.tsx and
// score-card.tsx (h-2 / h-1.5 rounded track, rounded primary fill).

const sizeClasses = {
  sm: "h-1.5",
  md: "h-2",
} as const

export function ScoreMeter({
  value,
  label,
  max = 100,
  size = "md",
  className,
}: {
  value: number
  label: string
  max?: number
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <MeterPrimitive.Root
      data-slot="score-meter"
      value={value}
      min={0}
      max={max}
      aria-label={label}
      className={cn("w-full", className)}
    >
      <MeterPrimitive.Track
        data-slot="score-meter-track"
        className={cn(
          "block w-full overflow-hidden rounded-full bg-muted",
          sizeClasses[size]
        )}
      >
        <MeterPrimitive.Indicator
          data-slot="score-meter-indicator"
          className="block h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
        />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  )
}
