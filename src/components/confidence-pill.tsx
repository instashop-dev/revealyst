import type { LucideIcon } from "lucide-react";
import { BarChart3, CircleSlash, Info, ShieldCheck, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * ConfidencePill (U0.2) — the ONE visual primitive for every confidence-tier
 * disclosure across the maturity board (`src/components/maturity`), the F1.2
 * analytics surfaces (`src/components/analytics`), and anywhere else a number
 * needs an honesty label. It replaces the two divergent `ConfidenceBadge`
 * components those two areas used to keep separately.
 *
 * This unifies the *component*, not the copy: the maturity tier vocabulary
 * (measured/modeled/directional/not_measured, from `@/lib/maturity`) and the
 * analytics tier vocabulary (measured/derived/directional, from
 * `@/lib/analytics-glossary`) are DELIBERATELY different and stay sourced
 * from their own glossaries — callers resolve their own `label` (and any
 * `detail` override) and pass the resolved text in. `tier` here is optional
 * and used only to pick an icon (and, for `not_measured`, a muted treatment):
 * a confidence disclosure is never color-only, so every pill always renders
 * an icon next to its text.
 */
export type ConfidencePillTier =
  | "measured"
  | "modeled"
  | "derived"
  | "directional"
  | "not_measured";

const TIER_ICON: Record<ConfidencePillTier, LucideIcon> = {
  measured: ShieldCheck,
  modeled: BarChart3,
  derived: BarChart3,
  directional: TrendingUp,
  not_measured: CircleSlash,
};

/** Falls back to this when `tier` is omitted or isn't one of the known
 * vocabularies above — still an icon, never bare text. */
const DEFAULT_ICON = Info;

export function ConfidencePill({
  tier,
  label,
  detail,
  asOf,
  className,
}: {
  /** Known tier — selects the icon (and, for `not_measured`, muted text).
   * Optional: a caller outside the two known vocabularies can omit it and
   * rely on `label` alone (default icon). */
  tier?: ConfidencePillTier;
  /** The resolved tier text, already sourced from the caller's own glossary. */
  label: string;
  /** Overrides `label` with a method note (e.g. "derived, straight-line"). */
  detail?: string;
  /** Optional trailing "as of" text (e.g. a sync date). */
  asOf?: string;
  className?: string;
}) {
  const Icon = (tier && TIER_ICON[tier]) || DEFAULT_ICON;
  const text = detail ?? label;
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        tier === "not_measured" ? "text-muted-foreground" : undefined,
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {asOf ? `${text} · ${asOf}` : text}
    </Badge>
  );
}
