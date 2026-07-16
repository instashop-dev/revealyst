import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COACHING_COPY } from "@/lib/companion-glossary";
import type { AttentionItem } from "@/lib/score-insights";
import { RecInteractionActions } from "./rec-interaction-actions";

/**
 * U0.3 — one coaching recommendation's presentation, extracted from
 * `CoachingCard`'s inline `<li>` markup (W5-C/W5-D/W7-1/W7-4/COACH-008) so the
 * card itself can become a thin list. Rendered output for the non-interactive
 * parts (title, badge, body, why line, confidence note, capability line,
 * suggested-action button) is BYTE-EQUIVALENT to the markup this replaces —
 * this is a structural move, not a content change. The digest/dashboard
 * shared-source parity test pins REC SELECTION (src/lib), not this markup.
 *
 * Interaction affordances (snooze/dismiss/mark-tried, + the undo toast) live
 * in `RecInteractionActions` and render only when `personId` and `item.recId`
 * are both present (self-view only — see that file's own doc comment).
 */
export function RecommendationCard({
  item,
  personId,
  tried,
}: {
  item: AttentionItem;
  /** The signed-in person (personal self-view only). Present → render the
   * interaction affordances; absent → read-only card (manager/no-person). */
  personId?: string | null;
  /** Whether this rec is already marked "tried". */
  tried?: boolean;
}) {
  return (
    <li className="rounded-lg bg-muted/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{item.title}</p>
        <Badge variant="outline" className="font-normal">
          {COACHING_COPY.guidanceBadge}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
      {item.whyLine ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {COACHING_COPY.whyLead}:
          </span>{" "}
          {item.whyLine}
          {item.confidenceNote ? ` ${item.confidenceNote}` : ""}
        </p>
      ) : null}
      {item.capabilityLabel ? (
        <p className="mt-2 text-xs font-medium text-primary">
          {COACHING_COPY.advancesLead}: {item.capabilityLabel}
        </p>
      ) : null}
      {item.href ? (
        item.suggestedActionType === "link-out" ? (
          // COACH-008: external guidance — open in a new tab with the
          // safe rel (noreferrer + noopener), labelled "Learn more".
          <Button
            size="sm"
            variant="outline"
            // U5: ≥44px touch-target floor (min-h-11 invisible hit area).
            className="mt-3 min-h-11"
            nativeButton={false}
            render={
              <a href={item.href} target="_blank" rel="noreferrer noopener" />
            }
          >
            {COACHING_COPY.learnMore}
          </Button>
        ) : (
          // `in-product-setting` → in-app navigation. `vendor-deep-link`
          // is DEFERRED (no per-rec target URL exists yet), so it falls
          // back to this same in-app affordance rather than a broken
          // external jump.
          <Button
            size="sm"
            variant="outline"
            className="mt-3 min-h-11"
            nativeButton={false}
            render={<Link href={item.href} />}
          >
            {COACHING_COPY.takeALook}
          </Button>
        )
      ) : null}
      {personId && item.recId ? (
        <RecInteractionActions
          personId={personId}
          recId={item.recId}
          tried={tried}
        />
      ) : null}
    </li>
  );
}
