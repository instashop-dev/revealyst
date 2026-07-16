"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellOff, Check, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RecInteractionStateValue } from "@/lib/rec-interactions";

// Snooze / dismiss / mark-tried affordances for ONE coaching recommendation
// (W5-D, ADR 0028). Rendered only on the personal self-view (the CoachingCard
// passes a personId only there), so this is always the signed-in person acting
// on their OWN rec — the API re-checks ownership regardless. On success the
// server state changed (a dismiss/snooze hides the rec, a tried marks it), so
// we refresh the route to re-render from the new server truth rather than
// mutating local state.
//
// U0.3 undo: snooze/dismiss hide the rec once the route refreshes, so a
// 10-second toast (sonner `action`) offers one-click revert — implemented as
// a SECOND POST to this same endpoint, never a client-only rollback (the
// server state must actually change back, or a page reload would re-hide the
// rec). `rec_interaction_state.state` is a closed 3-value enum with no
// "cleared"/"never interacted" value and no delete route (§8.3 — the state
// api is write/overwrite-only), so there is no way to restore a never-touched
// rec to a literal blank slate. "tried" is the only value that both (a) is
// accepted by the endpoint and (b) never suppresses the rec — so undo always
// resolves to it, which is exact when the rec really was already tried, and
// best-effort (rec comes back, shown with the "tried" indicator rather than
// the buttons) otherwise. The toast copy stays neutral ("Restored") rather
// than claiming "marked as tried" so it never overstates what happened.
export function RecInteractionActions({
  personId,
  recId,
  tried,
}: {
  personId: string;
  recId: string;
  /** True when this rec is already marked "tried" — the button becomes a
   * static indicator so the person sees their feedback stuck. */
  tried?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<RecInteractionStateValue | null>(null);

  async function act(
    state: RecInteractionStateValue,
    successMsg: string,
    options?: { offerUndo?: boolean },
  ) {
    setBusy(state);
    try {
      const res = await fetch("/api/recommendations/interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, recId, state }),
      });
      if (!res.ok) {
        toast.error("Couldn't update — please try again.");
        return;
      }
      if (options?.offerUndo) {
        toast.success(successMsg, {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () => {
              void act("tried", "Restored");
            },
          },
        });
      } else {
        toast.success(successMsg);
      }
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setBusy((prev) => (prev === state ? null : prev));
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {tried ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Check className="size-3.5" aria-hidden="true" />
          Marked as tried
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => act("tried", "Nice — marked as tried")}
        >
          {busy === "tried" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ThumbsUp data-icon="inline-start" />
          )}
          Mark as tried
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() =>
          act("snoozed", "Snoozed — we'll bring it back later", {
            offerUndo: true,
          })
        }
      >
        {busy === "snoozed" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <BellOff data-icon="inline-start" />
        )}
        Snooze
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() =>
          act("dismissed", "Dismissed — you won't see this again", {
            offerUndo: true,
          })
        }
      >
        {busy === "dismissed" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <X data-icon="inline-start" />
        )}
        Dismiss
      </Button>
    </div>
  );
}
