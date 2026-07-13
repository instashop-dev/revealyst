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

/**
 * The persistent coaching card (W5-C deliverable 2). Today coaching
 * recommendations render as generic "needs attention" alerts mixed with
 * connection/gap warnings; this gives them a dedicated, always-present home on
 * the companion surface. It consumes ONLY `deriveAttention` items with
 * `kind === "recommendation"` (the gated, measured-and-weak, task-focused
 * guidance) — never the action alerts, which stay in the attention strip.
 * Server-safe, pure props.
 */
export function CoachingCard({
  recommendations,
}: {
  /** Pre-filtered to `kind === "recommendation"` by the caller. */
  recommendations: AttentionItem[];
}) {
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
                {item.href ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    nativeButton={false}
                    render={<Link href={item.href} />}
                  >
                    Take a look
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
