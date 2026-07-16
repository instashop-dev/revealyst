"use client";

import type { ComponentProps } from "react";
import { SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * U0.7 — the ONE place that decides which side app drawers open from: a
 * right-side sheet on desktop, a bottom sheet below the mobile breakpoint
 * (comfortable max-height + internal scroll, explicit close via Esc/button —
 * no gesture-only dismissal; both behaviors live on the Sheet primitive's
 * bottom variant). Consumed by the Data Confidence drawer, the capability
 * curriculum drawer, and any future drawer — never re-derive the side per
 * drawer (U0 review finding: the switch was copy-pasted per consumer).
 */
export function ResponsiveSheetContent(
  props: Omit<ComponentProps<typeof SheetContent>, "side">,
) {
  const isMobile = useIsMobile();
  return <SheetContent side={isMobile ? "bottom" : "right"} {...props} />;
}
