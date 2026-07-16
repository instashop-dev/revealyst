import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * U0.6 — shared presentation shell for a connector/integration card: the
 * agent-pairing card (`SyncAgentCard`), the GitHub-App vendor card
 * (`GithubAppConnectCard`), and (U2) the key-vendor table rows all show the
 * same facts — who the vendor is, whether it's connected, a short blurb, a
 * meta line (last sync / requirements), and ONE primary action. This
 * component owns ONLY that chrome (header/description/footer layout); each
 * caller keeps its own state, polling, and logic, and renders through the
 * slots below. Presentation only — no fetch, no hooks, no vendor knowledge.
 */
export function ConnectorCard({
  vendorName,
  mark,
  statusBadge,
  summary,
  meta,
  primaryAction,
  secondaryAction,
  muted = false,
  children,
  scope,
  className,
}: {
  /** The connector/vendor display name (the card title). */
  vendorName: string;
  /** A small icon/logo mark shown beside the name. Purely decorative —
   * callers should keep it non-text / `aria-hidden` when it adds no
   * information beyond the name. */
  mark?: ReactNode;
  /** Connection-state badge (Connected / Paired / Not yet available / …). */
  statusBadge?: ReactNode;
  /** A short one–two line description of what this connector does. */
  summary?: ReactNode;
  /** A single meta line — last-synced time, connect requirements, etc. */
  meta?: ReactNode;
  /** The card's ONE primary call-to-action (Connect / Generate token / …).
   * Optional: a card can have nothing to act on right now (e.g. a vendor
   * that isn't available yet) and show explanatory text instead — the
   * touch-target wrapper still applies whatever is passed here. */
  primaryAction?: ReactNode;
  /** An optional secondary control alongside the primary action (a "Cancel"
   * during a confirm step, a "…" menu, etc). */
  secondaryAction?: ReactNode;
  /** Dim the whole card (e.g. a not-yet-available vendor). */
  muted?: boolean;
  /** Card-specific body content that doesn't fit the fixed slots above
   * (a shown-once token, an inline confirmation, per-state copy). */
  children?: ReactNode;
  /** Optional compact scope note ("what we read / what we never read", U4.2),
   * rendered as a bordered footer strip below the body. Additive — cards that
   * pass nothing render exactly as before. */
  scope?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(muted ? "opacity-70" : undefined, className)}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {mark ? (
              <span className="shrink-0" aria-hidden="true">
                {mark}
              </span>
            ) : null}
            <CardTitle className="text-base">{vendorName}</CardTitle>
          </div>
          {statusBadge}
        </div>
        {summary ? <CardDescription>{summary}</CardDescription> : null}
      </CardHeader>
      {children ? (
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      ) : null}
      {scope ? (
        <CardContent className="pt-0">
          <div className="rounded-lg border border-dashed bg-muted/30 p-3">
            {scope}
          </div>
        </CardContent>
      ) : null}
      {primaryAction || secondaryAction || meta ? (
        <CardFooter className="flex-col items-start gap-3">
          {meta ? <div className="w-full">{meta}</div> : null}
          {primaryAction || secondaryAction ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              {primaryAction ? (
                // A >=44px touch target regardless of what's rendered inside
                // (a button, or fallback explanatory text) — mobile tap-target
                // floor for the card's one primary action.
                <div
                  data-slot="connector-card-primary-action"
                  className="flex min-h-11 items-center"
                >
                  {primaryAction}
                </div>
              ) : null}
              {secondaryAction ? (
                // U5: the secondary control gets the same ≥44px touch floor as
                // the primary above — both are real connector actions.
                <div
                  data-slot="connector-card-secondary-action"
                  className="flex min-h-11 items-center"
                >
                  {secondaryAction}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
