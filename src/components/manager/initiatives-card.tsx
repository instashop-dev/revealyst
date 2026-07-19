"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Rocket } from "lucide-react";
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
import { InitiativeRosterDrawer } from "@/components/manager/initiative-roster-drawer";
import { SCORE_GLOSSARY, type ScoreSlug } from "@/lib/metrics-glossary";
import {
  INITIATIVE_LIBRARY,
  INITIATIVE_TEMPLATE_ORDER,
} from "@/lib/initiative-library";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.initiatives;

export type InitiativeVM = {
  id: string;
  title: string;
  status: "draft" | "active" | "in_review" | "completed" | "stopped";
  scoreSlug: string | null;
  capabilitySlug: string | null;
  baseline: number | null;
  target: number;
  current: number | null;
  reviewDate: string;
  participantCount: number;
  isOwner: boolean;
  canManageRoster: boolean;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Deterministic "MMM D, YYYY" — no locale, so server and client match. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  const month = MONTHS[m - 1] ?? "";
  return month ? `${month} ${d}, ${y}` : iso;
}

/**
 * The initiatives card (TMD P2b, ADR 0062): the OPEN initiatives, COUNT-ONLY
 * (participation is a number — the named roster is opened separately by an
 * authorized manager, P2c), plus an opt-in launch drawer for a manager/admin. A
 * member with no initiatives running sees nothing (the card returns null). The
 * launch posts to `/api/initiatives` and `router.refresh()`es.
 */
export function InitiativesCard({
  initiatives,
  canManage,
  /** capability slug → display label, for capability-targeted initiatives. */
  capabilityLabels,
}: {
  initiatives: InitiativeVM[];
  canManage: boolean;
  capabilityLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rosterFor, setRosterFor] = useState<InitiativeVM | null>(null);
  const [templateSlug, setTemplateSlug] = useState<string>("");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("70");
  const [reviewDate, setReviewDate] = useState("");
  const [saving, setSaving] = useState(false);

  if (initiatives.length === 0 && !canManage) return null;

  const metricLabel = (i: InitiativeVM): string | null => {
    if (i.scoreSlug) return SCORE_GLOSSARY[i.scoreSlug as ScoreSlug].plainName;
    if (i.capabilitySlug)
      return capabilityLabels[i.capabilitySlug] ?? i.capabilitySlug;
    return null;
  };

  const targetNum = Number(target);
  const canSave =
    !saving &&
    templateSlug.length > 0 &&
    title.trim().length > 0 &&
    reviewDate.length > 0 &&
    Number.isInteger(targetNum) &&
    targetNum >= 0 &&
    targetNum <= 100;

  function pickTemplate(slug: string) {
    setTemplateSlug(slug);
    // Prefill the name from the play, but let the manager edit it.
    if (slug && INITIATIVE_LIBRARY[slug] && title.trim().length === 0) {
      setTitle(INITIATIVE_LIBRARY[slug].title);
    }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateSlug,
          title: title.trim(),
          target: targetNum,
          reviewDate,
        }),
      });
      if (!res.ok) {
        toast.error(COPY.saveError);
        return;
      }
      setOpen(false);
      setTemplateSlug("");
      setTitle("");
      setTarget("70");
      setReviewDate("");
      router.refresh();
    } catch {
      toast.error(COPY.saveError);
    } finally {
      setSaving(false);
    }
  }

  const chosen = templateSlug ? INITIATIVE_LIBRARY[templateSlug] : null;

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4 text-primary" aria-hidden="true" />
          {COPY.title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{COPY.lead}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {initiatives.length === 0 ? (
          <p className="text-sm text-muted-foreground">{COPY.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {initiatives.map((i) => {
              const label = metricLabel(i);
              return (
                <li key={i.id} className="flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{i.title}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {COPY.statusLabel[i.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {label ? `${label} · ` : ""}
                    {COPY.progressLine(
                      i.baseline === null ? "—" : String(i.baseline),
                      i.target,
                    )}
                    {i.current !== null ? ` ${COPY.now(i.current)}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{COPY.participants(i.participantCount)}</span>
                    <span>{COPY.reviewOn(formatDate(i.reviewDate))}</span>
                    {i.canManageRoster ? (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => setRosterFor(i)}
                      >
                        {COPY.manageRoster}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canManage ? (
          <div>
            <Button
              type="button"
              variant={initiatives.length === 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setOpen(true)}
            >
              {COPY.startAction}
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
                <label htmlFor="initiative-template" className="text-sm font-medium">
                  {COPY.templateLabel}
                </label>
                <select
                  id="initiative-template"
                  className={inputClassName}
                  value={templateSlug}
                  onChange={(e) => pickTemplate(e.target.value)}
                  disabled={saving}
                >
                  <option value="">{COPY.templateNone}</option>
                  {INITIATIVE_TEMPLATE_ORDER.map((slug) => (
                    <option key={slug} value={slug}>
                      {INITIATIVE_LIBRARY[slug].title}
                    </option>
                  ))}
                </select>
                {chosen ? (
                  <p className="text-xs text-muted-foreground">
                    {chosen.summary} {chosen.expectedChange}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="initiative-title" className="text-sm font-medium">
                  {COPY.titleLabel}
                </label>
                <input
                  id="initiative-title"
                  type="text"
                  maxLength={200}
                  className={inputClassName}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="initiative-target" className="text-sm font-medium">
                  {COPY.targetLabel}
                </label>
                <input
                  id="initiative-target"
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
                <label htmlFor="initiative-review" className="text-sm font-medium">
                  {COPY.reviewLabel}
                </label>
                <input
                  id="initiative-review"
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

      {/* The named roster drawer (owner-only, managed/full — P2c). Mounted once,
       * driven by which initiative's "Manage people" was clicked. */}
      {rosterFor ? (
        <InitiativeRosterDrawer
          initiativeId={rosterFor.id}
          initiativeTitle={rosterFor.title}
          open={rosterFor !== null}
          onOpenChange={(o) => {
            if (!o) setRosterFor(null);
          }}
        />
      ) : null}
    </Card>
  );
}
