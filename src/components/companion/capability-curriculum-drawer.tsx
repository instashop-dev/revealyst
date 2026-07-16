"use client";

// The GJ-007 curriculum drawer (T4.1). A small, opt-in Sheet opened from the
// capability-profile card's next-focus line — mirrors the `DataConfidence`
// drawer pattern (src/components/companion/data-confidence.tsx): a client
// leaf embedded in an otherwise server-rendered card, holding only its own
// open state. Renders the static content from `src/lib/capability-curriculum`
// — no query, no new card (companion minimalism, CLAUDE.md UX rule).

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ResponsiveSheetContent } from "@/components/responsive-sheet-content";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CAPABILITY_CURRICULUM,
  CAPABILITY_CURRICULUM_COPY,
  CAPABILITY_CURRICULUM_ORDER,
} from "@/lib/capability-curriculum";

const COPY = CAPABILITY_CURRICULUM_COPY;

/**
 * Shared drawer wiring for both triggers (U1.3 dedup): the open state, the
 * curriculum-entry lookup, and the mounted `<CapabilityCurriculumDrawer>`.
 * Returns `hasEntry: false` (drawer null) when the slug has no curriculum entry,
 * so each trigger can render its own honest no-entry markup. The OUTER markup
 * (lead line vs. bare button) stays distinct in each trigger below.
 */
function useCurriculumDrawer(
  slug: string,
  label: string,
  labels: ReadonlyMap<string, string>,
) {
  const [open, setOpen] = React.useState(false);
  const hasEntry = Boolean(CAPABILITY_CURRICULUM[slug]);
  const drawer = hasEntry ? (
    <CapabilityCurriculumDrawer
      slug={slug}
      label={label}
      labels={labels}
      open={open}
      onOpenChange={setOpen}
    />
  ) : null;
  return { hasEntry, openDrawer: () => setOpen(true), drawer };
}

/**
 * The clickable next-focus line. Renders plain text (no affordance) when the
 * slug has no curriculum entry — never a dead link. Opens the drawer on click.
 * `nextLead` is passed in from `CAPABILITY_PROFILE_COPY.nextLead` (the
 * existing card copy) so the lead text has one source of truth.
 */
export function CapabilityCurriculumTrigger({
  slug,
  label,
  nextLead,
  labels,
}: {
  slug: string;
  label: string;
  /** The card's existing "A good next focus" lead copy. */
  nextLead: string;
  /** Capability slug → display label, for the path list in the drawer. */
  labels: ReadonlyMap<string, string>;
}) {
  const { hasEntry, openDrawer, drawer } = useCurriculumDrawer(slug, label, labels);

  if (!hasEntry) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{nextLead}:</span>{" "}
        {label}
      </p>
    );
  }

  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{nextLead}:</span>{" "}
        {label}{" "}
        <button
          type="button"
          onClick={openDrawer}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {COPY.triggerLabel}
        </button>
      </p>
      {drawer}
    </>
  );
}

/**
 * U1.3 Growth full-list variant: a lean per-row "See how to grow this" button
 * (no "next focus" lead line — the row already names the capability). Renders
 * NOTHING (null) when the slug has no curriculum entry, so a row never shows a
 * dead link. Same drawer, same copy source.
 */
export function CapabilityGrowTrigger({
  slug,
  label,
  labels,
}: {
  slug: string;
  label: string;
  labels: ReadonlyMap<string, string>;
}) {
  const { hasEntry, openDrawer, drawer } = useCurriculumDrawer(slug, label, labels);

  if (!hasEntry) return null;

  return (
    <>
      {/* U5: this is a standalone per-row action (not inline in a sentence, so
          no WCAG inline-text exception applies) — give it the ≥44px touch
          floor via an invisible min-h-11 hit area, keeping the text compact. */}
      <button
        type="button"
        onClick={openDrawer}
        className="inline-flex min-h-11 items-center text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        {COPY.triggerLabel}
      </button>
      {drawer}
    </>
  );
}

function CapabilityCurriculumDrawer({
  slug,
  label,
  labels,
  open,
  onOpenChange,
}: {
  slug: string;
  label: string;
  labels: ReadonlyMap<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entry = CAPABILITY_CURRICULUM[slug];
  const position = CAPABILITY_CURRICULUM_ORDER.indexOf(slug);

  if (!entry) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* U0.7: right-side drawer on desktop, bottom sheet on mobile — the
          side switch lives in ResponsiveSheetContent, never per drawer. */}
      <ResponsiveSheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {COPY.titleLead} {label}
          </SheetTitle>
          <SheetDescription>{entry.summary}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4 pt-0">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {COPY.howToLabel}
            </h3>
            <ul className="flex flex-col gap-2">
              {entry.howTo.map((step) => (
                <li key={step} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {COPY.tryThisLabel}
            </h3>
            <ul className="flex flex-col gap-2">
              {entry.tryThis.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border p-2.5 text-sm text-muted-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {position >= 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {COPY.pathLabel}
              </h3>
              <p className="text-xs text-muted-foreground">
                {COPY.pathDescription}
              </p>
              <ol className="flex flex-col gap-1">
                {CAPABILITY_CURRICULUM_ORDER.map((s, i) => (
                  <li
                    key={s}
                    className="flex items-center gap-2 text-sm"
                  >
                    {s === slug ? (
                      <Badge variant="secondary" className="font-normal">
                        {i + 1}
                      </Badge>
                    ) : (
                      <span className="w-6 text-center text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                    )}
                    <span
                      className={
                        s === slug
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {s === slug ? label : (labels.get(s) ?? s)}
                    </span>
                    {s === slug ? (
                      <ArrowRight
                        aria-hidden="true"
                        className="size-3 text-muted-foreground"
                      />
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </ResponsiveSheetContent>
    </Sheet>
  );
}
