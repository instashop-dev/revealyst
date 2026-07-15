import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { COACHING_COPY } from "@/lib/companion-glossary";
import type { AttentionItem } from "@/lib/score-insights";
import { RecInteractionActions } from "./rec-interaction-actions";

/**
 * The persistent coaching card (W5-C deliverable 2). Today coaching
 * recommendations render as generic "needs attention" alerts mixed with
 * connection/gap warnings; this gives them a dedicated, always-present home on
 * the companion surface. It consumes ONLY `deriveAttention` items with
 * `kind === "recommendation"` (the gated, measured-and-weak, task-focused
 * guidance) — never the action alerts, which stay in the attention strip.
 * Server-safe, pure props.
 *
 * W5-D: on the personal self-view the caller passes `personId`, which turns on
 * per-rec snooze/dismiss/mark-tried affordances (self-view only — a manager
 * surface passes no personId, so no affordances and no interaction state ever
 * render). Dismissed/actively-snoozed recs are already filtered out UPSTREAM by
 * the caller; `triedRecIds` marks the ones kept-but-tried.
 */
export function CoachingCard({
  recommendations,
  personId,
  triedRecIds,
}: {
  /** Pre-filtered to `kind === "recommendation"` by the caller. */
  recommendations: AttentionItem[];
  /** The signed-in person (personal self-view only). Present → render the
   * interaction affordances; absent → read-only card (manager/no-person). */
  personId?: string | null;
  /** Rec ids the person has marked "tried" — shown with a static indicator. */
  triedRecIds?: readonly string[];
}) {
  const tried = new Set(triedRecIds ?? []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-primary" aria-hidden="true" />
          {COACHING_COPY.title}
        </CardTitle>
        <CardDescription>{COACHING_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">{COACHING_COPY.empty.headline}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {COACHING_COPY.empty.body}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {recommendations.map((item, i) => (
              <li
                key={`${i}-${item.title}`}
                className="rounded-lg bg-muted/50 p-4"
              >
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
                      className="mt-3"
                      nativeButton={false}
                      render={
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer noopener"
                        />
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
                      className="mt-3"
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
                    tried={tried.has(item.recId)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
