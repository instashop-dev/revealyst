"use client";

// Data Confidence UI — the single compact homepage card + the details drawer +
// the inline metric qualifiers, all driven by the pure model from
// src/lib/data-confidence.ts. Presentation only: it renders whatever the model
// says and never re-derives honesty facts here (invariant b stays in the lib).
//
// One client provider holds the drawer's open state so BOTH the card's CTA and
// any inline metric qualifier can open it (a qualifier deep-links to its
// category). Everything else the page renders is passed through as `children`,
// so server components nest untouched inside the provider.

import * as React from "react";
import {
  ChevronDown,
  Info,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ResponsiveSheetContent } from "@/components/responsive-sheet-content";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DATA_CONFIDENCE_COPY,
  type ConfidenceState,
  type DataConfidenceModel,
  type DisclosureCategory,
  type DisclosureGroup,
  type MetricQualifierKind,
} from "@/lib/data-confidence";

const COPY = DATA_CONFIDENCE_COPY;

// ─── State presentation ───────────────────────────────────────────────────────

/** Visual treatment per confidence state. Red is reserved for the genuinely
 * unusable "sync-failed" state (spec: destructive styling only then). */
const STATE_STYLE: Record<
  ConfidenceState,
  { icon: typeof ShieldCheck; iconClass: string; badgeVariant: "secondary" | "outline" | "destructive"; badgeClass?: string }
> = {
  reliable: {
    icon: ShieldCheck,
    iconClass: "text-emerald-600 dark:text-emerald-500",
    badgeVariant: "secondary",
  },
  "mostly-complete": {
    icon: ShieldCheck,
    iconClass: "text-muted-foreground",
    badgeVariant: "secondary",
  },
  "needs-attention": {
    icon: TriangleAlert,
    iconClass: "text-amber-600 dark:text-amber-500",
    badgeVariant: "outline",
    badgeClass:
      "border-amber-500/40 text-amber-700 dark:text-amber-400",
  },
  "sync-failed": {
    icon: TriangleAlert,
    iconClass: "text-destructive",
    badgeVariant: "destructive",
  },
};

// ─── Context ──────────────────────────────────────────────────────────────────

type DataConfidenceContextValue = {
  model: DataConfidenceModel;
  /** Open the drawer, optionally deep-linked to a category. */
  open: (target?: DisclosureCategory | null) => void;
};

const DataConfidenceContext =
  React.createContext<DataConfidenceContextValue | null>(null);

function useDataConfidence(): DataConfidenceContextValue {
  const ctx = React.useContext(DataConfidenceContext);
  if (!ctx) {
    throw new Error(
      "DataConfidence components must be rendered inside <DataConfidenceProvider>.",
    );
  }
  return ctx;
}

/**
 * Wraps the companion self-view. Holds the drawer open-state so the card CTA and
 * every inline qualifier share one drawer. Renders the drawer itself once (only
 * when there is something to disclose).
 */
export function DataConfidenceProvider({
  model,
  children,
}: {
  model: DataConfidenceModel;
  children: React.ReactNode;
}) {
  const [openState, setOpenState] = React.useState(false);
  const [target, setTarget] = React.useState<DisclosureCategory | null>(null);

  const open = React.useCallback((next?: DisclosureCategory | null) => {
    setTarget(next ?? null);
    setOpenState(true);
  }, []);

  const value = React.useMemo<DataConfidenceContextValue>(
    () => ({ model, open }),
    [model, open],
  );

  return (
    <DataConfidenceContext.Provider value={value}>
      {children}
      {model.hasDisclosures ? (
        <DataConfidenceDrawer
          model={model}
          open={openState}
          onOpenChange={setOpenState}
          target={target}
        />
      ) : null}
    </DataConfidenceContext.Provider>
  );
}

// ─── Compact card ─────────────────────────────────────────────────────────────

/**
 * The single compact card that replaces the stacked disclosure banners. Answers
 * "can I trust this dashboard?" at a glance: a state chip, a one-line body, a
 * short summary, and a CTA into the details drawer (only when there's something
 * to review). Consumes the model from context — always rendered inside the
 * provider.
 */
export function DataConfidenceCard() {
  const { model, open } = useDataConfidence();
  const style = STATE_STYLE[model.state];
  const Icon = style.icon;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Icon className={cn("size-4", style.iconClass)} aria-hidden="true" />
            <span className="text-sm font-medium">{COPY.cardTitle}</span>
          </span>
          <Badge variant={style.badgeVariant} className={style.badgeClass}>
            {model.stateLabel}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{model.body}</p>

        {model.summaryLines.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {model.summaryLines.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {model.hasDisclosures ? (
          <div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => open(null)}
            >
              {COPY.reviewCta}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Inline metric qualifier ──────────────────────────────────────────────────

/**
 * A small pill shown next to a metric that a live disclosure affects ("Estimated",
 * "Partial", "As of"). Clicking it opens the details drawer at the relevant
 * category. Render this ONLY for metrics an active disclosure actually names —
 * never mark an unaffected metric (invariant b).
 */
export function MetricQualifier({
  qualifier,
  category,
  metricLabel,
  suffix,
}: {
  qualifier: MetricQualifierKind;
  /** The drawer category to open. */
  category: DisclosureCategory;
  /** The metric being qualified, for the accessible label. */
  metricLabel: string;
  /** Optional trailing text, e.g. a date for the "As of" qualifier. */
  suffix?: string;
}) {
  const { open } = useDataConfidence();
  const label = suffix
    ? `${COPY.qualifiers[qualifier]} ${suffix}`
    : COPY.qualifiers[qualifier];
  return (
    <Badge
      variant="outline"
      className="cursor-pointer font-normal hover:bg-muted"
      render={
        <button
          type="button"
          onClick={() => open(category)}
          aria-label={`${label} — ${metricLabel}. Open data quality details.`}
        />
      }
    >
      <Info aria-hidden="true" />
      {label}
    </Badge>
  );
}

// ─── Details drawer ───────────────────────────────────────────────────────────

const CATEGORY_RENDER_ORDER: DisclosureCategory[] = [
  "cost-estimates",
  "coverage",
  "import-quality",
  "sync-issues",
  "other",
];

function DataConfidenceDrawer({
  model,
  open,
  onOpenChange,
  target,
}: {
  model: DataConfidenceModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DisclosureCategory | null;
}) {
  const sectionRefs = React.useRef<
    Partial<Record<DisclosureCategory, HTMLElement | null>>
  >({});

  // When opened via a qualifier deep-link, bring the targeted category into view.
  React.useEffect(() => {
    if (!open || !target) return;
    const el = sectionRefs.current[target];
    // Optional-chained: jsdom (tests) doesn't implement scrollIntoView.
    el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [open, target]);

  const byCategory = new Map<DisclosureCategory, DisclosureGroup[]>();
  for (const group of model.groups) {
    const list = byCategory.get(group.category) ?? [];
    list.push(group);
    byCategory.set(group.category, list);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* U0.7: right-side drawer on desktop, bottom sheet on mobile — the
          side switch lives in ResponsiveSheetContent, never per drawer. */}
      <ResponsiveSheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{COPY.drawerTitle}</SheetTitle>
          <SheetDescription>{COPY.drawerDescription}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4 pt-0">
          {CATEGORY_RENDER_ORDER.filter((c) => byCategory.has(c)).map(
            (category) => (
              <section
                key={category}
                ref={(el) => {
                  sectionRefs.current[category] = el;
                }}
                className={cn(
                  "flex flex-col gap-3 rounded-lg transition-colors",
                  target === category && "ring-2 ring-ring/40",
                )}
              >
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {COPY.categories[category]}
                </h3>
                {byCategory.get(category)!.map((group) => (
                  <DisclosureItem key={group.typeKey} group={group} />
                ))}
              </section>
            ),
          )}
        </div>
      </ResponsiveSheetContent>
    </Sheet>
  );
}

function DisclosureItem({ group }: { group: DisclosureGroup }) {
  const { definition } = group;
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{definition.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{definition.explanation}</p>

      <p className="mt-2 text-sm">
        <span className="font-medium text-foreground">{COPY.impactLead}:</span>{" "}
        <span className="text-muted-foreground">{definition.impact}</span>
      </p>

      {definition.affected ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {COPY.affectedLead}: {definition.affected.label}
        </p>
      ) : null}

      {group.aggregateNote ? (
        <p className="mt-2 text-xs text-muted-foreground">{group.aggregateNote}</p>
      ) : null}

      {definition.action ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          nativeButton={false}
          render={<a href={definition.action.href} />}
        >
          {definition.action.label}
        </Button>
      ) : null}

      <TechnicalDetails group={group} />
    </div>
  );
}

/** The Technical details expander — the ONLY place raw backend wording appears
 * (parser messages, snake_case, provider issue refs). Collapsed by default. */
function TechnicalDetails({ group }: { group: DisclosureGroup }) {
  return (
    <Collapsible className="mt-3">
      <CollapsibleTrigger className="group/tech flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-3 transition-transform group-data-[panel-open]/tech:rotate-180" />
        {COPY.technicalDetailsLabel}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-1.5 border-l-2 pl-3">
          <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
            {COPY.technicalDetailsLead}
          </p>
          <ul className="flex flex-col gap-1">
            {group.occurrences.map((occ, i) => (
              <li
                key={`${occ.kind}:${occ.detail ?? ""}:${i}`}
                className="font-mono text-[0.7rem] leading-relaxed text-muted-foreground"
              >
                <span className="text-foreground">{occ.kind}</span>
                {occ.detail ? ` — ${occ.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
