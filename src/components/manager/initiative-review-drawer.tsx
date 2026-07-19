"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ResponsiveSheetContent } from "@/components/responsive-sheet-content";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.initiatives;

type Outcome = "improved" | "unchanged" | "worsened" | "inconclusive";

/**
 * The outcome-review drawer (TMD P3, ADR 0062). Owner/admin only (gated by the
 * caller). Shows the MEASURED before/after (baseline → now vs target — no causal
 * claim) and lets the owner record an outcome or stop the initiative. Posts to
 * the owner-or-admin `/api/initiatives/:id/review` endpoint and refreshes.
 */
export function InitiativeReviewDrawer({
  initiativeId,
  title,
  metricLabel,
  baseline,
  current,
  target,
  open,
  onOpenChange,
}: {
  initiativeId: string;
  title: string;
  metricLabel: string | null;
  baseline: number | null;
  current: number | null;
  target: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>("improved");
  const [saving, setSaving] = useState<null | "complete" | "stop">(null);

  async function submit(body: unknown, kind: "complete" | "stop") {
    setSaving(kind);
    try {
      const res = await fetch(
        `/api/initiatives/${encodeURIComponent(initiativeId)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        toast.error(COPY.reviewError);
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(COPY.reviewError);
    } finally {
      setSaving(null);
    }
  }

  const measure = (v: number | null) =>
    v === null ? COPY.reviewUnmeasured : String(v);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{COPY.reviewTitle}</SheetTitle>
          <SheetDescription>{COPY.reviewDescription(title)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* Measured before/after — the numbers, never a causal claim. */}
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
            {metricLabel ? (
              <p className="font-medium">{metricLabel}</p>
            ) : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                {COPY.reviewStarted}: {measure(baseline)}
              </span>
              <span>
                {COPY.reviewNow}: {measure(current)}
              </span>
              <span>
                {COPY.reviewTargetLabel}: {target}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="initiative-outcome" className="text-sm font-medium">
              {COPY.reviewOutcomeLabel}
            </label>
            <select
              id="initiative-outcome"
              className={inputClassName}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
              disabled={saving !== null}
            >
              {(
                ["improved", "unchanged", "worsened", "inconclusive"] as const
              ).map((o) => (
                <option key={o} value={o}>
                  {COPY.outcomeLabel[o]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => submit({ action: "stop" }, "stop")}
            disabled={saving !== null}
          >
            {saving === "stop" ? <Spinner /> : null}
            {COPY.reviewStop}
          </Button>
          <Button
            type="button"
            onClick={() => submit({ action: "complete", outcome }, "complete")}
            disabled={saving !== null}
          >
            {saving === "complete" ? <Spinner /> : null}
            {COPY.reviewSave}
          </Button>
        </SheetFooter>
      </ResponsiveSheetContent>
    </Sheet>
  );
}
