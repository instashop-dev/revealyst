"use client";

import { useState } from "react";
import { Check, CircleSlash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveSheetContent } from "@/components/responsive-sheet-content";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ScopeClaims } from "@/connectors/scope-claims";

/**
 * U2 — the "what this connector can and can't measure" disclosure for a
 * connections card: a condensed two-line summary (the strongest thing it can
 * see + the most important thing it can't) plus a drawer with the full lists.
 *
 * Presentation only: it renders whatever `claims` it is handed. The claims are
 * a fact-checked CLAIM SURFACE sourced from src/connectors/scope-claims.ts —
 * this component never re-types vendor prose (W3-P discipline).
 */
export function ConnectorScope({
  vendorName,
  claims,
}: {
  vendorName: string;
  claims: ScopeClaims;
}) {
  const [open, setOpen] = useState(false);
  const topMeasure = claims.measures[0];
  const topGap = claims.cannotMeasure[0];

  return (
    <div className="flex w-full flex-col gap-2">
      <ul className="flex flex-col gap-1 text-sm">
        {topMeasure ? (
          <li className="flex items-start gap-2 text-muted-foreground">
            <Check
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-500"
            />
            <span>{topMeasure}</span>
          </li>
        ) : null}
        {topGap ? (
          <li className="flex items-start gap-2 text-muted-foreground">
            <CircleSlash
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span>{topGap}</span>
          </li>
        ) : null}
      </ul>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            // U5: standalone disclosure link — invisible min-h-11 hit area
            // reaches the ≥44px touch floor without adding visible chrome.
            <Button
              variant="link"
              size="sm"
              className="min-h-11 self-start p-0"
            />
          }
        >
          What {vendorName} can and can&apos;t measure
        </SheetTrigger>
        {/* U0.7: right on desktop, bottom sheet on mobile — the side switch
            lives in ResponsiveSheetContent, never per drawer. */}
        <ResponsiveSheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>What {vendorName} can and can&apos;t measure</SheetTitle>
            <SheetDescription>
              We only ever claim what this connector can actually see. Known
              gaps are shown here rather than hidden.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4 pt-0">
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Revealyst can see
              </h3>
              <ul className="flex flex-col gap-2">
                {claims.measures.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-sm">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-500"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                It can&apos;t see
              </h3>
              <ul className="flex flex-col gap-2">
                {claims.cannotMeasure.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <CircleSlash
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>

            <Button
              variant="outline"
              size="sm"
              className="min-h-11 self-start"
              nativeButton={false}
              render={<a href="/legal/what-we-collect" />}
            >
              See exactly what we collect
            </Button>
          </div>
        </ResponsiveSheetContent>
      </Sheet>
    </div>
  );
}
