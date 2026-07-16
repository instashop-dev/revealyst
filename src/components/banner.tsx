import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Info, TriangleAlert } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Banner (U0.4) — the ONE presentation primitive for system banners, built on
 * the `Alert` UI primitive. Consumed by `SyncStalenessBanner`,
 * `BudgetAlertBanner`, and `ImpersonationBanner` — each keeps its own file,
 * its own copy, and its own conditional logic (when to render, what to say);
 * only the visual chrome (tone → icon/color, title/description/action
 * layout) is unified here.
 *
 * System banners are NOT dismissible in this phase — there is deliberately no
 * dismiss affordance on this primitive.
 */
export type BannerTone = "info" | "warning" | "critical";

const TONE_ICON: Record<BannerTone, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  critical: TriangleAlert,
};

/** Boxed (card) variant tone → extra classes layered onto Alert's own
 * default/destructive variants. `warning` has no built-in Alert variant, so
 * it gets the amber treatment here (previously duplicated inline on
 * SyncStalenessBanner). */
const BOXED_TONE_CLASS: Record<BannerTone, string | undefined> = {
  info: undefined,
  warning: "border-amber-500/60 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400",
  critical: undefined,
};

/** Persistent (full-width bar) variant → classes. Persistent bars are
 * critical-only today (ImpersonationBanner) and the prop union below makes
 * that a compile-time rule — a future persistent info/warning bar adds its
 * mapping (and widens the union) when it actually exists. */
const PERSISTENT_TONE_CLASS: Record<"critical", string> = {
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
};

type BannerBaseProps = {
  title: ReactNode;
  /** Optional action (e.g. a button/link) rendered alongside the banner. */
  action?: ReactNode;
  /** Overrides the tone's default icon. */
  icon?: LucideIcon;
  className?: string;
};

/**
 * Discriminated on `persistent` so an unsupported combination is a compile
 * error, not a silent no-op: a persistent bar is single-line (no `children`)
 * and critical-only today.
 */
export type BannerProps =
  | (BannerBaseProps & {
      tone: BannerTone;
      persistent?: false;
      /** The banner body — rendered inside `AlertDescription`. */
      children?: ReactNode;
    })
  | (BannerBaseProps & {
      /** Full-width, edge-to-edge system bar (e.g. impersonation) instead of
       * the boxed card look — for a banner that must stay visible above/within
       * the whole app shell rather than sit inside page content. */
      persistent: true;
      tone: "critical";
      children?: never;
    });

export function Banner({
  tone,
  title,
  children,
  action,
  icon,
  persistent = false,
  className,
}: BannerProps) {
  const Icon = icon ?? TONE_ICON[tone];

  if (persistent) {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center justify-between gap-3 border-b px-4 py-2 text-sm",
          // The prop union pins persistent bars to tone="critical" (see
          // BannerProps) — destructuring erases that narrowing, so index the
          // literal.
          PERSISTENT_TONE_CLASS.critical,
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span>{title}</span>
        </div>
        {action}
      </div>
    );
  }

  return (
    <Alert
      variant={tone === "critical" ? "destructive" : "default"}
      className={cn(BOXED_TONE_CLASS[tone], className)}
    >
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}
