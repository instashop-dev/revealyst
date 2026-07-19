"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SCORE_GLOSSARY, type ScoreSlug } from "@/lib/metrics-glossary";
import { TEAM_GOAL_METRICS } from "@/lib/team-goal";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.goal;

export type TeamGoalVM = {
  metricSlug: ScoreSlug;
  baseline: number | null;
  target: number;
  reviewDate: string;
  /** The current MEASURED value, or null when the metric is unmeasured. */
  current: number | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Deterministic "MMM D, YYYY" from an ISO "YYYY-MM-DD" — no locale, so the
 * server and client render identically (no hydration mismatch). */
function formatReviewDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  const month = MONTHS[m - 1] ?? "";
  return month ? `${month} ${d}, ${y}` : iso;
}

const metricLabel = (slug: ScoreSlug) => SCORE_GLOSSARY[slug].plainName;

/**
 * The team goal card (TMD P1b, ADR 0061): the manager-set objective that heads
 * the Command Center. Displays the active goal's progress line and, for a
 * manager, an opt-in drawer to set or change it. A member with no goal set sees
 * nothing (the card returns null). The setter posts to `/api/goals` and
 * `router.refresh()`es the server component so the display can't drift.
 */
export function TeamGoalCard({
  goal,
  canManage,
  /** Per-metric current MEASURED value (or null), for the setter's starting-point line. */
  currentByMetric,
}: {
  goal: TeamGoalVM | null;
  canManage: boolean;
  currentByMetric: Record<ScoreSlug, number | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [metricSlug, setMetricSlug] = useState<ScoreSlug>(
    goal?.metricSlug ?? TEAM_GOAL_METRICS[0],
  );
  const [target, setTarget] = useState<string>(
    goal ? String(goal.target) : "75",
  );
  const [reviewDate, setReviewDate] = useState<string>(goal?.reviewDate ?? "");
  const [saving, setSaving] = useState(false);

  // Members never see an empty goal card (no goal, can't set one).
  if (!goal && !canManage) return null;

  const targetNum = Number(target);
  const canSave =
    !saving &&
    reviewDate.length > 0 &&
    Number.isInteger(targetNum) &&
    targetNum >= 0 &&
    targetNum <= 100;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metricSlug, target: targetNum, reviewDate }),
      });
      if (!res.ok) {
        toast.error(COPY.saveError);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(COPY.saveError);
    } finally {
      setSaving(false);
    }
  }

  const pickedCurrent = currentByMetric[metricSlug] ?? null;

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4 text-primary" aria-hidden="true" />
          {COPY.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {goal ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {COPY.headline(metricLabel(goal.metricSlug))}
            </p>
            <p className="text-sm text-muted-foreground">
              {COPY.detail(
                goal.baseline === null ? "—" : String(goal.baseline),
                goal.target,
                formatReviewDate(goal.reviewDate),
              )}
              {goal.current !== null ? ` ${COPY.now(goal.current)}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{COPY.empty}</p>
        )}

        {canManage ? (
          <div>
            <Button
              type="button"
              variant={goal ? "outline" : "default"}
              size="sm"
              onClick={() => setOpen(true)}
            >
              {goal ? COPY.changeAction : COPY.setAction}
            </Button>
          </div>
        ) : null}
      </CardContent>

      {canManage ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <ResponsiveSheetContent className="w-full gap-0 sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{COPY.drawerTitle}</SheetTitle>
              <SheetDescription>{COPY.drawerDescription}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="goal-metric" className="text-sm font-medium">
                  {COPY.metricLabel}
                </label>
                <select
                  id="goal-metric"
                  className={inputClassName}
                  value={metricSlug}
                  onChange={(e) => setMetricSlug(e.target.value as ScoreSlug)}
                  disabled={saving}
                >
                  {TEAM_GOAL_METRICS.map((slug) => (
                    <option key={slug} value={slug}>
                      {metricLabel(slug)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {pickedCurrent === null
                    ? COPY.baselineUnmeasured(metricLabel(metricSlug))
                    : COPY.baselineMeasured(metricLabel(metricSlug), pickedCurrent)}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="goal-target" className="text-sm font-medium">
                  {COPY.targetLabel}
                </label>
                <input
                  id="goal-target"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className={inputClassName}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="goal-review" className="text-sm font-medium">
                  {COPY.reviewLabel}
                </label>
                <input
                  id="goal-review"
                  type="date"
                  className={inputClassName}
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <SheetFooter>
              <Button type="button" onClick={save} disabled={!canSave}>
                {saving ? <Spinner /> : null}
                {COPY.saveAction}
              </Button>
            </SheetFooter>
          </ResponsiveSheetContent>
        </Sheet>
      ) : null}
    </Card>
  );
}
